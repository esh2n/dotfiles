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
# broken-hooks fail-open, the yoki-hooks.json-absent fallback, the
# fallback-guard FLOOR (a manifest that registers no tool_call bash guard must
# not disarm git-guard/unattended-guard — a manifest may add protection, never
# remove it), a manifest that ships its own bash guard being used as-is, the
# DECLARED floor (a manifest's top-level `floor` array, generated from
# permissions.yaml's guardFloor:, is honoured per script — while a manifest
# with no `floor` still falls back to the two hardcoded names), per-hook
# argv passthrough, and the path-deny set: a `read` tool_call of a path
# denied in <OMP_AGENT_DIR>/.yoki/permissions.json is blocked end to end by
# the real pre-permission-guard.js, which on omp is the ONLY thing that can
# enforce a Read/Edit/WebFetch deny (config.yml has no key for one).
#
# HERMETIC BY CONSTRUCTION. Every scenario is driven from a throwaway $WORK,
# and the node runner is launched with HOME and OMP_AGENT_DIR redirected there
# too. Without that, the scenarios that deliberately unset YOKI_HOOKS_MANIFEST
# (to exercise the default manifest path) resolved it to the REAL
# ~/.omp/agent/yoki-hooks.json, so on any machine that had actually run
# `yoki-switch apply --target omp` the installed manifest's `floor` pulled the
# real ~/.claude/hooks/git-guard.sh into the run and 7 checks flipped to FAIL
# against unchanged code. Scenario 1b pins that shut from the other side: a
# hostile, real-looking manifest is planted under the fake HOME and must lose
# to both the explicit YOKI_HOOKS_MANIFEST and the OMP_AGENT_DIR default.
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

    # A guard that lives ONLY in a manifest — denies on its own marker, and
    # notably NOT on git-guard's 'git push --force'. Used to prove a manifest
    # that ships its own tool_call bash guard is taken as-is (the fallback is
    # not also prepended, which would run every guard twice).
    cat > "$WORK/hooks/manifest-guard.sh" <<'STUB'
#!/usr/bin/env bash
payload="$(cat)"
if echo "$payload" | grep -q 'manifest-marker'; then
    echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"stub: manifest guard"}}'
fi
STUB
    chmod +x "$WORK/hooks/manifest-guard.sh"

    # A guard that must NEVER run: it is reachable only through the hostile
    # manifest planted under the fake HOME (scenario 1b). It denies on the
    # SAME markers the stubs above do, with its own reason, so "the wrong
    # manifest was read" shows up as a wrong reason rather than as silence.
    mkdir -p "$WORK/hostile"
    cat > "$WORK/hostile/hostile-guard.sh" <<'STUB'
#!/usr/bin/env bash
payload="$(cat)"
if echo "$payload" | grep -qE 'hostile-marker|manifest-marker|git push --force'; then
    echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"HOSTILE: real-home manifest leaked"}}'
fi
STUB
    chmod +x "$WORK/hostile/hostile-guard.sh"

    # session_stop stubs, referenced by a manifest below
    mkdir -p "$WORK/session-hooks"
    printf '#!/usr/bin/env bash\ncat > /dev/null\n' > "$WORK/session-hooks/silent.sh"
    printf '#!/usr/bin/env bash\ncat > /dev/null\necho '\''{"hookSpecificOutput":{"additionalContext":"stub: session note"}}'\''\n' \
        > "$WORK/session-hooks/context.sh"
    printf '#!/usr/bin/env bash\ncat > /dev/null\necho '\''{"decision":"block","reason":"stub: stop blocked"}'\''\n' \
        > "$WORK/session-hooks/block.sh"
    # Reports back the argv it was handed, so a manifest entry's `args` can be
    # proven to reach the .sh unchanged (the personal layer's
    # `exec bash "$h" session` form).
    cat > "$WORK/session-hooks/argecho.sh" <<'STUB'
