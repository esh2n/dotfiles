#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# yoki-switch Targets Integration Test (test-yoki-switch-targets.sh)
# -----------------------------------------------------------------------------
# Verifies domains/dev/bin/yoki-switch's `apply --target codex|omp`
# integration (task T12): it runs the REAL claude-profiles sources (this
# checkout's core + enabled packs + personal — the generator internals
# already have their own unit coverage under
# runtime/yoki/scripts/lib/targets/test/*.test.js), with only
# CLAUDE_DIR / CODEX_DIR / OMP_AGENT_DIR / HOME redirected to a throwaway
# fixture, so the real ~/.claude, ~/.codex, ~/.omp/agent, and ~/.agents on
# this machine are never touched. YOKI_ROOT/CLAUDE_PLUGIN_ROOT/DOTFILES_ROOT
# are pinned explicitly too (rather than relying on whatever the calling
# shell happens to have exported) so the test is hermetic regardless of the
# environment it runs in — see test-merge-settings.sh for the same pattern.
# `--here` keeps yoki-switch on this checkout even when it is a git
# worktree (yoki-switch's default is to redirect a worktree invocation to
# the main checkout, which is right for a human's `yoki-switch apply` and
# wrong for testing this checkout's own code).
#
# Seeds CODEX_DIR with foreign content a real machine would already have —
# a herdr-style hooks.json group and a config.toml with a [projects] trust
# table plus an unrelated [hooks.state] entry — and asserts:
#   1. that foreign content survives byte-for-byte
#   2. that yoki's own managed block/hook group is present alongside it
#   3. that a second run is idempotent (identical file tree, not just "ran
#      again without error")
#   4. that a target whose home dir does not exist is skipped rather than
#      created out of thin air
#
# Usage: ./test-yoki-switch-targets.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

YOKI_SWITCH="${DOTFILES_ROOT}/domains/dev/bin/yoki-switch"
YOKI_ROOT_PIN="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki"

FAILED=0
PASSED=0
TOTAL=0

# -----------------------------------------------------------------------------
# Fixture
# -----------------------------------------------------------------------------
FIXTURE=""

cleanup_fixture() {
    if [[ -n "$FIXTURE" && -d "$FIXTURE" ]]; then
        /bin/rm -rf "$FIXTURE"
    fi
    FIXTURE=""
}

FOREIGN_HERDR_COMMAND="bash '/Users/tester/.codex/herdr-agent-state.sh' session"

build_seeded_fixture() {
    FIXTURE="$(mktemp -d)"
    mkdir -p "$FIXTURE/claude" "$FIXTURE/codex" "$FIXTURE/omp/agent"

    # A foreign (non-yoki) hooks.json group — mergeHooksJson must keep this
    # byte-for-byte and only replace/append yoki's OWN previously-generated
    # groups (codex-hooks-merge.js groupIsOurs()).
    cat > "$FIXTURE/codex/hooks.json" <<JSON
{
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        { "type": "command", "command": "${FOREIGN_HERDR_COMMAND}" }
      ]
    }
  ]
}
JSON

    # A config.toml with a [projects] trust table (what Codex itself writes
    # on first trust prompt) and an unrelated [hooks.state] entry (what a
    # herdr-style tool might have written) — both live OUTSIDE the
    # `# yoki:begin`/`# yoki:end` managed block and must never be touched.
    cat > "$FIXTURE/codex/config.toml" <<'TOML'
[projects."/repo"]
trust_level = "trusted"

[hooks.state."herdr-manual-entry"]
trusted_hash = "deadbeef"
enabled = true
TOML
}

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
# assert_true / assert_eq_text / assert_contains / assert_lacks and the
# symlink-safe tree_manifest() live in core/utils/common.sh (sourced above),
# shared with test-targets-golden.sh and the other validation suites.

run_yoki_switch() {
    # $1 = fixture root, remaining args = yoki-switch argv (after `apply`)
    local fixture="$1"; shift
    DOTFILES_ROOT="$DOTFILES_ROOT" \
    YOKI_ROOT="$YOKI_ROOT_PIN" \
    CLAUDE_PLUGIN_ROOT="$YOKI_ROOT_PIN" \
    CLAUDE_DIR="$fixture/claude" \
    CODEX_DIR="$fixture/codex" \
    OMP_AGENT_DIR="$fixture/omp/agent" \
    HOME="$fixture" \
        bash "$YOKI_SWITCH" --here apply "$@"
}

