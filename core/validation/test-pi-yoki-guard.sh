#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# pi yoki-guard Contract Test (test-pi-yoki-guard.sh)
# -----------------------------------------------------------------------------
# The pi extension domains/dev/config/pi/extensions/yoki-guard.ts does not
# implement any rules — it translates pi's tool calls into Claude Code's
# PreToolUse schema and pipes them at the real hooks. So the thing that can
# break is the TRANSLATION, not the rules:
#
#   pi bash  {command}  ->  {tool_name:"Bash",  tool_input:{command}}
#   pi write {path}     ->  {tool_name:"Write", tool_input:{file_path}}
#   pi edit  {path}     ->  {tool_name:"Edit",  tool_input:{file_path}}
#
# Get a field name wrong (pi says `path`, the hooks say `file_path`) or a tool
# name's case wrong and every check silently passes everything. This builds the
# exact payload the extension builds and asserts the hooks act on it.
#
# It also pins the mapping against the INSTALLED pi, so a schema change upstream
# fails here instead of quietly disarming the guard.
#
# Usage: ./test-pi-yoki-guard.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

EXT="${DOTFILES_ROOT}/domains/dev/config/pi/extensions/yoki-guard.ts"
GIT_GUARD="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/hooks/git-guard.sh"
UNATTENDED="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/hooks/unattended-guard.sh"

FAILED=0
PASSED=0
TOTAL=0

REPO=""
SESSION_PREFIX="test-pi-guard-$$-"

cleanup_fixture() {
    /bin/rm -rf "${HOME}/.claude/.cache/git-guard/${SESSION_PREFIX}"*
    if [[ -n "$REPO" && -d "$(dirname "$REPO")" ]]; then
        /bin/rm -rf "$(dirname "$REPO")"
    fi
}

build_fixture() {
    local root
    root="$(mktemp -d)"
    REPO="$root/repo"
    mkdir -p "$REPO"
    git -C "$REPO" init -q -b main
    git -C "$REPO" config user.email "test@example.com"
    git -C "$REPO" config user.name "test"
    echo "hello" > "$REPO/file.txt"
    git -C "$REPO" add file.txt
    git -C "$REPO" commit -q -m "init" >/dev/null
}

# Mirrors toPreToolUse() in the extension. Kept as a separate implementation on
# purpose: if the extension's mapping drifts from this, the pin below catches it.
make_payload() {
    local tool="$1" arg="$2" session="$3" cwd="$4"
    case "$tool" in
        bash)  jq -cn --arg a "$arg" --arg s "$session" --arg c "$cwd" \
                   '{tool_name:"Bash", tool_input:{command:$a}, session_id:$s, cwd:$c, transcript_path:""}' ;;
        write) jq -cn --arg a "$arg" --arg s "$session" --arg c "$cwd" \
                   '{tool_name:"Write", tool_input:{file_path:$a}, session_id:$s, cwd:$c, transcript_path:""}' ;;
        edit)  jq -cn --arg a "$arg" --arg s "$session" --arg c "$cwd" \
                   '{tool_name:"Edit", tool_input:{file_path:$a}, session_id:$s, cwd:$c, transcript_path:""}' ;;
    esac
}

new_session() { echo "${SESSION_PREFIX}${RANDOM}-${RANDOM}"; }

assert_deny() {
    local description="$1" hook="$2" payload="$3" env_prefix="${4:-}"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(echo "$payload" | env ${env_prefix} GIT_GUARD_DISABLED=0 UNATTENDED_GUARD_DISABLED=0 bash "$hook" 2>/dev/null)
    if grep -q '"permissionDecision":"deny"' <<< "$out"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected deny, got '${out:-<empty>}')"
        FAILED=$((FAILED + 1))
    fi
}

