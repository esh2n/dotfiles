#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# yoki-graph Contract Test (test-yoki-graph.sh)
# -----------------------------------------------------------------------------
# Exercises yoki-graph the way a caller actually reaches it:
#   1. `node --test` over lib/graph/test — the module-level unit suites
#      (guard, journal, runner, backends, api surface, worktree, scripts).
#   2. `yoki-graph run review --backend mock --mock <fixture> --args '{...}'`
#      through the real CLI (domains/dev/bin/yoki-graph), inside a throwaway
#      git repo with one commit, resolving "review" by NAME the way a real
#      launch would (~/.claude/workflows/review.js) — but against a scrubbed
#      HOME so this never touches the real machine's workflows, journal
#      (~/.local/state/yoki/graph), or daily-cap counter
#      (~/.claude/.cache/workflow-guard). Asserts the run-end event carries a
#      JSON result with a `findings` array (the fixture's one confirmed
#      correctness finding survives review + verify).
#   3. The same CLI call against a second scrubbed HOME whose daily-cap
#      counter is pre-filled at the cap, asserting the guard denies the
#      launch (guard.js — the same counter file workflow-guard.sh's real
#      PreToolUse hook shares) before the script ever runs.
#
# Nothing here touches the real ~/.claude/workflows, ~/.claude/.cache, or
# ~/.local/state: every CLI invocation runs under its own temp HOME.
#
# Usage: ./test-yoki-graph.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

PROFILES_ROOT="${DOTFILES_ROOT}/domains/dev/config/claude-profiles"
LIB_GRAPH="${PROFILES_ROOT}/runtime/yoki/scripts/lib/graph"
GRAPH_BIN="${DOTFILES_ROOT}/domains/dev/bin/yoki-graph"
REVIEW_WORKFLOW="${PROFILES_ROOT}/core/workflows/review.js"
REVIEW_FIXTURE="${LIB_GRAPH}/test/fixtures/review.mock.json"

FAILED=0
PASSED=0
TOTAL=0

# Set by run_yoki_graph_checks; removed in full on the way out.
FIXTURE_DIR=""

# -----------------------------------------------------------------------------
# Assertions
# -----------------------------------------------------------------------------

pass() {
    TOTAL=$((TOTAL + 1))
    PASSED=$((PASSED + 1))
    log_success "PASS: $1"
}

fail() {
    TOTAL=$((TOTAL + 1))
    FAILED=$((FAILED + 1))
    log_error "FAIL: $1"
}

assert_eq() {
    local description="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        pass "$description"
    else
        fail "$description"
        log_error "  wanted: $expected"
        log_error "  got:    $actual"
    fi
}

assert_contains() {
    local description="$1" needle="$2" haystack="$3"
    if grep -qF -- "$needle" <<< "$haystack"; then
        pass "$description"
    else
        fail "$description"
        log_error "  wanted: $needle"
        log_error "  got:    $(head -3 <<< "$haystack")"
    fi
}

# Runs a jq filter against a JSON string already in hand (one NDJSON line
# pulled out of the CLI's --json stream), not a file.
assert_json_field() {
    local description="$1" json="$2" filter="$3" expected="$4" actual
    actual="$(jq -r "$filter" <<< "$json" 2>/dev/null)" || actual="<not JSON>"
    assert_eq "$description" "$expected" "$actual"
}

# -----------------------------------------------------------------------------
# Prerequisites
# -----------------------------------------------------------------------------

prerequisites_ok() {
    if ! has_command node; then
        log_warn "SKIP: node is not installed — nothing to assert against"
        return 1
    fi
    if ! has_command jq; then
        log_warn "SKIP: jq is not installed — nothing to assert JSON with"
        return 1
    fi
    if ! has_command git; then
        log_warn "SKIP: git is not installed — the review workflow needs a repo to point at"
        return 1
    fi
    return 0
}

# -----------------------------------------------------------------------------
# Fixtures
# -----------------------------------------------------------------------------

make_temp_repo() {
    local dir="$1"
    mkdir -p "$dir"
    git init -q "$dir"
    git -C "$dir" config user.email "test@example.com"
    git -C "$dir" config user.name "Test"
    echo "hello" > "${dir}/README.md"
    git -C "$dir" add README.md
    git -C "$dir" commit -q -m "initial commit"
}

# A scrubbed HOME with just enough of ~/.claude/workflows for `run review` to
# resolve the workflow BY NAME (runner.js's workflowsDir() is
# ~/.claude/workflows, hardcoded off os.homedir() — no env override exists,
# so a real name-based resolution can only be tested by pointing HOME
# somewhere throwaway). Symlinked, not copied, so the CLI always runs against
# this worktree's own review.js.
setup_fake_home() {
    local home="$1"
    mkdir -p "${home}/.claude/workflows"
    ln -sf "$REVIEW_WORKFLOW" "${home}/.claude/workflows/review.js"
}

# Runs the CLI with a scrubbed HOME (isolates ~/.claude/workflows,
# ~/.claude/.cache/workflow-guard, and ~/.local/state/yoki/graph, all of
# which key off os.homedir()) and none of the guard/journal override env vars
# leaking in from the outer shell. Sets CLI_STATUS and writes to $1 (stdout)
# / $2 (stderr).
run_cli() {
    local home="$1" repo="$2" stdout="$3" stderr="$4"
    CLI_STATUS=0
    env -u YOKI_STATE_HOME -u YOKI_GRAPH_GUARD_STATE_DIR -u WORKFLOW_GUARD_DISABLED -u YOKI_WORKFLOW_DAILY_CAP \
        "${@:5}" \
        HOME="$home" \
        node "$GRAPH_BIN" run review --backend mock --mock "$REVIEW_FIXTURE" \
            --args '{"range":"HEAD~1..HEAD"}' --cwd "$repo" --json \
        > "$stdout" 2> "$stderr" || CLI_STATUS=$?
    return 0
}

