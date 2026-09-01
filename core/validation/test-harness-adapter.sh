#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Harness Adapter Contract Test (test-harness-adapter.sh)
# -----------------------------------------------------------------------------
# `node --test` (wired separately in validator.sh's "harness-adapter" case)
# already covers scripts/lib/harness/{payload,response,session} and
# scripts/hooks/{run-bash-hook,run-with-flags-harness,artifact-comments} with
# fixture-driven unit tests. Those never touch a real hook script, so a
# regression in the wiring between the runners and an ACTUAL yoki hook would
# slip through.
#
# This script drives the two real harness runners —
#   node run-with-flags.js <hookId> <relScriptPath> <profiles> --harness <h>
#   node run-bash-hook.js --harness <h> <hook.sh>
# — against two REAL hooks (git-guard.sh, config-protection.js), feeding
# each one golden claude/codex/omp-shaped payloads for five scenarios
# (PreToolUse Bash allow, PreToolUse Bash deny, PreToolUse apply_patch/
# multi-path fan-out, Stop, SessionStart) and asserts the harness-shaped
# output documented in scripts/lib/harness/response.js: empty passthrough
# for claude/codex "no opinion", {} / {continue:true} for omp, exit-2+stderr
# for a claude deny, permissionDecision JSON for a codex deny, {block,reason}
# for an omp deny.
#
# Usage: ./test-harness-adapter.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

YOKI_ROOT_DIR="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki"
GIT_GUARD="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/hooks/git-guard.sh"
RUN_BASH_HOOK="${YOKI_ROOT_DIR}/scripts/hooks/run-bash-hook.js"
RUN_WITH_FLAGS="${YOKI_ROOT_DIR}/scripts/hooks/run-with-flags.js"

run_harness_adapter_checks() {
    log_info "=== Harness Adapter Contract Test Suite ==="
    echo ""

    if ! command -v node >/dev/null 2>&1; then
        log_error "FAIL: node is not installed — the harness runners cannot execute without it."
        return 1
    fi

    local FAILED=0 PASSED=0 TOTAL=0
    local WORK
    WORK="$(mktemp -d)"
    # Double-quoted so $WORK is baked in now, at registration time — WORK is
    # local to this function and would be unbound by the time an EXIT trap
    # fires (after this function has already returned).
    trap "/bin/rm -rf '$WORK'" EXIT

    local PROJ="$WORK/proj"
    mkdir -p "$PROJ"
    local OK_FILE="$PROJ/ok.js"
    local CFG_FILE="$PROJ/.eslintrc.json"
    : > "$OK_FILE"
    : > "$CFG_FILE"

    pass() {
        PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1))
        log_success "PASS: $1"
    }
    fail() {
        FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1))
        log_error "FAIL: $1 -- $2"
    }

    # Runs $RUN_BASH_HOOK against git-guard.sh for the given harness, feeding
    # $2 (a payload file) on stdin. Sets OUT and STATUS globals (avoids a
    # subshell so `local status=$?` under `set -e` can't be lost).
    run_git_guard() {
        local harness="$1" payload_file="$2"
        STATUS=0
        OUT="$(GIT_GUARD_DISABLED=0 node "$RUN_BASH_HOOK" --harness "$harness" "$GIT_GUARD" < "$payload_file" 2>/dev/null)" || STATUS=$?
    }

    # Runs $RUN_WITH_FLAGS against config-protection.js, mirroring the exact
    # hookId/relScriptPath/profiles settings.layer.json wires it with.
    # stdout+stderr are merged here (unlike run_git_guard): a claude-harness
    # deny from config-protection.js carries its reason on stderr (exit 2 +
    # stderr, the classic Claude PreToolUse-deny convention), while codex/omp
    # render the same deny fully into stdout JSON — merging lets one
    # assertion shape cover both without caring which stream carried it.
    run_config_protection() {
        local harness="$1" payload_file="$2"
        STATUS=0
        OUT="$(CLAUDE_PLUGIN_ROOT="$YOKI_ROOT_DIR" YOKI_HOOK_PROFILE=standard \
            node "$RUN_WITH_FLAGS" "pre:config-protection" "scripts/hooks/config-protection.js" "standard,strict" \
            --harness "$harness" < "$payload_file" 2>&1)" || STATUS=$?
    }

    # -------------------------------------------------------------------
    # Golden payloads
    # -------------------------------------------------------------------

    # 1/2: PreToolUse Bash allow / deny — claude and codex share a wire
    # shape for a plain Bash tool call (normalizeCodex is near-identity for
    # tool_name "Bash"), so one fixture per case covers both harnesses.
    local bash_allow="$WORK/bash_allow.json"
    cat > "$bash_allow" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"echo hi"}}
