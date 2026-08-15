#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Unattended Guard Regression Test (test-unattended-guard.sh)
# -----------------------------------------------------------------------------
# Verifies domains/dev/config/claude-profiles/personal/hooks/unattended-guard.sh
# by piping crafted PreToolUse JSON at it and asserting deny/allow, with the
# unattended flag toggled via YOKI_UNATTENDED and via a .yoki.json fixture.
#
# Usage: ./test-unattended-guard.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

UNATTENDED_GUARD="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/hooks/unattended-guard.sh"

FAILED=0
PASSED=0
TOTAL=0

make_edit_json() {
    local file="$1" cwd="$2"
    jq -cn --arg f "$file" --arg cwd "$cwd" \
        '{tool_name: "Edit", tool_input: {file_path: $f}, session_id: "test", cwd: $cwd}'
}

make_bash_json() {
    local cmd="$1" cwd="$2"
    jq -cn --arg c "$cmd" --arg cwd "$cwd" \
        '{tool_name: "Bash", tool_input: {command: $c}, session_id: "test", cwd: $cwd}'
}

run_guard() {
    local unattended="$1" json="$2"
    YOKI_UNATTENDED="$unattended" UNATTENDED_GUARD_DISABLED=0 bash "$UNATTENDED_GUARD" <<< "$json"
}

assert_deny() {
    local description="$1" unattended="$2" json="$3"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(run_guard "$unattended" "$json")
    if echo "$out" | grep -q '"permissionDecision":"deny"'; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected deny, got: '${out:-<empty>}')"
        FAILED=$((FAILED + 1))
    fi
}

assert_allow() {
    local description="$1" unattended="$2" json="$3"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(run_guard "$unattended" "$json")
    if [[ -z "$out" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected allow/empty, got: '$out')"
        FAILED=$((FAILED + 1))
    fi
}

run_unattended_guard_checks() {
    log_info "=== Unattended Guard Test Suite ==="
    echo ""

    local work
    work="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "/bin/rm -rf '$work'" RETURN

    # 1. attended session: everything passes through
    assert_allow "case1: attended session edits ~/.claude freely" "" \
        "$(make_edit_json "$HOME/.claude/settings.json" "$work")"

    # 2. unattended: installed config edit denied
    assert_deny "case2: unattended edit of ~/.claude denied" "1" \
        "$(make_edit_json "$HOME/.claude/settings.json" "$work")"

    # 3. unattended: guardrail source edit denied
    assert_deny "case3: unattended edit of claude-profiles source denied" "1" \
        "$(make_edit_json "$work/dotfiles/domains/dev/config/claude-profiles/personal/hooks/git-guard.sh" "$work")"

    # 4. unattended: normal project file allowed
    assert_allow "case4: unattended edit of normal project file allowed" "1" \
        "$(make_edit_json "$work/project/src/main.go" "$work")"

    # 5. unattended: claude-switch denied
    assert_deny "case5: unattended claude-switch denied" "1" \
        "$(make_bash_json "claude-switch apply" "$work")"

    # 6. unattended: redirect into ~/.claude denied
    assert_deny "case6: unattended redirect into ~/.claude denied" "1" \
        "$(make_bash_json "echo x > ~/.claude/foo.json" "$work")"

    # 7. unattended: quoted mention of claude-switch is not a false positive
    assert_allow "case7: quoted claude-switch mention allowed" "1" \
        "$(make_bash_json 'echo "claude-switch is neat"' "$work")"

    # 8. .yoki.json unattended:true marks the session without the env var
    echo '{"unattended": true}' > "$work/.yoki.json"
    assert_deny "case8: .yoki.json unattended flag denies ~/.claude edit" "" \
        "$(make_edit_json "$HOME/.claude/settings.json" "$work")"
    /bin/rm -f "$work/.yoki.json"

    # 9. wrapper prefixes do not slip past the claude-switch check
    assert_deny "case9: env claude-switch denied" "1" \
        "$(make_bash_json "env claude-switch apply" "$work")"

    # 10. quoting the redirect target does not evade the ~/.claude check
    assert_deny "case10: quoted redirect into ~/.claude denied" "1" \
        "$(make_bash_json 'echo x > "$HOME/.claude/foo.json"' "$work")"

    # 11. non-redirect writers (cp/mv/...) into ~/.claude denied
    assert_deny "case11: cp into ~/.claude denied" "1" \
        "$(make_bash_json "cp /tmp/x.json ~/.claude/settings.json" "$work")"

    # 12. even reads of ~/.claude are blocked while unattended (by design)
    assert_deny "case12: cat ~/.claude denied while unattended" "1" \
        "$(make_bash_json "cat ~/.claude/settings.json" "$work")"

    # 13. path traversal does not dodge the file_path prefix match
    assert_deny "case13: ..-laden edit path denied" "1" \
        "$(make_edit_json "$work/project/../../.claude/settings.json" "$work")"

    # 14. write-ish command into guardrail sources denied
    assert_deny "case14: cp into claude-profiles sources denied" "1" \
        "$(make_bash_json "cp /tmp/evil.sh $work/dotfiles/domains/dev/config/claude-profiles/personal/hooks/x.sh" "$work")"

    # 15. reading guardrail sources stays allowed
    assert_allow "case15: ls of claude-profiles sources allowed" "1" \
        "$(make_bash_json "ls $work/dotfiles/domains/dev/config/claude-profiles/" "$work")"

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
    run_unattended_guard_checks
fi