#!/usr/bin/env bash
cat > /dev/null
printf '{"hookSpecificOutput":{"additionalContext":"stub: argv=%s"}}\n' "$*"
STUB
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
// 1b. MACHINE ISOLATION. A real-looking manifest is planted at
//     $HOME/.omp/agent/yoki-hooks.json (floor + its own tool_call guard —
//     exactly the shape `yoki-switch apply --target omp` installs). It must
//     never be consulted: not when YOKI_HOOKS_MANIFEST names a manifest
//     outright, and not when only OMP_AGENT_DIR points the default elsewhere.
//     This is the regression a real `yoki-switch apply` caused — the suite
//     read the machine's installed manifest and its floor pulled the real
//     ~/.claude/hooks/git-guard.sh into scenarios 1 and 2.
// ---------------------------------------------------------------------------
{
    // (a) an explicit YOKI_HOOKS_MANIFEST beats the planted HOME manifest
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_OWN_GUARD_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?hostile-home-explicit");
    mod.default(fakePi);
    const ctx = makeCtx();

    const hostile = await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "h1", input: { command: "echo hostile-marker" } }, ctx);
    check("an explicit manifest wins over a real-looking one under HOME", hostile === undefined, JSON.stringify(hostile));

    const fixture = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "h2", input: { command: "echo manifest-marker" } }, ctx)) as { reason?: string } | undefined;
    check("the fixture manifest's guard is what ran", (fixture?.reason ?? "").includes("stub: manifest guard"), JSON.stringify(fixture));
}
{
    // (b) with no explicit manifest, the default is OMP_AGENT_DIR's — the same
    //     directory yoki-switch generates into — never HOME's.
    const savedAgentDir = process.env.OMP_AGENT_DIR!;
    process.env.OMP_AGENT_DIR = process.env.GUARD_AGENT_DIR_WITH_MANIFEST!;
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    delete process.env.YOKI_HOOKS_MANIFEST;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?hostile-home-agent-dir");
    mod.default(fakePi);
    const ctx = makeCtx();

    const r = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "h3", input: { command: "echo manifest-marker" } }, ctx)) as { block?: boolean; reason?: string } | undefined;
    check(
        "the default manifest comes from OMP_AGENT_DIR, not HOME",
        r?.block === true && (r?.reason ?? "").includes("stub: manifest guard"),
        JSON.stringify(r),
    );
    // Restored for scenario 7, which spawns the real pre-permission-guard.js
    // and resolves its permissions.json out of this same variable.
    process.env.OMP_AGENT_DIR = savedAgentDir;
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
// 4. FALLBACK FLOOR. A manifest that registers no tool_call bash guard must
//    NOT disarm the installed ones. Before this, any manifest that merely
//    parsed — `{}` included — replaced the fallback wholesale, so generating
//    yoki-hooks.json silently removed git-guard.sh / unattended-guard.sh from
//    omp: a protection downgrade caused by running the generator.
// ---------------------------------------------------------------------------
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_EMPTY_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?empty-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();
    const r = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx)) as { block?: boolean } | undefined;
    check("an empty manifest does NOT disarm the fallback bash guards", r?.block === true, JSON.stringify(r));
}

// 4b. Same floor, with a manifest that registers a js hook on tool_call but
//     still no bash guard — the js hook is a different kind of hook and can
//     never stand in for the guards.
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_JS_ONLY_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?js-only-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();
    const r = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx)) as { block?: boolean } | undefined;
    check("a js-only tool_call manifest does NOT disarm the fallback bash guards", r?.block === true, JSON.stringify(r));
}

// 4c. A manifest that DOES ship its own tool_call bash guard is authoritative:
//     the fallback is not also prepended (that would run every guard twice).
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_OWN_GUARD_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?own-guard-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();

    const own = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "echo manifest-marker" } }, ctx)) as { block?: boolean; reason?: string } | undefined;
    check("a manifest's own bash guard runs", own?.block === true && (own?.reason ?? "").includes("stub: manifest guard"), JSON.stringify(own));

    const notFallback = await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t2", input: { command: "git push --force origin main" } }, ctx);
    check("a manifest with its own bash guard is used as-is (fallback not prepended)", notFallback === undefined, JSON.stringify(notFallback));
}

