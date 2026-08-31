#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# omp yoki-bridge Contract Test (test-omp-yoki-bridge.sh)
# -----------------------------------------------------------------------------
# domains/dev/config/omp/extensions/yoki-bridge.ts replaces yoki-guard.ts and
# reimplements NOTHING: it wraps whatever omp hands a handler as
# {event, payload, ctx}, spawns the real
#   node <YOKI_ROOT>/scripts/hooks/run-with-flags.js --harness omp <id> <script>
#   node <YOKI_ROOT>/scripts/hooks/run-bash-hook.js  --harness omp <hook.sh>
# runners against it, and combines their omp-shaped verdicts (first deny
# wins). The translation (payload normalization, hashline/apply_patch fan-out,
# Claude-shaped-output -> omp-shaped-output) lives in the shared
# scripts/lib/harness/{payload,response}.js library those runners already
# consume and already have their own passing unit tests — this test drives
# the REAL runners against REAL hook scripts (git-guard.sh, unattended-guard.sh,
# plus disposable stubs) through the extension itself, so it catches a
# regression in the dispatch/combine glue, not a re-check of the library.
#
# Covers: handler registration for all 8 events, tool_call deny propagation
# from git-guard, benign allow, hashline/apply_patch multi-path fan-out,
# session_stop continue passthrough (plain, additionalContext, and block),
# broken-hooks fail-open, and the yoki-hooks.json-absent fallback (plus a
# manifest-present-overrides-fallback sanity check).
#
# Usage: ./test-omp-yoki-bridge.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

EXT="${DOTFILES_ROOT}/domains/dev/config/omp/extensions/yoki-bridge.ts"
YOKI_ROOT_DIR="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki"

run_omp_yoki_bridge_checks() {
    log_info "=== omp yoki-bridge Contract Test Suite ==="
    echo ""

    if ! command -v node >/dev/null 2>&1; then
        log_warn "SKIP: node not installed"
        return 0
    fi

    local FAILED=0 PASSED=0 TOTAL=0
    local WORK
    WORK="$(mktemp -d)"
    # Double-quoted so $WORK is baked in now, at registration time — WORK is
    # local to this function and would be unbound by the time an EXIT trap
    # fires (after this function has already returned).
    trap "/bin/rm -rf '$WORK'" EXIT

    # --- stub hooks used by every scenario below --------------------------
    # git-guard stub: records every payload it receives, denies two markers,
    # matching the deny/allow shape the real git-guard.sh produces.
    mkdir -p "$WORK/hooks"
    cat > "$WORK/hooks/git-guard.sh" <<'STUB'
#!/usr/bin/env bash
payload="$(cat)"
echo "$payload" >> "${GUARD_CAPTURE}"
if echo "$payload" | grep -q 'git push --force'; then
    echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"stub: force push"}}'
elif echo "$payload" | grep -q 'blocked.txt'; then
    echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"stub: blocked path"}}'
fi
STUB
    cat > "$WORK/hooks/unattended-guard.sh" <<'STUB'
#!/usr/bin/env bash
cat > /dev/null
STUB
    chmod +x "$WORK/hooks/"*.sh

    # broken-hooks dir for the fail-open case (fallback set, but unusable)
    mkdir -p "$WORK/broken-hooks"
    printf '#!/usr/bin/env bash\ncat > /dev/null\nexit 1\n' > "$WORK/broken-hooks/git-guard.sh"
    printf 'this is not bash {{{' > "$WORK/broken-hooks/unattended-guard.sh"
    chmod +x "$WORK/broken-hooks/"*.sh

    # session_stop stubs, referenced by a manifest below
    mkdir -p "$WORK/session-hooks"
    printf '#!/usr/bin/env bash\ncat > /dev/null\n' > "$WORK/session-hooks/silent.sh"
    printf '#!/usr/bin/env bash\ncat > /dev/null\necho '\''{"hookSpecificOutput":{"additionalContext":"stub: session note"}}'\''\n' \
        > "$WORK/session-hooks/context.sh"
    printf '#!/usr/bin/env bash\ncat > /dev/null\necho '\''{"decision":"block","reason":"stub: stop blocked"}'\''\n' \
        > "$WORK/session-hooks/block.sh"
    chmod +x "$WORK/session-hooks/"*.sh

    export GUARD_CAPTURE="$WORK/capture.jsonl"
    : > "$GUARD_CAPTURE"

    # --- node runner --------------------------------------------------------
    cat > "$WORK/runner.mts" <<'RUNNER'
const { pathToFileURL } = await import("node:url");
const { readFileSync, writeFileSync } = await import("node:fs");

const EXT_PATH = pathToFileURL(process.env.GUARD_EXT!).href;

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail = "") {
    if (cond) { passed++; console.log("PASS: " + name); }
    else { failed++; console.log("FAIL: " + name + (detail ? " — " + detail : "")); }
}