JSON

    local bash_deny="$WORK/bash_deny.json"
    cat > "$bash_deny" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}
JSON

    local omp_bash_allow="$WORK/omp_bash_allow.json"
    cat > "$omp_bash_allow" <<JSON
{"event":"tool_call","payload":{"type":"tool_call","toolName":"bash","toolCallId":"call-allow","input":{"command":"echo hi"}},"ctx":{"session_id":"s1","session_file":"/tmp/s.jsonl","cwd":"$PROJ","model":"gpt-5.4-mini"}}
JSON

    local omp_bash_deny="$WORK/omp_bash_deny.json"
    cat > "$omp_bash_deny" <<JSON
{"event":"tool_call","payload":{"type":"tool_call","toolName":"bash","toolCallId":"call-deny","input":{"command":"git push --force origin main"}},"ctx":{"session_id":"s1","session_file":"/tmp/s.jsonl","cwd":"$PROJ","model":"gpt-5.4-mini"}}
JSON

    # 3: PreToolUse apply_patch / multi-path fan-out via config-protection.js.
    # Claude has no native apply_patch tool, so its leg is the harness-
    # appropriate equivalent: a single Edit straight at the protected file
    # (no fan-out mechanics to exercise, since a Claude PreToolUse event is
    # already exactly one tool call). Codex and omp each carry a genuine
    # two-file patch (one clean file, one protected+existing config) that
    # payload.js fans out into two Claude-shaped payloads combined by
    # combineDecisions — first deny wins.
    local claude_patch="$WORK/claude_patch.json"
    cat > "$claude_patch" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"$CFG_FILE"}}
JSON

    local codex_patch="$WORK/codex_patch.json"
    node -e '
const [, cwd, ok, cfg, out] = process.argv;
const fs = require("fs");
const patch = `*** Begin Patch\n*** Update File: ${ok}\n@@\n-a\n+b\n*** Update File: ${cfg}\n@@\n-c\n+d\n*** End Patch`;
const payload = {
  session_id: "s1", turn_id: "t1", transcript_path: "/tmp/t.jsonl", cwd,
  hook_event_name: "PreToolUse", model: "gpt-5.6-sol", permission_mode: "bypassPermissions",
  tool_name: "apply_patch", tool_input: { command: patch }
};
fs.writeFileSync(out, JSON.stringify(payload) + "\n");
' "$PROJ" "$OK_FILE" "$CFG_FILE" "$codex_patch"

    local omp_patch="$WORK/omp_patch.json"
    node -e '
const [, cwd, ok, cfg, out] = process.argv;
const fs = require("fs");
const hashline = `[${ok}#1a2b]\nb\n[${cfg}#3c4d]\nd\n`;
const payload = {
  event: "tool_call",
  payload: { type: "tool_call", toolName: "edit", toolCallId: "call-patch", input: { input: hashline } },
  ctx: { session_id: "s1", session_file: "/tmp/s.jsonl", cwd, model: "gpt-5.4-mini" }
};
fs.writeFileSync(out, JSON.stringify(payload) + "\n");
' "$PROJ" "$OK_FILE" "$CFG_FILE" "$omp_patch"

    # 4/5: Stop and SessionStart — git-guard.sh only opines on Bash tool
    # calls, so both events are a pure "no opinion" pass-through for every
    # harness. That is exactly the point: it pins the per-harness *shape* of
    # "nothing to say" (raw pass-through for claude/codex, {} / {continue:
    # true} for omp) rather than any guard decision.
    local claude_stop="$WORK/claude_stop.json"
    cat > "$claude_stop" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"Stop","stop_hook_active":false}