// 4d. DECLARED FLOOR. A manifest with a top-level `floor` array states the
//     floor itself (the generator writes it from permissions.yaml's
//     `guardFloor:`), so the check becomes per-script rather than "is there
//     any bash guard at all". This manifest ships its own bash guard AND
//     names git-guard.sh in `floor` without registering it: the coarser
//     no-floor rule (4c) would accept it as-is; the declared floor must put
//     git-guard.sh back.
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_FLOOR_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?floor-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();

    const reAdded = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx)) as { block?: boolean; reason?: string } | undefined;
    check(
        "a declared floor re-adds a floor script the manifest omitted",
        reAdded?.block === true && (reAdded?.reason ?? "").includes("stub: force push"),
        JSON.stringify(reAdded),
    );

    const own = (await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t2", input: { command: "echo manifest-marker" } }, ctx)) as { block?: boolean } | undefined;
    check("the manifest's own guard still runs alongside the re-added floor", own?.block === true, JSON.stringify(own));
}

// 4e. A floor script the manifest ALREADY registers is not added a second
//     time — the floor is a minimum, not a duplicate-everything rule.
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_FLOOR_SATISFIED_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?floor-satisfied-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();

    writeFileSync(capture, "");
    const benign = await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "ls -la" } }, ctx);
    check("a satisfied floor still allows a benign call", benign === undefined, JSON.stringify(benign));
    check("a floor script the manifest already registers runs exactly once", capturedLines().length === 1, String(capturedLines().length));
}

// 4f. A floor entry naming a script that is not installed on this machine is
//     dropped rather than spawned — the same existsSync gate the fallback
//     applies, for the same fail-open reason.
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_FLOOR_ABSENT_SCRIPT_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?floor-absent-script-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();
    const r = await handlers["tool_call"]!({ type: "tool_call", toolName: "bash", toolCallId: "t1", input: { command: "git push --force origin main" } }, ctx);
    check("an uninstalled floor script is dropped, not spawned (fails open)", r === undefined, JSON.stringify(r));
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

// ---------------------------------------------------------------------------
// 6. A manifest entry's `args` reach the .sh unchanged — the personal layer's
//    `exec bash "$h" session` wrapper form, which omp-hooks.js now translates
//    into {kind:'bash', script, args:['session']}.
// ---------------------------------------------------------------------------
{
    const withArgs = await callSessionStop("GUARD_STOP_ARGS_MANIFEST", "stop-args");
    check(
        "manifest args are passed through to the hook script",
        withArgs?.additionalContext === "stub: argv=session",
        JSON.stringify(withArgs),
    );

    const noArgs = await callSessionStop("GUARD_STOP_NOARGS_MANIFEST", "stop-noargs");
    check(
        "a spec with no args passes none",
        noArgs?.additionalContext === "stub: argv=",
        JSON.stringify(noArgs),
    );
}