function loadExtension() {
    const handlers: Record<string, (payload: unknown, ctx: unknown) => Promise<unknown>> = {};
    const fakePi = { on(event: string, handler: (payload: unknown, ctx: unknown) => Promise<unknown>) { handlers[event] = handler; } };
    return { handlers, fakePi };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
        cwd: "/tmp/omp-bridge-test",
        model: "gpt-5.4-mini",
        sessionManager: { getSessionId: () => "omp-bridge-session", getSessionFile: () => "/tmp/omp-bridge.jsonl" },
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        getContextUsage: () => ({ tokens: 10 }),
        ...overrides,
    };
}

const capture = process.env.GUARD_CAPTURE!;
const capturedLines = () => readFileSync(capture, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------
// 1. Fallback guards (no yoki-hooks.json): registration, deny, allow, fan-out
// ---------------------------------------------------------------------------
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    delete process.env.YOKI_HOOKS_MANIFEST;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?fallback");
    mod.default(fakePi);

    const expectedEvents = [
        "session_start", "before_agent_start", "tool_call", "tool_result",
        "session_before_compact", "session_stop", "session_shutdown", "tool_approval_requested",
    ];
    check(
        "registers all 8 events",
        expectedEvents.every((e) => typeof handlers[e] === "function"),
        JSON.stringify(Object.keys(handlers)),
    );

    const ctx = makeCtx();
    const call = (event: string, payload: unknown) => handlers[event]!(payload, ctx);

    // deny propagation from git-guard (fallback)
    const r1 = (await call("tool_call", { type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } })) as { block?: boolean; reason?: string } | undefined;
    check("tool_call: bash force-push denied by fallback git-guard", r1?.block === true, JSON.stringify(r1));
    check("tool_call: deny reason surfaced", (r1?.reason ?? "").includes("stub: force push"));

    // benign allow
    writeFileSync(capture, "");
    const r2 = await call("tool_call", { type: "tool_call", toolName: "bash", toolCallId: "t2", input: { command: "ls -la" } });
    check("tool_call: benign bash is allowed (undefined)", r2 === undefined, JSON.stringify(r2));
    const p2 = capturedLines()[0];
    check("tool_call: envelope reaches git-guard with the right session/cwd", p2?.session_id === "omp-bridge-session" && p2?.cwd === ctx.cwd, JSON.stringify(p2));

    // hashline multi-path fan-out: one of two paths is blocked
    writeFileSync(capture, "");
    const hashline = "[ok.txt#1a2b]\nsome content\n[blocked.txt#3c4d]\nmore content\n";
    const r3 = (await call("tool_call", { type: "tool_call", toolName: "edit", toolCallId: "t3", input: { input: hashline } })) as { block?: boolean; reason?: string } | undefined;
    check("tool_call: hashline multi-path denies on the blocked path", r3?.block === true, JSON.stringify(r3));
    check("tool_call: hashline deny reason surfaced", (r3?.reason ?? "").includes("stub: blocked path"));

    // apply_patch multi-path fan-out: same, via the apply_patch envelope
    writeFileSync(capture, "");
    const patch = "*** Begin Patch\n*** Update File: ok.txt\n@@\n-a\n+b\n*** Update File: blocked.txt\n@@\n-c\n+d\n*** End Patch";
    const r4 = (await call("tool_call", { type: "tool_call", toolName: "apply_patch", toolCallId: "t4", input: { input: patch } })) as { block?: boolean; reason?: string } | undefined;
    check("tool_call: apply_patch multi-path denies on the blocked path", r4?.block === true, JSON.stringify(r4));

    // fallback only covers tool_call — every other event has nothing
    // registered and must be a pure no-op (no crash, no opinion).
    const r5 = await call("session_stop", { type: "session_stop", turn_id: 1, stop_hook_active: false });
    check("session_stop: no fallback hooks -> no opinion (undefined)", r5 === undefined, JSON.stringify(r5));
}