# -----------------------------------------------------------------------------
# Test suite
# -----------------------------------------------------------------------------
run_yoki_switch_targets_checks() {
    log_info "=== yoki-switch apply --target Test Suite ==="
    echo ""

    if ! command -v node >/dev/null 2>&1; then
        log_error "yoki-switch-targets requires node (for lib/targets/gen.js) — none found on PATH."
        return 1
    fi

    # --- scenario 1: seeded fixture, both targets present ------------------
    build_seeded_fixture
    trap cleanup_fixture RETURN

    local output
    if ! output=$(run_yoki_switch "$FIXTURE" --target codex --target omp 2>&1); then
        log_error "FAIL: yoki-switch apply --target codex --target omp exited non-zero"
        echo "$output" | sed 's/^/       /'
        FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1))
        cleanup_fixture; trap - RETURN
        log_error "FAILED: $FAILED / $TOTAL checks"
        return 1
    fi

    # 1. Foreign content preserved byte-for-byte.
    assert_true "codex/hooks.json: foreign SessionStart group preserved" \
        jq -e --arg cmd "$FOREIGN_HERDR_COMMAND" \
            '.SessionStart[0].hooks[0].command == $cmd' "$FIXTURE/codex/hooks.json"

    assert_true "codex/config.toml: foreign [projects] table preserved" \
        grep -qF '[projects."/repo"]' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: foreign [projects] trust_level preserved" \
        grep -qF 'trust_level = "trusted"' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: foreign herdr [hooks.state] entry preserved" \
        grep -qF '[hooks.state."herdr-manual-entry"]' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: foreign herdr trusted_hash preserved" \
        grep -qF 'trusted_hash = "deadbeef"' "$FIXTURE/codex/config.toml"

    # 2. Our own block/group is present alongside the foreign content.
    assert_true "codex/config.toml: yoki managed block present" \
        grep -qF '# yoki:begin' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: yoki default_permissions set inside block" \
        grep -qF 'default_permissions = "yoki"' "$FIXTURE/codex/config.toml"
    assert_true "codex/hooks.json: a generated (--harness codex) group is present alongside the foreign one" \
        jq -e '[.[][] | .hooks[]?.command | select(test("--harness codex"))] | length > 0' \
            "$FIXTURE/codex/hooks.json"
    assert_true "codex/hooks.json: foreign group still comes first in its event" \
        jq -e --arg cmd "$FOREIGN_HERDR_COMMAND" '.SessionStart[0].hooks[0].command == $cmd' \
            "$FIXTURE/codex/hooks.json"

    assert_true "omp/agent/config.yml: written" \
        test -f "$FIXTURE/omp/agent/config.yml"
    assert_true "omp/agent/RULES.md: yoki managed block present" \
        grep -qF 'yoki:begin' "$FIXTURE/omp/agent/RULES.md"
    assert_true "omp/agent/yoki-hooks.json: written" \
        test -f "$FIXTURE/omp/agent/yoki-hooks.json"

    # 3. Idempotent second run: identical file tree, not just "ran again
    #    without error".
    local snap1_codex snap1_omp
    snap1_codex="$(tree_manifest "$FIXTURE/codex")"
    snap1_omp="$(tree_manifest "$FIXTURE/omp/agent")"

    if ! output=$(run_yoki_switch "$FIXTURE" --target codex --target omp 2>&1); then
        log_error "FAIL: second yoki-switch apply --target codex --target omp exited non-zero"
        echo "$output" | sed 's/^/       /'
        FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1))
    else
        TOTAL=$((TOTAL + 1)); PASSED=$((PASSED + 1))
        log_success "PASS: second run exits 0"
    fi

    local snap2_codex snap2_omp
    snap2_codex="$(tree_manifest "$FIXTURE/codex")"
    snap2_omp="$(tree_manifest "$FIXTURE/omp/agent")"

    assert_eq_text "codex/: second run produces an identical file tree (idempotent)" \
        "$snap1_codex" "$snap2_codex"
    assert_eq_text "omp/agent/: second run produces an identical file tree (idempotent)" \
        "$snap1_omp" "$snap2_omp"

    # config.toml / hooks.json still carry the original foreign bytes after
    # two applies, not just "some [projects] block exists somewhere" — same
    # per-line checks as after the first run (grep -F does not do
    # multi-line matching against a single pattern, so this can't just diff
    # the whole original seed text in one shot).
    assert_true "codex/config.toml: foreign [projects] table still present after 2 runs" \
        grep -qF '[projects."/repo"]' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: foreign trust_level still present after 2 runs" \
        grep -qF 'trust_level = "trusted"' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: foreign [hooks.state] entry still present after 2 runs" \
        grep -qF '[hooks.state."herdr-manual-entry"]' "$FIXTURE/codex/config.toml"
    assert_true "codex/config.toml: foreign trusted_hash still present after 2 runs" \
        grep -qF 'trusted_hash = "deadbeef"' "$FIXTURE/codex/config.toml"
    assert_true "codex/hooks.json: foreign SessionStart group still exact match after 2 runs" \
        jq -e --arg cmd "$FOREIGN_HERDR_COMMAND" \
            '.SessionStart[0].hooks[0].command == $cmd' "$FIXTURE/codex/hooks.json"

    cleanup_fixture
    trap - RETURN

    # --- scenario 2: missing target home dir → skipped, not created -------
    local missing
    missing="$(mktemp -d)"
    mkdir -p "$missing/claude"
    trap '/bin/rm -rf "$missing"' RETURN

    if ! output=$(run_yoki_switch "$missing" --target codex --target omp 2>&1); then
        log_error "FAIL: apply --target codex --target omp on a machine with neither installed exited non-zero"
        echo "$output" | sed 's/^/       /'
        FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1))
    else
        TOTAL=$((TOTAL + 1)); PASSED=$((PASSED + 1))
        log_success "PASS: missing-target-dir run still exits 0 (skip, not error)"
    fi

    TOTAL=$((TOTAL + 1))
    if [[ ! -e "$missing/codex" ]]; then
        log_success "PASS: codex: home dir not created when absent"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: codex: ~/.codex was created even though it did not exist beforehand"
        FAILED=$((FAILED + 1))
    fi

    TOTAL=$((TOTAL + 1))
    if [[ ! -e "$missing/omp" ]]; then
        log_success "PASS: omp: home dir not created when absent"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: omp: ~/.omp/agent was created even though it did not exist beforehand"
        FAILED=$((FAILED + 1))
    fi

    assert_true "output notes the codex target was skipped" \
        bash -c "echo \"\$0\" | grep -qi 'codex.*skip'" "$output"
    assert_true "output notes the omp target was skipped" \
        bash -c "echo \"\$0\" | grep -qi 'omp.*skip'" "$output"

    /bin/rm -rf "$missing"
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
    run_yoki_switch_targets_checks
fi
