#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# pi Config Link Regression Test (test-pi-links.sh)
# -----------------------------------------------------------------------------
# Verifies core/config/manager.sh's link_pi_resources(): ~/.pi/agent holds
# runtime state (auth.json, sessions/) AND the user's own extensions
# (orca-*.ts, `pi install`ed files) next to what this repo owns, so the
# contract under test is exactly the dangerous part:
#
#   - settings.json / models.json / AGENTS.md and every extensions/*.ts are
#     linked FILE BY FILE (a directory symlink would destroy the co-resident
#     user files — asserted here by planting an orca-*.ts first)
#   - re-running is idempotent
#   - dangling symlinks are swept ONLY when they point into a
#     .../domains/dev/config/pi/ dir (2026-08 era leftovers); a dangling
#     link owned by anything else is never touched
#   - runtime state files are never touched
#   - a relative src_dir is refused (the broken-symlink incident guard)
#
# Runs the REAL link_pi_resources (sourced from core/config/manager.sh)
# against the REAL domains/dev/config/pi as source, with HOME redirected to
# a mktemp fixture — this machine's actual ~/.pi and ~/.config are never
# touched. Invocations go through `bash -c` (never ./file) to sidestep the
# macOS first-exec stall on fresh executables.
#
# Usage: ./test-pi-links.sh   (or: validator.sh pi-links)
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

PI_SRC="${DOTFILES_ROOT}/domains/dev/config/pi"

FAILED=0
PASSED=0
TOTAL=0

FIXTURE=""
FAKE_HOME=""

cleanup_pi_links_fixture() {
    if [[ -n "$FIXTURE" && -d "$FIXTURE" ]]; then
        /bin/rm -rf "$FIXTURE"
    fi
}

build_pi_links_fixture() {
    FIXTURE="$(mktemp -d)"
    FAKE_HOME="${FIXTURE}/home"
    mkdir -p "${FAKE_HOME}/.pi/agent/extensions" \
             "${FAKE_HOME}/.pi/agent/agents" \
             "${FAKE_HOME}/.config"

    # pi's own runtime state — must survive untouched.
    echo '{"token":"runtime"}' > "${FAKE_HOME}/.pi/agent/auth.json"

    # The user's hand-written extension living in the SAME directory the
    # repo links into — the reason extensions/ must never be a dir symlink.
    echo '// user-owned' > "${FAKE_HOME}/.pi/agent/extensions/orca-test.ts"

    # A dangling symlink NOT owned by this repo — must be left alone.
    ln -s /nonexistent/orca-dead.ts "${FAKE_HOME}/.pi/agent/extensions/orca-dead.ts"

    # 2026-08 era repo-made links whose sources no longer exist — must be
    # swept (top level, extensions/, and the retired agents/).
    ln -s "${PI_SRC}/prompts" "${FAKE_HOME}/.pi/agent/prompts"
    ln -s "${PI_SRC}/extensions/yoki-guard.ts" "${FAKE_HOME}/.pi/agent/extensions/yoki-guard.ts"
    ln -s "${PI_SRC}/agents/claude-worker.md" "${FAKE_HOME}/.pi/agent/agents/claude-worker.md"

    # Dead-weight whole-dir link the generic ~/.config branch used to make.
    ln -s "$PI_SRC" "${FAKE_HOME}/.config/pi"
}

# Run the real function with HOME redirected. Extra args are appended after
# the src_dir default so the relative-path case can override it.
run_link_pi() {
    local src="${1:-$PI_SRC}"
    HOME="$FAKE_HOME" bash -c '
        set -euo pipefail
        source "$1/core/config/manager.sh"
        link_pi_resources "$2"
    ' _ "$DOTFILES_ROOT" "$src"
}

check() {
    local description="$1"; shift
    TOTAL=$((TOTAL + 1))
    if "$@"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        FAILED=$((FAILED + 1))
    fi
}

# dest must be a symlink pointing exactly at src, and resolve.
is_link_to() {
    local dest="$1" src="$2"
    [[ -L "$dest" && "$(readlink "$dest")" == "$src" && -e "$dest" ]]
}

