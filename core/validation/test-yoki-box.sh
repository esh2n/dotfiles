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

    # codex now carries spec.yaml.in too (task T15) — it mounts the same
    # three read-only paths yclaude does, so it can run
    # `yoki-switch apply --target codex` against the real dotfiles layers.
    out="$(invoke ycodex)"
    # Templated now (spec.yaml.in), so — like yclaude's own agent kit — the
    # repo path never appears literally: it is rendered to a temp dir first
    # (case15-18 below cover that machinery). "yoki-kits/codex-" is
    # render_kit's own naming (basename of spec.yaml.in's parent dir), so it
    # still proves codex got ITS OWN kit, not just the posture kit.
    assert_contains "case9: codex gets its own kit" "yoki-kits/codex-" "$out"
    assert_contains "case10: codex kit mounts claude-profiles read-only" \
        "${DOTFILES_ROOT}/domains/dev/config/claude-profiles:ro" "$out"
    assert_contains "case11: codex kit mounts core/ read-only" \
        "${DOTFILES_ROOT}/core:ro" "$out"
    assert_contains "case12: codex kit mounts domains/dev/bin/ read-only" \
        "${DOTFILES_ROOT}/domains/dev/bin:ro" "$out"

    out="$(invoke ygemini)"
    assert_contains "case13: agent without a kit still gets a posture" \
        "${KITS}/postures/guarded" "$out"
    assert_lacks    "case14: agent without a kit gets no agent kit" "agents/" "$out"

    # --- rendered kit --------------------------------------------------------
    # The templated kit is rendered to a temp dir at launch, never installed.
    local rendered
    rendered="$(invoke yclaude | tr ' ' '\n' | grep 'yoki-kits' | head -1)"
    TOTAL=$((TOTAL + 1))
    if [[ -n "$rendered" && -f "${rendered}/spec.yaml" ]]; then
        log_success "PASS: case15: kit is rendered outside the repo"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case15: kit is rendered outside the repo (got '$rendered')"
        FAILED=$((FAILED + 1))
    fi

    if [[ -f "${rendered}/spec.yaml" ]]; then
        assert_lacks "case16: no placeholder survives rendering" \
            "{{" "$(cat "${rendered}/spec.yaml")"
        assert_contains "case17: DOTFILES_ROOT is substituted" \
            "$DOTFILES_ROOT" "$(cat "${rendered}/spec.yaml")"
        TOTAL=$((TOTAL + 1))
        if sbx kit validate "$rendered" >/dev/null 2>&1; then
            log_success "PASS: case18: rendered kit passes sbx kit validate"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case18: rendered kit passes sbx kit validate"
            FAILED=$((FAILED + 1))
        fi
    fi

    # The omp kit renders too — same templated-kit machinery, exercised
    # separately from yclaude above because omp isn't an sbx-builtin agent
    # (it runs on the `shell` base per SBX_BUILTIN_AGENTS), which is exactly
    # the path a kit-rendering regression could hide behind.
    local omp_rendered
    omp_rendered="$(invoke yomp | tr ' ' '\n' | grep 'yoki-kits' | head -1)"
    TOTAL=$((TOTAL + 1))
    if [[ -n "$omp_rendered" && -f "${omp_rendered}/spec.yaml" ]]; then
        log_success "PASS: case19: omp kit is rendered outside the repo"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case19: omp kit is rendered outside the repo (got '$omp_rendered')"
        FAILED=$((FAILED + 1))
    fi

    if [[ -f "${omp_rendered}/spec.yaml" ]]; then
        assert_lacks "case20: no placeholder survives rendering the omp kit" \
            "{{" "$(cat "${omp_rendered}/spec.yaml")"
        TOTAL=$((TOTAL + 1))
        if sbx kit validate "$omp_rendered" >/dev/null 2>&1; then
            log_success "PASS: case21: rendered omp kit passes sbx kit validate"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: case21: rendered omp kit passes sbx kit validate"
            FAILED=$((FAILED + 1))
        fi
    fi

    # The regression this guards is a rendered spec.yaml appearing NEXT TO its
    # spec.yaml.in — an installed artifact carrying one checkout's absolute
    # paths. Asserted directly rather than through `git status`, which also
    # trips on any unrelated edit in the tree and so fails hardest exactly when
    # someone is working on a kit.
    TOTAL=$((TOTAL + 1))
    local stray=""
    while IFS= read -r tpl; do
        [[ -e "${tpl%.in}" ]] && stray="${stray} ${tpl%.in}"
    done < <(find "${KITS}" -name 'spec.yaml.in')
    if [[ -z "$stray" ]]; then
        log_success "PASS: case22: rendering writes no spec.yaml into the repo"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case22: rendered artifact left in the repo:${stray}"
        FAILED=$((FAILED + 1))
    fi

    # --- argument handling ---------------------------------------------------
    out="$(invoke yclaude -- --continue)"
    assert_contains "case23: args after -- reach the agent" "-- --continue" "$out"

    assert_fails "case24: unknown option is rejected" "unknown option" \
        bash "${BIN}/yclaude" --bogus
    assert_fails "case25: yoki-box must be invoked through a symlink" \
        "invoke through a symlink" bash "${BIN}/yoki-box"

    # --- unattended ----------------------------------------------------------
    # Direct mode is the one posture that gives the sandbox a writable host
    # tree, which would route around the unattended guard.
    TOTAL=$((TOTAL + 1))
    local unattended_out status=0
    unattended_out=$(YOKI_BOX_DRY_RUN=1 YOKI_UNATTENDED=1 \
        bash "${BIN}/yclaude" -d 2>&1) || status=$?
    if [[ "$status" -ne 0 ]] && grep -qF "unattended session" <<< "$unattended_out"; then
        log_success "PASS: case26: direct mode is refused in an unattended session"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case26: direct mode is refused in an unattended session (exit $status)"
        FAILED=$((FAILED + 1))
    fi

    out="$(YOKI_BOX_DRY_RUN=1 YOKI_UNATTENDED=1 bash "${BIN}/yclaude" 2>/dev/null)"
    assert_contains "case27: guarded mode still runs when unattended" "--clone" "$out"

    # --- installation ---------------------------------------------------------
    # The whole interface is symlinks to yoki-box, and the installer used to
    # match regular files only — which would have put yoki-box in ~/bin with
    # nothing able to invoke it. Run link_domain against a throwaway HOME and a
    # non-git fixture (so the worktree guard stays out of the way) and check
    # that a symlinked launcher lands.
    TOTAL=$((TOTAL + 1))
    local fixture fake_home
    fixture="$(mktemp -d)"
    fake_home="${fixture}/home"
    mkdir -p "${fixture}/repo/core/utils" "${fixture}/repo/domains/dev/bin" "$fake_home"
    cp "${DOTFILES_ROOT}/core/utils/common.sh"   "${fixture}/repo/core/utils/"
    mkdir -p "${fixture}/repo/core/config"
    cp "${DOTFILES_ROOT}/core/config/manager.sh" "${fixture}/repo/core/config/"
    printf '#!/usr/bin/env bash\n' > "${fixture}/repo/domains/dev/bin/tool"
    ln -s tool "${fixture}/repo/domains/dev/bin/ytool"

    HOME="$fake_home" bash -c "
        source '${fixture}/repo/core/utils/common.sh'
        source '${fixture}/repo/core/config/manager.sh'
        DOTFILES_ROOT='${fixture}/repo' link_domain dev
    " >/dev/null 2>&1 || true

    if [[ -L "${fake_home}/bin/ytool" && -e "${fake_home}/bin/tool" ]]; then
        log_success "PASS: case28: installer links symlinked launchers, not just files"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case28: installer links symlinked launchers, not just files"
        log_error "  ~/bin contents: $(ls "${fake_home}/bin" 2>&1 | tr '\n' ' ')"
        FAILED=$((FAILED + 1))
    fi
    /bin/rm -rf "$fixture"

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
