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
#   4. `--resume` through the real CLI, asserting it is a PREFIX replay: an
#      identical rerun replays every call and spawns none, while a rerun
#      whose args change the first call's prompt replays nothing — not even
#      the later calls whose prompts are byte-identical to recorded ones.
#   5. Model visibility and refusals through the real CLI: `--backend claude`
#      is refused by name, a misspelled `--model` tier is refused with the
#      valid tiers listed, and every agent event carries the RESOLVED model
#      id rather than the tier the script asked for.
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

assert_not_contains() {
    local description="$1" needle="$2" haystack="$3"
    if grep -qF -- "$needle" <<< "$haystack"; then
        fail "$description"
        log_error "  did not want: $needle"
        log_error "  got:          $(head -3 <<< "$haystack")"
    else
        pass "$description"
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

# Same, but the caller supplies the --args value and any extra flags (e.g.
# --resume <runId>) — used by the resume checks below, which need to vary the
# args to force a divergence.
run_cli_with() {
    local home="$1" repo="$2" stdout="$3" stderr="$4" json_args="$5"
    shift 5
    CLI_STATUS=0
    env -u YOKI_STATE_HOME -u YOKI_GRAPH_GUARD_STATE_DIR -u WORKFLOW_GUARD_DISABLED -u YOKI_WORKFLOW_DAILY_CAP \
        YOKI_WORKFLOW_DAILY_CAP=20 \
        HOME="$home" \
        node "$GRAPH_BIN" run review --backend mock --mock "$REVIEW_FIXTURE" \
            --args "$json_args" --cwd "$repo" --json "$@" \
        > "$stdout" 2> "$stderr" || CLI_STATUS=$?
    return 0
}

# Runs an arbitrary workflow FILE (not the `review` name) so a check can use
# a script written for it. review.js sets `model` on every agent() call, so a
# run-level `--model` never reaches a call there — the wrong shape for
# asserting run-level model resolution.
run_cli_script() {
    local home="$1" repo="$2" stdout="$3" stderr="$4" script="$5" backend="$6"
    shift 6
    CLI_STATUS=0
    env -u YOKI_STATE_HOME -u YOKI_GRAPH_GUARD_STATE_DIR -u WORKFLOW_GUARD_DISABLED -u YOKI_WORKFLOW_DAILY_CAP \
        YOKI_WORKFLOW_DAILY_CAP=20 \
        HOME="$home" \
        node "$GRAPH_BIN" run "$script" --backend "$backend" --cwd "$repo" --json "$@" \
        > "$stdout" 2> "$stderr" || CLI_STATUS=$?
    return 0
}

# A two-call workflow with no per-call model, so the run-level --model is
# what every call uses.
write_plain_workflow() {
    cat > "$1" <<'WORKFLOW'
export const meta = { name: 'plain', description: 'two calls, no per-call model', phases: [{ title: 'A' }] }
phase('A')
const a = await agent('one', { label: 'a' })
const b = await agent('two', { label: 'b' })
return [a, b]
WORKFLOW
}

count_events() {
    jq -c "select(.type == \"$2\")" "$1" 2>/dev/null | wc -l | tr -d ' '
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

# `--resume` is a prefix replay, not a key-addressed cache. Through the real
# CLI: an identical rerun replays every call and spawns none; a rerun whose
# args changed the FIRST call's prompt replays nothing at all, even though
# every later call is byte-identical to one the journal already holds.
check_resume_replay() {
    local repo="${FIXTURE_DIR}/repo-resume" home="${FIXTURE_DIR}/home-resume"
    local out1="${FIXTURE_DIR}/resume1.out" out2="${FIXTURE_DIR}/resume2.out"
    local out3="${FIXTURE_DIR}/resume3.out" err="${FIXTURE_DIR}/resume.err"
    local run_id calls

    make_temp_repo "$repo"
    setup_fake_home "$home"

    run_cli_with "$home" "$repo" "$out1" "$err" '{"range":"HEAD~1..HEAD"}'
    run_id="$(jq -r 'select(.type == "run-start").runId' "$out1" 2>/dev/null | head -n 1)"
    calls="$(count_events "$out1" agent-start)"
    if [[ -z "$run_id" || "$calls" == "0" ]]; then
        fail "case15: the first run makes agent calls and reports a runId"
        log_error "  stderr: $(head -3 "$err")"
        return
    fi
    pass "case15: the first run makes agent calls and reports a runId"

    run_cli_with "$home" "$repo" "$out2" "$err" '{"range":"HEAD~1..HEAD"}' --resume "$run_id"
    assert_eq "case16: an identical --resume replays every call" "$calls" "$(count_events "$out2" agent-cached)"
    assert_eq "case17: an identical --resume runs nothing live" "0" "$(count_events "$out2" agent-start)"

    run_cli_with "$home" "$repo" "$out3" "$err" '{"range":"HEAD~2..HEAD"}' --resume "$run_id"
    assert_eq "case18: changing the first call's prompt replays nothing" "0" "$(count_events "$out3" agent-cached)"
    assert_eq "case19: ...and every later call runs live, not from the cache" "$calls" "$(count_events "$out3" agent-start)"
    assert_json_field "case20: the divergence is reported at the call it happened on" \
        "$(jq -c 'select(.type == "resume-diverged")' "$out3" | head -n 1)" '.index' "0"
}

# The claude backend was removed (Claude Code's own Workflow tool is the
# supported path there), and a model TIER that does not exist must be
# reported with the valid ones rather than passed through to the backend.
check_refusals() {
    local repo="${FIXTURE_DIR}/repo-refuse" home="${FIXTURE_DIR}/home-refuse"
    local out="${FIXTURE_DIR}/refuse.out" err="${FIXTURE_DIR}/refuse.err"

    make_temp_repo "$repo"
    setup_fake_home "$home"

    local script="${FIXTURE_DIR}/plain.js"
    write_plain_workflow "$script"

    run_cli_script "$home" "$repo" "$out" "$err" "$script" claude
    assert_eq "case21: --backend claude exits non-zero" "1" "$CLI_STATUS"
    assert_contains "case22: the refusal points at the native Workflow tool" \
        "native Workflow tool" "$(cat "$out" "$err")"
    assert_not_contains "case22b: the script never runs under a refused backend" \
        '"type":"run-start"' "$(cat "$out")"

    run_cli_script "$home" "$repo" "$out" "$err" "$script" codex --model sonnett
    assert_eq "case23: a misspelled --model tier exits non-zero" "1" "$CLI_STATUS"
    # --json escapes the quotes around the bad tier, so match on the parsed
    # error rather than on the raw line.
    assert_contains "case23b: the refusal names the bad tier and the valid ones" \
        'unknown model tier' "$(jq -r 'select(.type == "run-end").error' "$out" 2>/dev/null)"
    assert_contains "case23d: ...listing the tiers that would have worked" \
        'valid tiers: haiku, opus, sonnet' "$(jq -r 'select(.type == "run-end").error' "$out" 2>/dev/null)"

    # A concrete id must still pass straight through, unvalidated.
    run_cli_script "$home" "$repo" "$out" "$err" "$script" codex --model gpt-5.5 --dry-run
    assert_json_field "case23c: a concrete model id passes through untouched" \
        "$(jq -c 'select(.type == "agent-start")' "$out" | head -n 1)" '.model' "gpt-5.5"
}

# The point of resolving the tier in the runner rather than inside a backend:
# what every event reports is the model that will actually run.
check_model_visibility() {
    local repo="${FIXTURE_DIR}/repo-model" home="${FIXTURE_DIR}/home-model"
    local out="${FIXTURE_DIR}/model.out" err="${FIXTURE_DIR}/model.err"

    make_temp_repo "$repo"
    setup_fake_home "$home"

    run_cli_with "$home" "$repo" "$out" "$err" '{"range":"HEAD~1..HEAD"}' \
        --model-map 'sonnet=pinned-sonnet,haiku=pinned-haiku,opus=pinned-opus'
    assert_eq "case24: a run with --model-map exits 0" "0" "$CLI_STATUS"

    local models
    models="$(jq -rc 'select(.type == "agent-start") | .model' "$out" 2>/dev/null | sort -u | tr '\n' ' ')"
    assert_eq "case25: every agent-start carries the mapped model id, not the tier" \
        "pinned-haiku pinned-opus pinned-sonnet " "$models"

    local run_end
    run_end="$(jq -c 'select(.type == "run-end")' "$out" 2>/dev/null | tail -n 1)"
    assert_json_field "case26: run-end carries a per-model breakdown" "$run_end" '.byModel | length' "3"
    assert_json_field "case27: each row counts that model's calls" "$run_end" \
        '[.byModel[] | select(.model == "pinned-opus")][0].calls' "2"
}

run_e2e_checks() {
    check_node_unit_suite
    check_review_run
    check_guard_cap
    check_resume_replay
    check_refusals
    check_model_visibility
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
