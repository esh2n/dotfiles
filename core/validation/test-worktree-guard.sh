#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Worktree Install Guard Regression Test (test-worktree-guard.sh)
# -----------------------------------------------------------------------------
# ~/.claude, ~/bin/* and ~/.config/* are all symlinks INTO the checkout, and
# ~/.claude/settings.json bakes DOTFILES_ROOT into YOKI_ROOT as an absolute
# path. Installing from a git worktree therefore points the machine at a
# directory that disappears when the worktree is removed. Two guards prevent it:
#
#   core/config/manager.sh   link  → refuses outright
#   domains/dev/bin/yoki-switch    → applies the main checkout, unless --here
#     (claude-switch is a permanent symlink alias to the same script)
#
# Both are exercised against a throwaway repo + worktree under mktemp, so no
# host state is touched. The fixture carries only the files the guards read.
#
# Usage: ./test-worktree-guard.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

FAILED=0
PASSED=0
TOTAL=0

FIXTURE_ROOT=""

cleanup_fixture() {
    if [[ -n "$FIXTURE_ROOT" && -d "$FIXTURE_ROOT" ]]; then
        /bin/rm -rf "$FIXTURE_ROOT"
    fi
}

# A miniature dotfiles checkout: enough tree for the guards to resolve paths,
# plus a linked worktree of it. The real scripts are copied in, so the test
# fails when they change behaviour rather than testing a reimplementation.
build_fixture() {
    FIXTURE_ROOT="$(mktemp -d)"
    local main="$FIXTURE_ROOT/main"

    mkdir -p "$main/core/config" "$main/core/utils" \
             "$main/domains/dev/bin" "$main/domains/dev/config/claude-profiles"
    cp "${DOTFILES_ROOT}/core/config/manager.sh"       "$main/core/config/"
    cp "${DOTFILES_ROOT}/core/utils/common.sh"         "$main/core/utils/"
    cp "${DOTFILES_ROOT}/domains/dev/bin/yoki-switch" "$main/domains/dev/bin/"
    ln -s yoki-switch "$main/domains/dev/bin/claude-switch"

    git -C "$main" init -q -b main
    git -C "$main" config user.email "test@example.com"
    git -C "$main" config user.name "test"
    git -C "$main" add -A
    git -C "$main" commit -q -m "init" >/dev/null
    git -C "$main" worktree add -q -b wt "$FIXTURE_ROOT/wt" main >/dev/null

    # Blast shield for the cases that call the real `link` — see assert_refuses.
    mkdir -p "${FIXTURE_ROOT}/fake-home"
}

# Exit status alone is not enough: any unrelated breakage also exits non-zero
# and would read as a pass. Require the guard's own message too.
#
# HOME is redirected for the duration. These cases invoke the real `link`, so
# if the guard ever regresses the command proceeds — and it would repoint the
# tester's own ~/.claude, ~/bin and ~/.config at a mktemp fixture that is about
# to be deleted. Learned the hard way while mutation-testing this very file.
assert_refuses() {
    local description="$1"; shift
    TOTAL=$((TOTAL + 1))
    local out status=0
    out=$(HOME="${FIXTURE_ROOT}/fake-home" "$@" 2>&1) || status=$?
    if [[ "$status" -ne 0 ]] && grep -q "Refusing to link from a git worktree" <<< "$out"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (exit $status)"
        log_error "  output: $(head -3 <<< "$out")"
        FAILED=$((FAILED + 1))
    fi
}

assert_succeeds() {
    local description="$1"; shift
    TOTAL=$((TOTAL + 1))
    if "$@" >/dev/null 2>&1; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected zero exit)"
        FAILED=$((FAILED + 1))
    fi
}

# Asserts on which root yoki-switch decided to use. The warning names the
# worktree it was invoked from and the checkout it redirected to; --here
# suppresses it entirely.
assert_redirect() {
    local description="$1" expected="$2"; shift 2
    TOTAL=$((TOTAL + 1))
    local out
    out=$(env -u DOTFILES_ROOT "$@" 2>&1 || true)
    if [[ "$expected" == "yes" ]] && grep -q "applying the main checkout" <<< "$out"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    elif [[ "$expected" == "no" ]] && ! grep -q "applying the main checkout" <<< "$out"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        log_error "  output: $(head -3 <<< "$out")"
        FAILED=$((FAILED + 1))
    fi
}

run_worktree_guard_checks() {
    log_info "=== Worktree Install Guard Test Suite ==="
    echo ""

    trap cleanup_fixture EXIT
    build_fixture

    local main="$FIXTURE_ROOT/main" wt="$FIXTURE_ROOT/wt"

    # --- manager.sh link: refuses from a worktree, works from the main tree ---
    assert_refuses "case1: link from a worktree is refused" \
        bash "$wt/core/config/manager.sh" link
    assert_refuses "case2: link <domain> from a worktree is refused" \
        bash "$wt/core/config/manager.sh" link dev

    # Positive control: the same script over the main checkout must NOT trip the
    # guard. Called through the guard function alone — a real `link` run would
    # rewrite the tester's ~/.config.
    assert_succeeds "case3: main checkout passes the guard" \
        bash -c "DOTFILES_ROOT='$main'
                 source '$main/core/utils/common.sh'
                 source '$main/core/config/manager.sh'
                 DOTFILES_ROOT='$main' assert_canonical_checkout"

    # A checkout with no git at all (how a sandbox sees the mounted repo) must
    # pass: the guard has nothing to compare against and must not block.
    assert_succeeds "case4: non-git tree passes the guard" \
        bash -c "DOTFILES_ROOT='$FIXTURE_ROOT/nogit'
                 mkdir -p '$FIXTURE_ROOT/nogit'
                 source '$main/core/utils/common.sh'
                 source '$main/core/config/manager.sh'
                 DOTFILES_ROOT='$FIXTURE_ROOT/nogit' assert_canonical_checkout"

    # --- yoki-switch: redirects to the main checkout unless --here ---
    assert_redirect "case5: invoked from a worktree, redirects to main" yes \
        bash "$wt/domains/dev/bin/yoki-switch" status
    assert_redirect "case6: --here keeps the worktree" no \
        bash "$wt/domains/dev/bin/yoki-switch" --here status
    assert_redirect "case7: invoked from the main checkout, no redirect" no \
        bash "$main/domains/dev/bin/yoki-switch" status

    # --- claude-switch alias: behaves identically to yoki-switch ---
    assert_redirect "case8: invoked via claude-switch alias, redirects to main" yes \
        bash "$wt/domains/dev/bin/claude-switch" status

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
    run_worktree_guard_checks
fi