// ---------------------------------------------------------------------------
// 7. PATH DENIES END TO END. omp's config.yml has no key for a `Read(...)` /
//    `Edit(...)` / `WebFetch(domain:...)` deny, so on omp the only thing that
//    can enforce one is pre-permission-guard.js reading
//    ~/.omp/agent/.yoki/permissions.json (written by lib/targets/omp.js).
//    This drives the REAL hook through the REAL runner via the extension: a
//    read of a denied path must be blocked, a read of anything else must not,
//    and a Bash call must still behave exactly as before.
// ---------------------------------------------------------------------------
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_HOOKS!;
    process.env.YOKI_HOOKS_MANIFEST = process.env.GUARD_PERMISSION_MANIFEST!;
    const { handlers, fakePi } = loadExtension();
    const mod = await import(EXT_PATH + "?permission-manifest");
    mod.default(fakePi);
    const ctx = makeCtx();

    const deniedPath = process.env.GUARD_DENIED_PATH!;
    const denied = (await handlers["tool_call"]!(
        { type: "tool_call", toolName: "read", toolCallId: "p1", input: { path: deniedPath } },
        ctx,
    )) as { block?: boolean; reason?: string } | undefined;
    check(
        "tool_call: a read of a denied path is blocked by pre-permission-guard",
        denied?.block === true && (denied?.reason ?? "").includes("Read("),
        JSON.stringify(denied),
    );

    const allowed = await handlers["tool_call"]!(
        { type: "tool_call", toolName: "read", toolCallId: "p2", input: { path: "/tmp/omp-bridge-test/notes.md" } },
        ctx,
    );
    check("tool_call: a read of an undenied path is allowed", allowed === undefined, JSON.stringify(allowed));

    const bash = await handlers["tool_call"]!(
        { type: "tool_call", toolName: "bash", toolCallId: "p3", input: { command: "ls -la" } },
        ctx,
    );
    check("tool_call: a benign bash call is unaffected by the path deny set", bash === undefined, JSON.stringify(bash));
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

    local stop_args_manifest="$WORK/stop-args.json"
    printf '{"session_stop": [{"id": "stub-args", "kind": "bash", "script": "%s", "args": ["session"]}]}\n' \
        "$WORK/session-hooks/argecho.sh" > "$stop_args_manifest"

    local stop_noargs_manifest="$WORK/stop-noargs.json"
    printf '{"session_stop": [{"id": "stub-noargs", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/session-hooks/argecho.sh" > "$stop_noargs_manifest"

    # tool_call registered, but with a js hook only — still no bash guard.
    local js_only_manifest="$WORK/js-only-manifest.json"
    printf '{"tool_call": [{"id": "noop", "kind": "js", "script": "scripts/hooks/does-not-exist.js"}]}\n' \
        > "$js_only_manifest"

    # tool_call with its OWN bash guard — authoritative, fallback not added.
    local own_guard_manifest="$WORK/own-guard-manifest.json"
    printf '{"tool_call": [{"id": "manifest-guard", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/hooks/manifest-guard.sh" > "$own_guard_manifest"

    # Same manifest, but DECLARING a floor that names a script it does not
    # register — the generated shape (a top-level `floor` array of absolute
    # paths, written from permissions.yaml's guardFloor:).
    local floor_manifest="$WORK/floor-manifest.json"
    printf '{"floor": ["%s"], "tool_call": [{"id": "manifest-guard", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/hooks/git-guard.sh" "$WORK/hooks/manifest-guard.sh" > "$floor_manifest"

    # A manifest whose tool_call already satisfies its own declared floor.
    local floor_satisfied_manifest="$WORK/floor-satisfied-manifest.json"
    printf '{"floor": ["%s"], "tool_call": [{"id": "git-guard", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/hooks/git-guard.sh" "$WORK/hooks/git-guard.sh" > "$floor_satisfied_manifest"

    # A floor naming a script that is not installed on this machine.
    local floor_absent_script_manifest="$WORK/floor-absent-script-manifest.json"
    printf '{"floor": ["%s"], "tool_call": []}\n' \
        "$WORK/hooks/not-installed.sh" > "$floor_absent_script_manifest"

    # Scenario 7: the real pre-permission-guard.js on tool_call, reading the
    # real generated file shape from a throwaway OMP_AGENT_DIR. The deny is a
    # basename glob so the fixture needs no real ~/.ssh.
    local omp_agent_dir="$WORK/omp-agent"
    mkdir -p "$omp_agent_dir/.yoki"
    printf '{"deny": [{"pattern": "Read(**/id_ed25519)", "reason": "private keys"}]}\n' \
        > "$omp_agent_dir/.yoki/permissions.json"

    # Scenario 1b: the machine's own state, simulated. A fake HOME carrying a
    # manifest in exactly the place and shape `yoki-switch apply --target omp`
    # installs one (top-level `floor` + a registered tool_call bash guard),
    # wired to the hostile guard so any leak is loud. HOME is redirected to
    # this directory for the whole node run, so homedir() inside the extension
    # resolves here and never to the developer's real ~.
    local fake_home="$WORK/fake-home"
    mkdir -p "$fake_home/.omp/agent" "$fake_home/.claude/hooks"
    printf '{"floor": ["%s"], "tool_call": [{"id": "hostile", "kind": "bash", "script": "%s"}], "session_stop": [{"id": "hostile-stop", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/hostile/hostile-guard.sh" "$WORK/hostile/hostile-guard.sh" "$WORK/hostile/hostile-guard.sh" \
        > "$fake_home/.omp/agent/yoki-hooks.json"
    # The floor's scripts are also placed where the HOME fallback would look,
    # so a leak cannot be masked by existsSync() dropping them.
    cp "$WORK/hostile/hostile-guard.sh" "$fake_home/.claude/hooks/git-guard.sh"
    cp "$WORK/hostile/hostile-guard.sh" "$fake_home/.claude/hooks/unattended-guard.sh"

    # An OMP_AGENT_DIR whose yoki-hooks.json is the benign fixture — proves the
    # default manifest path follows OMP_AGENT_DIR (where yoki-switch writes it)
    # rather than $HOME.
    local agent_dir_with_manifest="$WORK/omp-agent-with-manifest"
    mkdir -p "$agent_dir_with_manifest"
    printf '{"tool_call": [{"id": "manifest-guard", "kind": "bash", "script": "%s"}]}\n' \
        "$WORK/hooks/manifest-guard.sh" > "$agent_dir_with_manifest/yoki-hooks.json"

    local permission_manifest="$WORK/permission-manifest.json"
    printf '{"tool_call": [{"id": "pre:permission-guard", "kind": "js", "script": "scripts/hooks/pre-permission-guard.js", "profiles": ["minimal", "standard", "strict"]}]}\n' \
        > "$permission_manifest"

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
    export GUARD_STOP_ARGS_MANIFEST="$stop_args_manifest"
    export GUARD_STOP_NOARGS_MANIFEST="$stop_noargs_manifest"
    export GUARD_JS_ONLY_MANIFEST="$js_only_manifest"
    export GUARD_OWN_GUARD_MANIFEST="$own_guard_manifest"
    export GUARD_FLOOR_MANIFEST="$floor_manifest"
    export GUARD_FLOOR_SATISFIED_MANIFEST="$floor_satisfied_manifest"
    export GUARD_FLOOR_ABSENT_SCRIPT_MANIFEST="$floor_absent_script_manifest"
    export GUARD_PERMISSION_MANIFEST="$permission_manifest"
    export GUARD_AGENT_DIR_WITH_MANIFEST="$agent_dir_with_manifest"
    export GUARD_DENIED_PATH="$fake_home/.ssh/id_ed25519"
    # Read by pre-permission-guard.js itself (spawned as a grandchild of this
    # runner), which is why it is exported rather than passed as an arg.
    export OMP_AGENT_DIR="$omp_agent_dir"
    export YOKI_HOOK_PROFILE="${YOKI_HOOK_PROFILE:-standard}"

    # set -e is active for the whole file; guard the capture with `|| status=$?`
    # rather than a bare assignment so a non-zero exit from the runner doesn't
    # kill this function before the PASS/FAIL lines below get parsed.
    # HOME is redirected for the node run ONLY (a bare `export HOME` here would
    # leak into every later suite the validator runs in this same shell). With
    # it redirected, every homedir()-derived default inside the extension — the
    # manifest path when YOKI_HOOKS_MANIFEST is unset, ~/.claude/hooks when
    # YOKI_HOOKS_DIR is unset — resolves under $WORK, so the developer's real
    # ~/.omp/agent/yoki-hooks.json and ~/.claude/hooks are unreachable and
    # `yoki-switch apply` on this machine cannot change the result.
    local node_output node_status=0
    node_output="$(HOME="$fake_home" node --experimental-strip-types "$WORK/runner.mts" 2> >(grep -v ExperimentalWarning >&2))" || node_status=$?

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