# -----------------------------------------------------------------------------
# Checks
# -----------------------------------------------------------------------------

check_node_unit_suite() {
    if (cd "$LIB_GRAPH" && node --test test/*.test.js) > "${FIXTURE_DIR}/node-test.log" 2>&1; then
        pass "case1: lib/graph/test node --test suite passes"
    else
        fail "case1: lib/graph/test node --test suite passes"
        log_error "  $(tail -10 "${FIXTURE_DIR}/node-test.log")"
    fi
}

check_review_run() {
    local repo="${FIXTURE_DIR}/repo" home="${FIXTURE_DIR}/home-review"
    local out="${FIXTURE_DIR}/review.out" err="${FIXTURE_DIR}/review.err"

    make_temp_repo "$repo"
    setup_fake_home "$home"

    run_cli "$home" "$repo" "$out" "$err"
    assert_eq "case2: yoki-graph run review --backend mock exits 0" "0" "$CLI_STATUS"
    [[ "$CLI_STATUS" == "0" ]] || log_error "  stderr: $(head -5 "$err")"

    local run_end
    run_end="$(jq -c 'select(.type == "run-end")' "$out" 2>/dev/null | tail -n 1)"
    if [[ -z "$run_end" ]]; then
        fail "case3: a run-end event is emitted"
        log_error "  stdout: $(head -5 "$out")"
        return
    fi
    pass "case3: a run-end event is emitted"

    assert_json_field "case4: the run ends ok" "$run_end" '.status' "ok"
    assert_json_field "case5: the result carries a findings array" "$run_end" '.result.findings | type' "array"
    assert_json_field "case6: the fixture's one confirmed finding survives review+verify" "$run_end" '.result.findings | length' "1"
    assert_json_field "case7: the finding names the file the fixture reported" "$run_end" '.result.findings[0].file' "pkg/foo.go"
}

check_guard_cap() {
    local repo="${FIXTURE_DIR}/repo-cap" home="${FIXTURE_DIR}/home-cap"
    local out="${FIXTURE_DIR}/cap.out" err="${FIXTURE_DIR}/cap.err"
    local today counter_file

    make_temp_repo "$repo"
    setup_fake_home "$home"

    # Pre-fill the daily-cap counter (guard.js's exact file: HOME/.claude/
    # .cache/workflow-guard/count-YYYYMMDD) AT the cap, so the very first
    # launch this test makes is already over budget.
    today="$(date +%Y%m%d)"
    counter_file="${home}/.claude/.cache/workflow-guard/count-${today}"
    mkdir -p "$(dirname "$counter_file")"
    printf '1' > "$counter_file"

    run_cli "$home" "$repo" "$out" "$err" YOKI_WORKFLOW_DAILY_CAP=1
    assert_eq "case8: a launch at the daily cap exits non-zero" "1" "$CLI_STATUS"

    local denied
    denied="$(jq -c 'select(.type == "guard-denied")' "$out" 2>/dev/null | tail -n 1)"
    if [[ -z "$denied" ]]; then
        fail "case9: a guard-denied event is emitted"
        log_error "  stdout: $(head -5 "$out")"
        return
    fi
    pass "case9: a guard-denied event is emitted"

    local message
    message="$(jq -r '.message' <<< "$denied" 2>/dev/null)"
    assert_contains "case10: the denial names the cap that was hit" "Workflow daily cap reached (1/1)" "$message"

    local started
    started="$(jq -c 'select(.type == "run-start")' "$out" 2>/dev/null | tail -n 1)"
    if [[ -z "$started" ]]; then
        pass "case11: the run never starts once the guard denies it"
    else
        fail "case11: the run never starts once the guard denies it"
    fi
}

# This file is the only thing that runs lib/graph/test and the CLI e2e
# checks, so it is worthless unless the runner actually calls it. Asserted
# statically rather than by invoking validator.sh, which would re-enter this
# very suite.
check_validator_wiring() {
    local validator="${SCRIPT_DIR}/validator.sh"

    if grep -qE '^\s+yoki-graph\s*$' "$validator"; then
        pass "case12: validator.sh runs yoki-graph in its default (no-args) pass"
    else
        fail "case12: validator.sh runs yoki-graph in its default (no-args) pass"
    fi

    if grep -qF '"yoki-graph")' "$validator"; then
        pass "case13: validator.sh accepts \`validator.sh yoki-graph\`"
    else
        fail "case13: validator.sh accepts \`validator.sh yoki-graph\`"
    fi

    if grep -q 'Usage: \$0 .*|yoki-graph|' "$validator"; then
        pass "case14: validator.sh usage line lists yoki-graph"
    else
        fail "case14: validator.sh usage line lists yoki-graph"
    fi
}

run_e2e_checks() {
    check_node_unit_suite
    check_review_run
    check_guard_cap
    check_validator_wiring
}

run_yoki_graph_checks() {
    log_info "=== yoki-graph Contract Test Suite ==="
    echo ""

    prerequisites_ok || return 0

    FIXTURE_DIR="$(mktemp -d)"
    # `|| true` disarms errexit for the whole subtree, so an unexpected
    # failure inside a check still reaches the cleanup below instead of
    # leaking the temp dir.
    run_e2e_checks || true
    rm -rf "$FIXTURE_DIR"

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
    run_yoki_graph_checks
fi