JSON

    local codex_stop="$WORK/codex_stop.json"
    cat > "$codex_stop" <<JSON
{"session_id":"s1","turn_id":"t1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"Stop","model":"gpt-5.6-sol","permission_mode":"bypassPermissions","stop_hook_active":false,"last_assistant_message":"done"}
JSON

    local omp_stop="$WORK/omp_stop.json"
    cat > "$omp_stop" <<JSON
{"event":"session_stop","payload":{"type":"session_stop","turn_id":1,"session_id":"s1","session_file":"/tmp/s.jsonl","stop_hook_active":false},"ctx":{"session_id":"s1","session_file":"/tmp/s.jsonl","cwd":"$PROJ","model":"gpt-5.4-mini"}}
JSON

    local claude_start="$WORK/claude_start.json"
    cat > "$claude_start" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"SessionStart","source":"startup"}
JSON

    local codex_start="$WORK/codex_start.json"
    cat > "$codex_start" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"SessionStart","model":"gpt-5.6-sol","permission_mode":"bypassPermissions","source":"startup"}
JSON

    local omp_start="$WORK/omp_start.json"
    cat > "$omp_start" <<JSON
{"event":"session_start","payload":{"type":"session_start"},"ctx":{"session_id":"s1","session_file":"/tmp/s.jsonl","cwd":"$PROJ","model":"gpt-5.4-mini"}}
JSON

    # -------------------------------------------------------------------
    # 1. PreToolUse Bash allow (git-guard.sh)
    # -------------------------------------------------------------------
    run_git_guard claude "$bash_allow"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] && pass "claude: benign Bash -> allow (empty, exit 0)" \
        || fail "claude: benign Bash -> allow" "status=$STATUS out=$OUT"

    run_git_guard codex "$bash_allow"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] && pass "codex: benign Bash -> allow (empty, exit 0)" \
        || fail "codex: benign Bash -> allow" "status=$STATUS out=$OUT"

    run_git_guard omp "$omp_bash_allow"
    [[ "$STATUS" -eq 0 && "$OUT" == "{}" ]] && pass "omp: benign Bash -> allow ({})" \
        || fail "omp: benign Bash -> allow" "status=$STATUS out=$OUT"

    # -------------------------------------------------------------------
    # 2. PreToolUse Bash deny via git-guard (force push, always-deny tier)
    # -------------------------------------------------------------------
    run_git_guard claude "$bash_deny"
    [[ "$STATUS" -eq 0 && "$OUT" == *'"permissionDecision":"deny"'* && "$OUT" == *"Force push blocked"* ]] \
        && pass "claude: force-push -> deny (hookSpecificOutput JSON)" \
        || fail "claude: force-push -> deny" "status=$STATUS out=$OUT"

    run_git_guard codex "$bash_deny"
    [[ "$STATUS" -eq 0 && "$OUT" == *'"permissionDecision":"deny"'* && "$OUT" == *"Force push blocked"* ]] \
        && pass "codex: force-push -> deny (hookSpecificOutput JSON)" \
        || fail "codex: force-push -> deny" "status=$STATUS out=$OUT"

    run_git_guard omp "$omp_bash_deny"
    [[ "$STATUS" -eq 0 && "$OUT" == '{"block":true,"reason":'*'Force push blocked'*'}' ]] \
        && pass "omp: force-push -> deny ({block:true, reason})" \
        || fail "omp: force-push -> deny" "status=$STATUS out=$OUT"

    # -------------------------------------------------------------------
    # 3. PreToolUse apply_patch / multi-path fan-out (config-protection.js)
    # -------------------------------------------------------------------
    run_config_protection claude "$claude_patch"
    [[ "$STATUS" -eq 2 && "$OUT" == *"Modifying .eslintrc.json is not allowed"* ]] \
        && pass "claude: Edit on protected config -> deny (exit 2 + stderr)" \
        || fail "claude: Edit on protected config -> deny" "status=$STATUS out=$OUT"

    run_config_protection codex "$codex_patch"
    [[ "$STATUS" -eq 0 && "$OUT" == *'"permissionDecision":"deny"'* && "$OUT" == *"Modifying .eslintrc.json is not allowed"* ]] \
        && pass "codex: apply_patch fan-out combines to deny on the protected file" \
        || fail "codex: apply_patch fan-out -> deny" "status=$STATUS out=$OUT"

    run_config_protection omp "$omp_patch"
    [[ "$STATUS" -eq 0 && "$OUT" == '{"block":true,"reason":'*'Modifying .eslintrc.json is not allowed'*'}' ]] \
        && pass "omp: hashline fan-out combines to deny on the protected file" \
        || fail "omp: hashline fan-out -> deny" "status=$STATUS out=$OUT"

    # -------------------------------------------------------------------
    # 4. Stop — no opinion, but a distinct wire shape per harness
    # -------------------------------------------------------------------
    run_git_guard claude "$claude_stop"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] && pass "claude: Stop -> no opinion (empty, exit 0)" \
        || fail "claude: Stop -> no opinion" "status=$STATUS out=$OUT"

    run_git_guard codex "$codex_stop"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] && pass "codex: Stop -> no opinion (empty, exit 0)" \
        || fail "codex: Stop -> no opinion" "status=$STATUS out=$OUT"

    run_git_guard omp "$omp_stop"
    [[ "$STATUS" -eq 0 && "$OUT" == '{"continue":true}' ]] && pass "omp: Stop -> no opinion ({continue:true})" \
        || fail "omp: Stop -> no opinion" "status=$STATUS out=$OUT"

    # -------------------------------------------------------------------
    # 5. SessionStart — same "no opinion", different event category on omp
    # -------------------------------------------------------------------
    run_git_guard claude "$claude_start"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] && pass "claude: SessionStart -> no opinion (empty, exit 0)" \
        || fail "claude: SessionStart -> no opinion" "status=$STATUS out=$OUT"

    run_git_guard codex "$codex_start"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] && pass "codex: SessionStart -> no opinion (empty, exit 0)" \
        || fail "codex: SessionStart -> no opinion" "status=$STATUS out=$OUT"

    run_git_guard omp "$omp_start"
    [[ "$STATUS" -eq 0 && "$OUT" == "{}" ]] && pass "omp: SessionStart -> no opinion ({})" \
        || fail "omp: SessionStart -> no opinion" "status=$STATUS out=$OUT"

    # -------------------------------------------------------------------
    # 6. Codex read-side deny (Gap B). Codex has no dedicated read tool — a
    #    file read shells out as `cat`/`sed`/… (tool_name "Bash"), so a
    #    Read(glob) deny is enforced only by pre-permission-guard parsing the
    #    command. This drives the REAL runner + REAL hook against a codex
    #    <CODEX_DIR>/.yoki/permissions.json, the same file lib/targets/codex.js
    #    writes, and asserts the shell read of a denied path is blocked while a
    #    benign read passes.
    # -------------------------------------------------------------------
    local codex_dir="$WORK/codex-home"
    mkdir -p "$codex_dir/.yoki"
    printf '{"deny":[{"pattern":"Read(**/.env)","reason":"env files"}]}\n' > "$codex_dir/.yoki/permissions.json"

    local codex_read_deny="$WORK/codex_read_deny.json"
    cat > "$codex_read_deny" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cat .env"}}
