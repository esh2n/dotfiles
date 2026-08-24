#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# omp yoki-guard Contract Test (test-omp-yoki-guard.sh)
# -----------------------------------------------------------------------------
# The omp extension domains/dev/config/omp/extensions/yoki-guard.ts does not
# implement any rules — it translates omp's tool calls into Claude Code's
# PreToolUse schema and pipes them at the hooks. So the thing that can break is
# the TRANSLATION, not the rules:
#
#   omp bash  {command}         -> {tool_name:"Bash",  tool_input:{command}}
#   omp write {path}            -> {tool_name:"Write", tool_input:{file_path}}
#   omp edit  {input:"[P#TAG]"} -> {tool_name:"Edit",  tool_input:{file_path}} per path
#
# Unlike the pi version, edit consumes hashline patches (and apply_patch
# envelopes), so path EXTRACTION is itself translation logic under test. This
# loads the real extension under node --experimental-strip-types with a fake
# HookAPI and stub hooks, and asserts payload shapes, deny propagation, and
# fail-open behavior. It needs neither omp nor bun installed.
#
# Usage: ./test-omp-yoki-guard.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

EXT="${DOTFILES_ROOT}/domains/dev/config/omp/extensions/yoki-guard.ts"

if ! command -v node >/dev/null 2>&1; then
    echo "SKIP: node not installed"
    exit 0
fi

WORK="$(mktemp -d)"
trap '/bin/rm -rf "$WORK"' EXIT

# --- stub hooks ---------------------------------------------------------------
# git-guard stub: records every payload it receives, denies two markers.
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

# broken hooks dir for the fail-open test
mkdir -p "$WORK/broken-hooks"
printf '#!/usr/bin/env bash\ncat > /dev/null\nexit 1\n' > "$WORK/broken-hooks/git-guard.sh"
printf 'this is not bash {{{' > "$WORK/broken-hooks/unattended-guard.sh"
chmod +x "$WORK/broken-hooks/"*.sh

export GUARD_CAPTURE="$WORK/capture.jsonl"
: > "$GUARD_CAPTURE"

# --- node runner ---------------------------------------------------------------
cat > "$WORK/runner.mts" <<'RUNNER'
const { pathToFileURL } = await import("node:url");
const EXT_PATH = pathToFileURL(process.env.GUARD_EXT!).href;

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail = "") {
    if (cond) { passed++; console.log("PASS: " + name); }
    else { failed++; console.log("FAIL: " + name + (detail ? " — " + detail : "")); }
}

function makeFakePi() {
    const handlers: Record<string, (event: unknown, ctx: unknown) => Promise<unknown>> = {};
    return {
        handlers,
        api: { on(event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) { handlers[event] = handler; } },
    };
}
const notices: string[] = [];
const ctx = {
    cwd: "/tmp/omp-guard-test",
    sessionManager: { getSessionId: () => "omp-test-session", getSessionFile: () => "/tmp/omp-test.jsonl" },
    ui: { notify: (text: string) => { notices.push(text); } },
};
const call = (handlers: Record<string, (e: unknown, c: unknown) => Promise<unknown>>, toolName: string, input: Record<string, unknown>) =>
    handlers["tool_call"]!({ type: "tool_call", toolName, toolCallId: "t1", input }, ctx);

const mod = await import(EXT_PATH);
const { readFileSync, writeFileSync } = await import("node:fs");
const capture = process.env.GUARD_CAPTURE!;
const capturedLines = () => readFileSync(capture, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// --- normal hooks dir ---
{
    const fake = makeFakePi();
    mod.default(fake.api);
    check("registers tool_call handler", typeof fake.handlers["tool_call"] === "function");

    // 1. bash deny propagates
    const r1 = (await call(fake.handlers, "bash", { command: "git push --force origin main" })) as { block?: boolean; reason?: string } | undefined;
    check("bash force-push is blocked", r1?.block === true, JSON.stringify(r1));
    check("deny reason carried through", (r1?.reason ?? "").includes("force push"));

    // 2. benign bash allowed + payload shape pinned
    writeFileSync(capture, "");
    const r2 = await call(fake.handlers, "bash", { command: "ls -la" });
    check("benign bash is allowed", r2 === undefined);
    const p2 = capturedLines()[0];
    check("bash payload shape", p2?.tool_name === "Bash" && p2?.tool_input?.command === "ls -la", JSON.stringify(p2));
    check("payload carries session context", p2?.session_id === "omp-test-session" && p2?.cwd === ctx.cwd);

    // 3. write maps path -> file_path
    writeFileSync(capture, "");
    const r3 = (await call(fake.handlers, "write", { path: "src/blocked.txt", content: "x" })) as { block?: boolean } | undefined;
    check("write deny propagates", r3?.block === true);
    const p3 = capturedLines()[0];
    check("write payload shape", p3?.tool_name === "Write" && p3?.tool_input?.file_path === "src/blocked.txt", JSON.stringify(p3));

    // 4. edit hashline: extracts every [PATH#TAG] section
    writeFileSync(capture, "");
    const hashline = "[src/ok.ts#1A2B]\nPUT 4.=4:\n+const a = 1;\n[src/blocked.txt#C3D4]\nPUT 1.=1:\n+x\n";
    const r4 = (await call(fake.handlers, "edit", { input: hashline })) as { block?: boolean } | undefined;
    check("edit hashline deny propagates", r4?.block === true);
    const editPaths = capturedLines().filter((p) => p.tool_name === "Edit").map((p) => p.tool_input.file_path);
    check("edit hashline extracts all paths", editPaths.includes("src/ok.ts") && editPaths.includes("src/blocked.txt"), JSON.stringify(editPaths));

    // 5. apply_patch envelope extraction
    writeFileSync(capture, "");
    const patch = "*** Begin Patch\n*** Update File: src/blocked.txt\n@@\n-x\n+y\n*** End Patch";
    const r5 = (await call(fake.handlers, "apply_patch", { input: patch })) as { block?: boolean } | undefined;
    check("apply_patch envelope deny propagates", r5?.block === true);

    // 6. replace-mode edit with plain path
    writeFileSync(capture, "");
    const r6 = (await call(fake.handlers, "edit", { path: "src/blocked.txt", old: "a", new: "b" })) as { block?: boolean } | undefined;
    check("replace-mode edit path is guarded", r6?.block === true);

    // 7. unmapped tool sends nothing
    writeFileSync(capture, "");
    const r7 = await call(fake.handlers, "read", { path: "/etc/passwd" });
    check("unmapped tool is ignored", r7 === undefined && capturedLines().length === 0);
}

// --- broken hooks dir: fail-open ---
{
    process.env.YOKI_HOOKS_DIR = process.env.GUARD_BROKEN!;
    const mod2 = await import(EXT_PATH + "?broken");
    const fake = makeFakePi();
    mod2.default(fake.api);
    const r = await call(fake.handlers, "bash", { command: "git push --force origin main" });
    check("broken hooks fail OPEN (no block)", r === undefined, JSON.stringify(r));
}

console.log("passed=" + passed + " failed=" + failed);
process.exit(failed === 0 ? 0 : 1);
RUNNER

export GUARD_EXT="$EXT"
export GUARD_BROKEN="$WORK/broken-hooks"
export YOKI_HOOKS_DIR="$WORK/hooks"
if node --experimental-strip-types "$WORK/runner.mts" 2> >(grep -v ExperimentalWarning >&2); then
    echo "OK: omp yoki-guard contract holds"
else
    echo "FAILED: omp yoki-guard contract broken"
    exit 1
fi