assert_allow() {
    local description="$1" hook="$2" payload="$3" env_prefix="${4:-}"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(echo "$payload" | env ${env_prefix} GIT_GUARD_DISABLED=0 UNATTENDED_GUARD_DISABLED=0 bash "$hook" 2>/dev/null)
    if [[ -z "$out" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected allow, got '$out')"
        FAILED=$((FAILED + 1))
    fi
}

assert_grep() {
    local description="$1" pattern="$2" file="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$pattern" "$file"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (missing: $pattern)"
        FAILED=$((FAILED + 1))
    fi
}

run_pi_yoki_guard_checks() {
    log_info "=== pi yoki-guard Contract Test Suite ==="
    echo ""

    trap cleanup_fixture EXIT
    build_fixture

    # --- the translated payload actually reaches the rules -------------------
    assert_deny "case1: bash -> Bash reaches the force-push rule" "$GIT_GUARD" \
        "$(make_payload bash "git push -f origin main" "$(new_session)" "$REPO")"
    assert_deny "case2: bash -> Bash reaches the --no-verify rule" "$GIT_GUARD" \
        "$(make_payload bash "git commit --no-verify -m x" "$(new_session)" "$REPO")"
    assert_deny "case3: bash -> Bash reaches the reset --hard rule" "$GIT_GUARD" \
        "$(make_payload bash "git reset --hard HEAD~1" "$(new_session)" "$REPO")"
    assert_allow "case4: an ordinary command passes" "$GIT_GUARD" \
        "$(make_payload bash "ls -la" "$(new_session)" "$REPO")"

    # The .yoki.json relaxation must reach pi too, or pi would be stricter than
    # Claude Code in the same repo.
    echo '{"allowMainBranchWork": true}' > "$REPO/.yoki.json"
    assert_allow "case5: allowMainBranchWork reaches pi's payload" "$GIT_GUARD" \
        "$(make_payload bash "git push origin main" "$(new_session)" "$REPO")"
    /bin/rm -f "$REPO/.yoki.json"
    assert_deny "case6: without the flag the same push is denied" "$GIT_GUARD" \
        "$(make_payload bash "git push origin main" "$(new_session)" "$REPO")"

    # --- write/edit translation: file_path, not pi's `path` ------------------
    assert_deny "case7: write -> Write is seen by the unattended guard" "$UNATTENDED" \
        "$(make_payload write "$HOME/.claude/settings.json" "$(new_session)" "$REPO")" \
        "YOKI_UNATTENDED=1"
    assert_deny "case8: edit -> Edit is seen by the unattended guard" "$UNATTENDED" \
        "$(make_payload edit "/x/domains/dev/config/claude-profiles/personal/hooks/h.sh" "$(new_session)" "$REPO")" \
        "YOKI_UNATTENDED=1"
    assert_allow "case9: an ordinary file is untouched when unattended" "$UNATTENDED" \
        "$(make_payload write "$REPO/src.ts" "$(new_session)" "$REPO")" \
        "YOKI_UNATTENDED=1"
    assert_allow "case10: attended sessions are untouched" "$UNATTENDED" \
        "$(make_payload write "$HOME/.claude/settings.json" "$(new_session)" "$REPO")"

    # --- the extension's own mapping matches the payloads above --------------
    # Cheap pins, but they are what catches a rename during a refactor.
    assert_grep "case11: extension maps bash to Bash" 'tool_name: "Bash"' "$EXT"
    assert_grep "case12: extension maps write to Write with file_path" \
        'tool_name: "Write", tool_input: { file_path: input.path }' "$EXT"
    assert_grep "case13: extension maps edit to Edit with file_path" \
        'tool_name: "Edit", tool_input: { file_path: input.path }' "$EXT"
    assert_grep "case14: extension consults git-guard" '"git-guard.sh"' "$EXT"
    assert_grep "case15: extension consults the unattended guard" '"unattended-guard.sh"' "$EXT"

    # --- pin against the installed pi ----------------------------------------
    # pi's builtin tools take `path` (not `file_path`) and `command`. If a pi
    # upgrade renames these, the extension reads undefined and passes
    # everything — silently. Fail here instead.
    TOTAL=$((TOTAL + 1))
    local pi_bin tools_dir
    pi_bin="$(command -v pi || true)"
    if [[ -z "$pi_bin" ]]; then
        log_warn "SKIP: pi is not installed — cannot pin its tool schema"
        TOTAL=$((TOTAL - 1))
    else
        tools_dir="$(dirname "$(readlink -f "$pi_bin")")/core/tools"
        if [[ -f "$tools_dir/write.js" ]] \
           && grep -A14 'Type.Object({' "$tools_dir/write.js" | grep -qE '^\s+path:' \
           && grep -A14 'Type.Object({' "$tools_dir/edit.js"  | grep -qE '^\s+path:' \
           && grep -A14 'Type.Object({' "$tools_dir/bash.js"  | grep -qE '^\s+command:'; then
            log_success "PASS: case16: installed pi still uses path/command as mapped"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case16: pi's tool schema changed — re-check toPreToolUse()"
            FAILED=$((FAILED + 1))
        fi
    fi

    # --- runtime: drive the real extension with a fake pi --------------------
    # Everything above tests the payload. This loads the extension itself and
    # calls its tool_call handler, so a bug in the spawn/parse/block path shows
    # up here rather than the first time pi is asked to force-push.
    TOTAL=$((TOTAL + 1))
    local harness out
    harness="$(mktemp -d)/harness.mjs"
    cat > "$harness" <<'HARNESS'
// Loaded through jiti — the loader pi itself depends on — rather than node's
// --experimental-strip-types. Not a style choice: the sandbox image ships a
// node built without TypeScript support, so strip-types would report a failure
// that pi does not actually have.
const [, , EXT, REPO, JITI] = process.argv;
const { createJiti } = await import(JITI);
const mod = await createJiti(import.meta.url).import(EXT);
let onToolCall = null;
let onSessionStart = null;
const fakePi = {
  on(e, h) {
    if (e === "tool_call") onToolCall = h;
    if (e === "session_start") onSessionStart = h;
  },
  registerTool() {},
  registerCommand() {},
};
const notices = [];
const ctx = {
  cwd: REPO,
  ui: { notify: (m) => notices.push(m) },
  sessionManager: { getSessionId: () => "harness", getSessionFile: () => "" },
};
await mod.default(fakePi);
const call = async (toolName, input) => {
  if (!onToolCall) return { blocked: false };
  const r = await onToolCall({ toolName, toolCallId: "t", input }, ctx);
  return { blocked: !!r?.block };
};
console.log(
  JSON.stringify({
    registered: !!onToolCall,
    warned: !!onSessionStart,
    force: (await call("bash", { command: "git push -f origin main" })).blocked,
    plain: (await call("bash", { command: "ls -la" })).blocked,
    read: (await call("read", { path: "/etc/passwd" })).blocked,
  }),
);
HARNESS

    # jiti ships inside pi; without pi there is nothing to test against anyway.
    local jiti
    jiti="$(dirname "$(readlink -f "$(command -v pi 2>/dev/null)" 2>/dev/null)" 2>/dev/null)/../node_modules/jiti/lib/jiti.mjs"
    if [[ ! -f "$jiti" ]]; then
        log_warn "SKIP: jiti not found under the installed pi — runtime cases not run"
        TOTAL=$((TOTAL - 1))
    else
        out=$(GIT_GUARD_DISABLED=0 node "$harness" "$EXT" "$REPO" "$jiti" 2>/dev/null || echo '{}')
        if [[ "$(jq -r '.registered' <<< "$out")" == "true" ]] \
           && [[ "$(jq -r '.force' <<< "$out")" == "true" ]] \
           && [[ "$(jq -r '.plain' <<< "$out")" == "false" ]] \
           && [[ "$(jq -r '.read' <<< "$out")" == "false" ]]; then
            log_success "PASS: case17: extension blocks force push, passes ordinary calls"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case17: extension runtime behaviour (got $out)"
            FAILED=$((FAILED + 1))
        fi

        # A hook broken mid-merge once killed every Bash call in every Claude
        # session. The pi side must not repeat that: it fails open.
        TOTAL=$((TOTAL + 1))
        local broken; broken="$(mktemp -d)"
        printf '#!/usr/bin/env bash\n<<<<<<< HEAD\nif [ then\n' > "$broken/git-guard.sh"
        out=$(GIT_GUARD_DISABLED=0 YOKI_HOOKS_DIR="$broken" \
              node "$harness" "$EXT" "$REPO" "$jiti" 2>/dev/null || echo '{}')
        if [[ "$(jq -r '.registered' <<< "$out")" == "true" ]] \
           && [[ "$(jq -r '.force' <<< "$out")" == "false" ]]; then
            log_success "PASS: case18: a syntactically broken hook fails open"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case18: a syntactically broken hook fails open (got $out)"
            FAILED=$((FAILED + 1))
        fi

        # With no hooks installed the guard must announce itself rather than
        # look present while enforcing nothing.
        TOTAL=$((TOTAL + 1))
        local empty; empty="$(mktemp -d)"
        out=$(GIT_GUARD_DISABLED=0 YOKI_HOOKS_DIR="$empty" \
              node "$harness" "$EXT" "$REPO" "$jiti" 2>/dev/null || echo '{}')
        if [[ "$(jq -r '.registered' <<< "$out")" == "false" ]] \
           && [[ "$(jq -r '.warned' <<< "$out")" == "true" ]]; then
            log_success "PASS: case19: missing hooks warn instead of guarding silently"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case19: missing hooks warn instead of guarding silently (got $out)"
            FAILED=$((FAILED + 1))
        fi
        /bin/rm -rf "$broken" "$empty"
    fi
    /bin/rm -rf "$(dirname "$harness")"

    # --- install wiring -------------------------------------------------------
    # The guard is worthless if it is not installed, and the same wiring carries
    # the agents. Before this was declarative only claude-worker.md was linked,
    # so /yoki-review called five reviewers that did not exist. Run the real
    # linker against a throwaway HOME and check everything lands.
    TOTAL=$((TOTAL + 1))
    local fake_home missing
    fake_home="$(mktemp -d)"
    HOME="$fake_home" bash -c "
        source '${DOTFILES_ROOT}/core/utils/common.sh'
        source '${DOTFILES_ROOT}/core/config/manager.sh'
        link_pi_resources '${DOTFILES_ROOT}/domains/dev/config/pi'
    " >/dev/null 2>&1 || true

    missing=""
    for want in "$(basename "$EXT")"; do
        [[ -e "${fake_home}/.pi/agent/extensions/${want}" ]] || missing="${missing} extensions/${want}"
    done
    while IFS= read -r agent; do
        [[ -e "${fake_home}/.pi/agent/agents/$(basename "$agent")" ]] \
            || missing="${missing} agents/$(basename "$agent")"
    done < <(find "${DOTFILES_ROOT}/domains/dev/config/pi/agents" -maxdepth 1 -name '*.md')
    [[ -e "${fake_home}/.pi/agent/settings.json" ]] || missing="${missing} settings.json"
    [[ -e "${fake_home}/.pi/agent/prompts" ]] || missing="${missing} prompts"

    if [[ -z "$missing" ]]; then
        log_success "PASS: case20: every pi resource is installed into ~/.pi/agent"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case20: not installed:${missing}"
        FAILED=$((FAILED + 1))
    fi
    /bin/rm -rf "$fake_home"

    # Every agent the review prompt names must exist, or the workflow dies
    # partway through with no output.
    TOTAL=$((TOTAL + 1))
    local prompt_file absent
    prompt_file="${DOTFILES_ROOT}/domains/dev/config/pi/prompts/yoki-review.md"
    absent=""
    if [[ -f "$prompt_file" ]]; then
        while IFS= read -r name; do
            [[ -f "${DOTFILES_ROOT}/domains/dev/config/pi/agents/${name}.md" ]] || absent="${absent} ${name}"
        done < <(grep -oE '[a-z]+-(reviewer|worker)' "$prompt_file" | sort -u)
    fi
    if [[ -z "$absent" ]]; then
        log_success "PASS: case21: every agent yoki-review names exists"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case21: yoki-review names missing agents:${absent}"
        FAILED=$((FAILED + 1))
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
    run_pi_yoki_guard_checks
fi