JSON
    local codex_read_ok="$WORK/codex_read_ok.json"
    cat > "$codex_read_ok" <<JSON
{"session_id":"s1","transcript_path":"/tmp/t.jsonl","cwd":"$PROJ","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"cat README.md"}}
JSON

    run_permission_guard() {
        local harness="$1" payload_file="$2"
        STATUS=0
        OUT="$(CLAUDE_PLUGIN_ROOT="$YOKI_ROOT_DIR" YOKI_HOOK_PROFILE=standard CODEX_DIR="$codex_dir" \
            node "$RUN_WITH_FLAGS" "pre:permission-guard" "scripts/hooks/pre-permission-guard.js" "minimal,standard,strict" \
            --harness "$harness" < "$payload_file" 2>&1)" || STATUS=$?
    }

    run_permission_guard codex "$codex_read_deny"
    [[ "$STATUS" -eq 0 && "$OUT" == *'"permissionDecision":"deny"'* && "$OUT" == *"Read(**/.env)"* ]] \
        && pass "codex: shell read of a denied path (cat .env) -> deny" \
        || fail "codex: shell read of a denied path -> deny" "status=$STATUS out=$OUT"

    run_permission_guard codex "$codex_read_ok"
    [[ "$STATUS" -eq 0 && -z "$OUT" ]] \
        && pass "codex: shell read of an undenied path (cat README.md) -> allow" \
        || fail "codex: shell read of an undenied path -> allow" "status=$STATUS out=$OUT"

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
    run_harness_adapter_checks
fi