# Snapshot every symlink under ~/.pi/agent as "path -> target" lines, for
# the idempotency comparison.
snapshot_links() {
    find "${FAKE_HOME}/.pi/agent" -type l -print0 2>/dev/null \
        | sort -z \
        | while IFS= read -r -d '' l; do
            printf '%s -> %s\n' "$l" "$(readlink "$l")"
          done
}

run_pi_links_checks() {
    log_info "=== pi Config Link Test Suite ==="
    echo ""

    if [[ ! -d "$PI_SRC" ]]; then
        log_error "missing source dir: $PI_SRC"
        return 1
    fi

    trap cleanup_pi_links_fixture EXIT
    build_pi_links_fixture

    # --- first run -----------------------------------------------------------
    check "case1: first run exits zero" \
        run_link_pi

    local f
    for f in settings.json models.json AGENTS.md; do
        check "case2: ${f} linked" \
            is_link_to "${FAKE_HOME}/.pi/agent/${f}" "${PI_SRC}/${f}"
    done

    local ext count=0
    for ext in "${PI_SRC}/extensions/"*.ts; do
        count=$((count + 1))
        check "case3: extensions/$(basename "$ext") linked file-by-file" \
            is_link_to "${FAKE_HOME}/.pi/agent/extensions/$(basename "$ext")" "$ext"
    done
    check "case3b: repo actually ships extensions (fixture not vacuous)" \
        test "$count" -ge 1

    check "case4: extensions/ stays a real directory, never a symlink" \
        bash -c "[[ -d '${FAKE_HOME}/.pi/agent/extensions' && ! -L '${FAKE_HOME}/.pi/agent/extensions' ]]"

    # --- co-resident and runtime files ---------------------------------------
    check "case5: user-owned orca-test.ts untouched" \
        bash -c "[[ -f '${FAKE_HOME}/.pi/agent/extensions/orca-test.ts' && ! -L '${FAKE_HOME}/.pi/agent/extensions/orca-test.ts' ]]"
    check "case6: runtime auth.json untouched" \
        grep -q runtime "${FAKE_HOME}/.pi/agent/auth.json"

    # --- sweep ----------------------------------------------------------------
    check "case7: dangling repo link swept (top level: prompts)" \
        bash -c "[[ ! -e '${FAKE_HOME}/.pi/agent/prompts' && ! -L '${FAKE_HOME}/.pi/agent/prompts' ]]"
    check "case8: dangling repo link swept (extensions/yoki-guard.ts)" \
        bash -c "[[ ! -L '${FAKE_HOME}/.pi/agent/extensions/yoki-guard.ts' ]]"
    check "case9: dangling repo link swept (agents/claude-worker.md)" \
        bash -c "[[ ! -L '${FAKE_HOME}/.pi/agent/agents/claude-worker.md' ]]"
    check "case10: dangling NON-repo link left alone (orca-dead.ts)" \
        bash -c "[[ -L '${FAKE_HOME}/.pi/agent/extensions/orca-dead.ts' ]]"
    check "case11: dead-weight ~/.config/pi dir link removed" \
        bash -c "[[ ! -e '${FAKE_HOME}/.config/pi' && ! -L '${FAKE_HOME}/.config/pi' ]]"

    # --- idempotency ----------------------------------------------------------
    local before after
    before="$(snapshot_links)"
    check "case12: second run exits zero" \
        run_link_pi
    after="$(snapshot_links)"
    check "case13: second run changes nothing (idempotent)" \
        test "$before" = "$after"

    # --- guard ----------------------------------------------------------------
    local status=0 out
    out="$(run_link_pi "domains/dev/config/pi" 2>&1)" || status=$?
    TOTAL=$((TOTAL + 1))
    if [[ "$status" -ne 0 ]] && grep -q "must be absolute" <<< "$out"; then
        log_success "PASS: case14: relative src_dir refused"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case14: relative src_dir refused (exit $status)"
        log_error "  output: $(head -3 <<< "$out")"
        FAILED=$((FAILED + 1))
    fi

    cleanup_pi_links_fixture
    trap - EXIT

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
    run_pi_links_checks
fi
