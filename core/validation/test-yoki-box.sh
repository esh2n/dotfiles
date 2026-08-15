#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# yoki-box Launcher Regression Test (test-yoki-box.sh)
# -----------------------------------------------------------------------------
# Verifies domains/dev/bin/yoki-box — the sandbox launcher behind yclaude /
# ycodex / ygemini / yfetch — by asserting on the sbx invocation it builds.
#
# YOKI_BOX_DRY_RUN=1 makes it print the command instead of running it, which is
# the only way to test this: the real path opens an interactive TUI. Nothing
# here starts a sandbox or touches host state.
#
# Usage: ./test-yoki-box.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

BIN="${DOTFILES_ROOT}/domains/dev/bin"
KITS="${DOTFILES_ROOT}/domains/dev/config/sbx/kits"

FAILED=0
PASSED=0
TOTAL=0

# The launcher refuses to start without sbx, so every case would fail with the
# same unrelated error on a machine that has no sbx. Say so and skip instead.
require_sbx() {
    if ! command -v sbx >/dev/null 2>&1; then
        log_warn "SKIP: sbx is not installed — nothing to assert against"
        return 1
    fi
    return 0
}

invoke() {
    local link="$1"; shift
    YOKI_BOX_DRY_RUN=1 bash "${BIN}/${link}" "$@" 2>/dev/null
}

assert_contains() {
    local description="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$needle" <<< "$haystack"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        log_error "  wanted: $needle"
        log_error "  got:    $haystack"
        FAILED=$((FAILED + 1))
    fi
}

assert_lacks() {
    local description="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$needle" <<< "$haystack"; then
        log_error "FAIL: $description"
        log_error "  unwanted: $needle"
        log_error "  got:      $haystack"
        FAILED=$((FAILED + 1))
    else
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    fi
}

assert_fails() {
    local description="$1" needle="$2"; shift 2
    TOTAL=$((TOTAL + 1))
    local out status=0
    out=$(YOKI_BOX_DRY_RUN=1 "$@" 2>&1) || status=$?
    if [[ "$status" -ne 0 ]] && grep -qF -- "$needle" <<< "$out"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (exit $status)"
        log_error "  output: $(head -2 <<< "$out")"
        FAILED=$((FAILED + 1))
    fi
}

run_yoki_box_checks() {
    log_info "=== yoki-box Launcher Test Suite ==="
    echo ""

    require_sbx || return 0

    local out

    # --- modes ---------------------------------------------------------------
    out="$(invoke yclaude)"
    assert_contains "case1: guarded is the default and clones" "--clone" "$out"
    assert_contains "case2: guarded posture kit" "${KITS}/postures/guarded" "$out"
    assert_contains "case3: --no-share-skills is always present" "--no-share-skills" "$out"

    out="$(invoke yclaude -d)"
    assert_lacks    "case4: direct mode does not clone" "--clone" "$out"
    assert_contains "case5: direct reuses the guarded kit" "${KITS}/postures/guarded" "$out"

    out="$(invoke yclaude -c)"
    assert_contains "case6: connected posture kit" "${KITS}/postures/connected" "$out"

    # --- kit selection and mounts -------------------------------------------
    # A kit carrying host paths (spec.yaml.in) needs the repo mounted; a
    # self-contained one (plain spec.yaml) must get nothing.
    out="$(invoke yclaude)"
    assert_contains "case7: templated kit mounts claude-profiles read-only" \
        "${DOTFILES_ROOT}/domains/dev/config/claude-profiles:ro" "$out"
    assert_lacks    "case8: never mounts the whole repo" " ${DOTFILES_ROOT} " "$out"

    out="$(invoke ycodex)"
    assert_contains "case9: codex gets its own kit" "${KITS}/agents/codex" "$out"
    assert_lacks    "case10: self-contained kit mounts nothing" "claude-profiles:ro" "$out"

    out="$(invoke ygemini)"
    assert_contains "case11: agent without a kit still gets a posture" \
        "${KITS}/postures/guarded" "$out"
    assert_lacks    "case12: agent without a kit gets no agent kit" "agents/" "$out"

    # --- rendered kit --------------------------------------------------------
    # The templated kit is rendered to a temp dir at launch, never installed.
    local rendered
    rendered="$(invoke yclaude | tr ' ' '\n' | grep 'yoki-kits' | head -1)"
    TOTAL=$((TOTAL + 1))
    if [[ -n "$rendered" && -f "${rendered}/spec.yaml" ]]; then
        log_success "PASS: case13: kit is rendered outside the repo"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case13: kit is rendered outside the repo (got '$rendered')"
        FAILED=$((FAILED + 1))
    fi

    if [[ -f "${rendered}/spec.yaml" ]]; then
        assert_lacks "case14: no placeholder survives rendering" \
            "{{" "$(cat "${rendered}/spec.yaml")"
        assert_contains "case15: DOTFILES_ROOT is substituted" \
            "$DOTFILES_ROOT" "$(cat "${rendered}/spec.yaml")"
        TOTAL=$((TOTAL + 1))
        if sbx kit validate "$rendered" >/dev/null 2>&1; then
            log_success "PASS: case16: rendered kit passes sbx kit validate"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case16: rendered kit passes sbx kit validate"
            FAILED=$((FAILED + 1))
        fi
    fi

    TOTAL=$((TOTAL + 1))
    if git -C "$DOTFILES_ROOT" status --porcelain -- \
        domains/dev/config/sbx | grep -q .; then
        log_error "FAIL: case17: rendering leaves the repo untouched"
        FAILED=$((FAILED + 1))
    else
        log_success "PASS: case17: rendering leaves the repo untouched"
        PASSED=$((PASSED + 1))
    fi

    # --- argument handling ---------------------------------------------------
    out="$(invoke yclaude -- --continue)"
    assert_contains "case18: args after -- reach the agent" "-- --continue" "$out"

    assert_fails "case19: unknown option is rejected" "unknown option" \
        bash "${BIN}/yclaude" --bogus
    assert_fails "case20: yoki-box must be invoked through a symlink" \
        "invoke through a symlink" bash "${BIN}/yoki-box"

    # --- unattended ----------------------------------------------------------
    # Direct mode is the one posture that gives the sandbox a writable host
    # tree, which would route around the unattended guard.
    TOTAL=$((TOTAL + 1))
    local unattended_out status=0
    unattended_out=$(YOKI_BOX_DRY_RUN=1 YOKI_UNATTENDED=1 \
        bash "${BIN}/yclaude" -d 2>&1) || status=$?
    if [[ "$status" -ne 0 ]] && grep -qF "unattended session" <<< "$unattended_out"; then
        log_success "PASS: case21: direct mode is refused in an unattended session"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case21: direct mode is refused in an unattended session (exit $status)"
        FAILED=$((FAILED + 1))
    fi

    out="$(YOKI_BOX_DRY_RUN=1 YOKI_UNATTENDED=1 bash "${BIN}/yclaude" 2>/dev/null)"
    assert_contains "case22: guarded mode still runs when unattended" "--clone" "$out"

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
    run_yoki_box_checks
fi
