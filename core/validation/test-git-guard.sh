#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Git Guard Regression Test (test-git-guard.sh)
# -----------------------------------------------------------------------------
# Verifies domains/dev/config/claude-profiles/personal/hooks/git-guard.sh by
# piping crafted PreToolUse JSON at it (GIT_GUARD_DISABLED=0 forces it on
# regardless of the caller's environment) and asserting deny/allow.
#
# Uses a throwaway git repo + linked worktree under mktemp. The hook itself
# writes warn-once markers under the REAL ~/.claude/.cache/git-guard/<session>
# (it hardcodes $HOME), so this script uses unique session ids per case and
# cleans those markers up afterward.
#
# Usage: ./test-git-guard.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

GIT_GUARD="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/hooks/git-guard.sh"

FAILED=0
PASSED=0
TOTAL=0

REPO=""
WT=""
SESSION_PREFIX="test-git-guard-$$-"

# -----------------------------------------------------------------------------
# Fixture: repo on main + a linked worktree on feature/wt
# -----------------------------------------------------------------------------
cleanup_fixture() {
    # Session ids are generated with a PID-scoped prefix (new_session runs in
    # a $(...) subshell, so we can't accumulate ids into an array here) -
    # glob-clean every warn-once marker dir this run could have created.
    /bin/rm -rf "${HOME}/.claude/.cache/git-guard/${SESSION_PREFIX}"*
    if [[ -n "$REPO" && -d "$(dirname "$REPO")" ]]; then
        /bin/rm -rf "$(dirname "$REPO")"
    fi
}

build_fixture() {
    local root
    root="$(mktemp -d)"
    REPO="$root/repo"
    WT="$root/wt"

    mkdir -p "$REPO"
    git -C "$REPO" init -q -b main
    git -C "$REPO" config user.email "test@example.com"
    git -C "$REPO" config user.name "test"
    echo "hello" > "$REPO/file.txt"
    git -C "$REPO" add file.txt
    git -C "$REPO" commit -q -m "init" >/dev/null

    git -C "$REPO" worktree add -q -b feature/wt "$WT" main >/dev/null
}

new_session() {
    echo "${SESSION_PREFIX}${RANDOM}-${RANDOM}"
}

# -----------------------------------------------------------------------------
# Test helpers
# -----------------------------------------------------------------------------
make_json() {
    local cmd="$1" cwd="$2" session="$3" transcript="${4:-}"
    jq -cn --arg cmd "$cmd" --arg cwd "$cwd" --arg session "$session" \
           --arg transcript "$transcript" \
        '{tool_name: "Bash", tool_input: {command: $cmd}, session_id: $session, cwd: $cwd}
         + (if $transcript == "" then {} else {transcript_path: $transcript} end)'
}

run_guard() {
    local json="$1"
    GIT_GUARD_DISABLED=0 bash "$GIT_GUARD" <<< "$json"
}

assert_deny() {
    local description="$1" json="$2"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(run_guard "$json")
    if echo "$out" | grep -q '"permissionDecision":"deny"'; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected deny, got: '${out:-<empty>}')"
        FAILED=$((FAILED + 1))
    fi
}

assert_allow() {
    local description="$1" json="$2"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(run_guard "$json")
    if [[ -z "$out" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected allow/empty, got: '$out')"
        FAILED=$((FAILED + 1))
    fi
}

# pr-gate release: disclosure instruction WITHOUT any permissionDecision —
# an explicit allow would pre-approve the entire Bash command, so the gate
# must stay silent toward the permission system.
assert_release() {
    local description="$1" json="$2"
    TOTAL=$((TOTAL + 1))
    local out
    out=$(run_guard "$json")
    if echo "$out" | grep -q 'preflight did not pass' \
       && ! echo "$out" | grep -q '"permissionDecision"'; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected release+disclosure, got: '${out:-<empty>}')"
        FAILED=$((FAILED + 1))
    fi
}