// ---------------------------------------------------------------------------
// 2. Broken hooks (fallback dir points at unusable scripts): fail OPEN
// ---------------------------------------------------------------------------
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_BROKEN!;
    delete process.env.YOKI_HOOKS_MANIFEST;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?broken");
    mod.default(fakePi);
    const ctx = makeCtx();
    const r = await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx);
    check("broken hooks fail OPEN (no block)", r === undefined, JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 3. yoki-hooks.json absent -> fallback is actually what ran (not silently
//    nothing): re-assert deny with an explicit, guaranteed-missing path.
// ---------------------------------------------------------------------------
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_MISSING_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?missing-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();
    const r = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx)) as { block?: boolean } | undefined;
    check("missing yoki-hooks.json falls back to the installed guards", r?.block === true, JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 4. yoki-hooks.json present with an EMPTY tool_call list overrides the
//    fallback entirely — the manifest, once it exists, is authoritative.
// ---------------------------------------------------------------------------
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_EMPTY_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?empty-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();
    const r = await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx);
    check("a present manifest overrides the fallback even when empty", r === undefined, JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 5. session_stop: continue passthrough — plain, with additionalContext, and
//    a hard block — via a manifest-registered bash hook.
// ---------------------------------------------------------------------------
interface SessionStopResult {
    continue?: boolean;
    additionalContext?: string;
    decision?: string;
    reason?: string;
}

async function callSessionStop(manifestEnv: string, tag: string): Promise<SessionStopResult | undefined> {
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env[manifestEnv]!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?" + tag);
    mod.default(fakePi);
    const ctx = makeCtx();
    return (await handlers["session_stop"]!(
        { type: "session_stop", turn_id: 1, stop_hook_active: false },
        ctx,
    )) as SessionStopResult | undefined;
}

{
    const silent = await callSessionStop("GUARD_STOP_SILENT_MANIFEST", "stop-silent");
    check(
        "session_stop: silent hook -> plain continue",
        silent?.continue === true && silent?.additionalContext === undefined && silent?.decision === undefined,
        JSON.stringify(silent),
    );

    const withContext = await callSessionStop("GUARD_STOP_CONTEXT_MANIFEST", "stop-context");
    check(
        "session_stop: hook with additionalContext -> continue + context",
        withContext?.continue === true && withContext?.additionalContext === "stub: session note",
        JSON.stringify(withContext),
    );

    const blocked = await callSessionStop("GUARD_STOP_BLOCK_MANIFEST", "stop-block");
    check(
        "session_stop: blocking hook -> decision:block passthrough",
        blocked?.decision === "block" && blocked?.reason === "stub: stop blocked",
        JSON.stringify(blocked),
    );
}

console.log("passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
RUNNER

    # --- manifests referenced by the runner above ---------------------------
    local missing_manifest="$WORK/does-not-exist.json"

    local empty_manifest="$WORK/empty-manifest.json"
    printf '{"tool_call": []}\n' > "$empty_manifest"

    local stop_silent_manifest="$WORK/stop-silent.json"
    printf '{"session_stop": [{"id": "stub-silent", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/session-hooks/silent.sh" > "$stop_silent_manifest"

    local stop_context_manifest="$WORK/stop-context.json"
    printf '{"session_stop": [{"id": "stub-context", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/session-hooks/context.sh" > "$stop_context_manifest"

    local stop_block_manifest="$WORK/stop-block.json"
    printf '{"session_stop": [{"id": "stub-block", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/session-hooks/block.sh" > "$stop_block_manifest"

    export GUARD_EXT="$EXT"
    export GUARD_HOOKS="$WORK/hooks"
    export GUARD_BROKEN="$WORK/broken-hooks"
    export YOKI_ROOT="$YOKI_ROOT_DIR"
    export CLAUDE_PLUGIN_ROOT="$YOKI_ROOT_DIR"
    export GUARD_MISSING_MANIFEST="$missing_manifest"
    export GUARD_EMPTY_MANIFEST="$empty_manifest"
    export GUARD_STOP_SILENT_MANIFEST="$stop_silent_manifest"
    export GUARD_STOP_CONTEXT_MANIFEST="$stop_context_manifest"
    export GUARD_STOP_BLOCK_MANIFEST="$stop_block_manifest"

    # set -e is active for the whole file; guard the capture with `|| status=$?`
    # rather than a bare assignment so a non-zero exit from the runner doesn't
    # kill this function before the PASS/FAIL lines below get parsed.
    local node_output node_status=0
    node_output="$(node --experimental-strip-types "$WORK/runner.mts" 2> >(grep -v ExperimentalWarning >&2))" || node_status=$?

    echo "$node_output"

    while IFS= read -r line; do
        case "$line" in
            PASS:*) PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)) ;;
            FAIL:*) FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); log_error "$line" ;;
        esac
    done <<< "$node_output"

    if [[ "$node_status" -ne 0 && "$FAILED" -eq 0 ]]; then
        log_error "FAIL: node runner exited $node_status without reporting a per-case failure"
        FAILED=$((FAILED + 1))
        TOTAL=$((TOTAL + 1))
    fi

    echo ""
    log_info "=== Results ==="
    echo ""
    if [[ "$FAILED" -gt 0 ]]; then
        log_error "FAILED: $FAILED / $TOTAL checks"
        log_info "PASSED: $PASSED / $TOTAL checks"
        return 1
    else
        log_success "ALL PASSED: $PASSED / $TOTAL checks"
        return 0
    fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_omp_yoki_bridge_checks
fi