# -----------------------------------------------------------------------------
# Test suite
# -----------------------------------------------------------------------------
run_git_guard_checks() {
    log_info "=== Git Guard Test Suite ==="
    echo ""

    build_fixture
    trap cleanup_fixture RETURN

    # 1. force push (-f) -> deny always
    assert_deny "case1: force push -f blocked" \
        "$(make_json "git push -f origin x" "$REPO" "$(new_session)")"

    # 2. force push (--force) -> deny always
    assert_deny "case2: force push --force blocked" \
        "$(make_json "git push --force origin x" "$REPO" "$(new_session)")"

    # 3. push to main -> deny always
    assert_deny "case3: push origin main blocked" \
        "$(make_json "git push origin main" "$REPO" "$(new_session)")"

    # 4. reset --hard chained after cd -> deny always
    assert_deny "case4: reset --hard blocked after cd chain" \
        "$(make_json "cd /tmp && git reset --hard HEAD~1" "$REPO" "$(new_session)")"

    # 5. commit on main in main worktree: warn-once (deny first, allow retry)
    s5="$(new_session)"
    json5="$(make_json 'git commit -m "wip"' "$REPO" "$s5")"
    assert_deny "case5a: commit on main (main worktree) denied first time" "$json5"
    assert_allow "case5b: commit on main (main worktree) allowed on retry (same session)" "$json5"

    # 6. commit in linked worktree -> allow
    assert_allow "case6: commit in linked worktree allowed" \
        "$(make_json 'git commit -m "wip"' "$WT" "$(new_session)")"

    # 7. push feature branch in worktree -> allow
    assert_allow "case7: push feature branch in worktree allowed" \
        "$(make_json "git push origin feature/wt" "$WT" "$(new_session)")"

    # 8. log --grep containing a denied-looking string -> no false positive
    assert_allow "case8: git log --grep with 'git push origin main' in message is not a false positive" \
        "$(make_json 'git log --grep "git push origin main"' "$REPO" "$(new_session)")"

    # 9. --force-with-lease: warn-once (deny first, allow retry)
    s9="$(new_session)"
    json9="$(make_json "git push --force-with-lease origin feature/wt" "$WT" "$s9")"
    assert_deny "case9a: --force-with-lease denied first time" "$json9"
    assert_allow "case9b: --force-with-lease allowed on retry (same session)" "$json9"

    # 10. gh pr create without a preflight marker -> deny
    assert_deny "case10: gh pr create without preflight marker denied" \
        "$(make_json "gh pr create --title x --body y" "$WT" "$(new_session)")"

    # 11. gh pr create with a matching marker -> allow
    mkdir -p "$WT/.claude/.cache/preflight"
    pr_base="$(git -C "$WT" merge-base main HEAD)"
    git -C "$WT" diff --no-ext-diff --no-color "$pr_base" | shasum -a 256 | cut -d' ' -f1 \
        > "$WT/.claude/.cache/preflight/feature_wt.pass"
    assert_allow "case11: gh pr create with matching preflight marker allowed" \
        "$(make_json "gh pr create --title x --body y" "$WT" "$(new_session)")"

    # 12. content changed after preflight (hash mismatch) -> deny
    echo "drift" >> "$WT/file.txt"
    assert_deny "case12: gh pr create after content change denied" \
        "$(make_json "gh pr create --title x --body y" "$WT" "$(new_session)")"

    # 13. 3rd attempt for the same content: released with disclosure instruction
    s13="$(new_session)"
    json13="$(make_json "gh pr create --title x --body y" "$WT" "$s13")"
    assert_deny "case13a: hash mismatch denied (attempt 1)" "$json13"
    assert_deny "case13b: hash mismatch denied (attempt 2)" "$json13"
    assert_release "case13c: 3rd attempt released with disclosure instruction" "$json13"

    # 14. quoted mention of gh pr create in another command -> not gated
    assert_allow "case14: quoted 'gh pr create' inside another command is not gated" \
        "$(make_json 'git log --grep "gh pr create"' "$WT" "$(new_session)")"

    # 15. --no-verify belonging to another tool in a compound command -> allow
    assert_allow "case15: unrelated --no-verify in compound command is not a false positive" \
        "$(make_json 'npm test -- --no-verify && git commit -m fix' "$WT" "$(new_session)")"

    # 16. quoting the flag does not evade the deny
    assert_deny "case16: quoted '--no-verify' still denied" \
        "$(make_json "git commit -m fix '--no-verify'" "$WT" "$(new_session)")"

    # 17. quoting the verb does not evade the pr-gate (marker is stale here)
    assert_deny "case17: gh \"pr\" create still gated" \
        "$(make_json 'gh "pr" create --title x --body y' "$WT" "$(new_session)")"

    # 18. plain --no-verify on commit -> deny
    assert_deny "case18: git commit --no-verify denied" \
        "$(make_json "git commit --no-verify -m fix" "$WT" "$(new_session)")"

    # --- .yoki.json allowMainBranchWork -------------------------------------
    # Personal repos where main is the working branch. The flag must lift the
    # branch-policy rules and nothing else, so each relaxed case is paired with
    # a damage-control rule that has to stay denied under the same flag.
    assert_deny "case19: push to main denied without the flag" \
        "$(make_json "git push origin main" "$REPO" "$(new_session)")"

    echo '{"allowMainBranchWork": true}' > "$REPO/.yoki.json"

    assert_allow "case20: push to main allowed with the flag" \
        "$(make_json "git push origin main" "$REPO" "$(new_session)")"
    assert_allow "case21: push while standing on main allowed with the flag" \
        "$(make_json "git push" "$REPO" "$(new_session)")"
    assert_allow "case22: commit on main no longer warns with the flag" \
        "$(make_json "git commit -m fix" "$REPO" "$(new_session)")"
    mkdir -p "$REPO/sub/deeper"
    assert_allow "case23: flag is found from a subdirectory" \
        "$(make_json "git push origin main" "$REPO/sub/deeper" "$(new_session)")"

    assert_deny "case24: force push still denied under the flag" \
        "$(make_json "git push -f origin main" "$REPO" "$(new_session)")"
    assert_deny "case25: reset --hard still denied under the flag" \
        "$(make_json "git reset --hard HEAD~1" "$REPO" "$(new_session)")"
    assert_deny "case26: --no-verify still denied under the flag" \
        "$(make_json "git commit --no-verify -m fix" "$REPO" "$(new_session)")"

    # A flag set to anything but true, or malformed JSON, must not relax.
    echo '{"allowMainBranchWork": "yes"}' > "$REPO/.yoki.json"
    assert_deny "case27: non-boolean flag does not relax" \
        "$(make_json "git push origin main" "$REPO" "$(new_session)")"
    echo 'not json' > "$REPO/.yoki.json"
    assert_deny "case28: malformed .yoki.json does not relax" \
        "$(make_json "git push origin main" "$REPO" "$(new_session)")"
    /bin/rm -f "$REPO/.yoki.json"

    # --- shared-checkout nudge ----------------------------------------------
    # A transcript directory with a second, recently-touched session file is
    # what "another session is live here" means. Build one, and an equivalent
    # with only a stale sibling, to pin both directions.
    local tdir stale_dir mine
    tdir="$(mktemp -d)"
    stale_dir="$(mktemp -d)"
    mine="$tdir/mysession.jsonl"
    : > "$mine"
    : > "$tdir/othersession.jsonl"
    : > "$stale_dir/mysession.jsonl"
    : > "$stale_dir/othersession.jsonl"
    touch -t 202501010000 "$stale_dir/othersession.jsonl"

    assert_deny "case29: branch switch warns while another session is live" \
        "$(make_json "git switch other" "$REPO" "mysession" "$mine")"
    assert_allow "case30: re-running the same switch proceeds (warn-once)" \
        "$(make_json "git switch other" "$REPO" "mysession" "$mine")"

    assert_deny "case31: checkout -b warns too" \
        "$(make_json "git checkout -b newbranch" "$REPO" "$(new_session)" "$mine")"
    assert_deny "case32: checkout of an existing branch warns" \
        "$(make_json "git checkout feature/wt" "$REPO" "$(new_session)" "$mine")"

    # Precision: a path argument only restores a file, so it must not warn.
    assert_allow "case33: checkout of a file path does not warn" \
        "$(make_json "git checkout file.txt" "$REPO" "$(new_session)" "$mine")"

    assert_allow "case34: no warning when no other session is live" \
        "$(make_json "git switch other" "$REPO" "mysession" "$stale_dir/mysession.jsonl")"
    assert_allow "case35: no warning inside a linked worktree" \
        "$(make_json "git switch other" "$WT" "$(new_session)" "$mine")"
    assert_allow "case36: no warning without a transcript path" \
        "$(make_json "git switch other" "$REPO" "$(new_session)")"

    # The nudge is about concurrency, not branch policy: allowMainBranchWork
    # must not switch it off.
    echo '{"allowMainBranchWork": true}' > "$REPO/.yoki.json"
    assert_deny "case37: allowMainBranchWork does not suppress the nudge" \
        "$(make_json "git switch other" "$REPO" "$(new_session)" "$mine")"
    /bin/rm -f "$REPO/.yoki.json"
    /bin/rm -rf "$tdir" "$stale_dir"

    cleanup_fixture
    trap - RETURN

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

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_git_guard_checks
fi
