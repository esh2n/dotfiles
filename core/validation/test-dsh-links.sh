#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# dsh Config Link Regression Test (test-dsh-links.sh)
# -----------------------------------------------------------------------------
# Verifies core/config/manager.sh's link_dsh_resources(): $DSH_HOME holds
# runtime state (profiles/ are pnpm workspaces dsh scaffolds itself, plus
# .credentials.yaml and sessions) next to what this repo owns, so the
# contract under test is exactly the dangerous part:
#
#   - settings.yaml is symlinked; hooks.claude.json and each cordis.patch.yml
#     are EXPANDED COPIES ({{HOME}}/{{DOTFILES_ROOT}} -> real paths), because
#     the hook/cordis contexts read them literally and can't expand env vars
#   - a profile's cordis.patch.yml is deployed only into a profile directory
#     dsh has ALREADY scaffolded — never creates the profile dir itself
#   - re-running is idempotent
#   - dangling symlinks are swept ONLY when they point into a
#     .../domains/dev/config/dsh/ dir; a dangling link owned by anything
#     else is never touched — same two-part ownership test as
#     link_pi_resources (see test-pi-links.sh), now shared via
#     sweep_stale_repo_links()
#   - runtime state files are never touched
#   - a relative src_dir is refused (the broken-symlink incident guard)
#
# Runs the REAL link_dsh_resources (sourced from core/config/manager.sh)
# against the REAL domains/dev/config/dsh as source, with DSH_HOME redirected
# to a mktemp fixture — this machine's actual ~/.dsh is never touched.
# Invocations go through `bash -c` (never ./file) to sidestep the macOS
# first-exec stall on fresh executables.
#
# Usage: ./test-dsh-links.sh   (or: validator.sh dsh-links)
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

DSH_SRC="${DOTFILES_ROOT}/domains/dev/config/dsh"

FAILED=0
PASSED=0
TOTAL=0

FIXTURE=""
FAKE_DSH_HOME=""

cleanup_dsh_links_fixture() {
    if [[ -n "$FIXTURE" && -d "$FIXTURE" ]]; then
        /bin/rm -rf "$FIXTURE"
    fi
}

build_dsh_links_fixture() {
    FIXTURE="$(mktemp -d)"
    FAKE_DSH_HOME="${FIXTURE}/dsh-home"
    mkdir -p "${FAKE_DSH_HOME}/profiles/proxy" \
             "${FAKE_DSH_HOME}/profiles/headless"
    # "unscaffolded" is intentionally NOT created here — it is a real profile
    # under $DSH_SRC/profiles but must never be scaffolded by this function.

    # dsh's own runtime state — must survive untouched.
    echo 'runtime: true' > "${FAKE_DSH_HOME}/.credentials.yaml"

    # A dangling symlink NOT owned by this repo — must be left alone.
    ln -s /nonexistent/other-tool.yml "${FAKE_DSH_HOME}/other-tool.yml"

    # A repo-made link whose source no longer exists — must be swept, both
    # at the top level and inside a scaffolded profile dir.
    ln -s "${DSH_SRC}/retired.yaml" "${FAKE_DSH_HOME}/retired.yaml"
    ln -s "${DSH_SRC}/profiles/proxy/retired.patch.yml" \
        "${FAKE_DSH_HOME}/profiles/proxy/retired.patch.yml"
}

# Run the real function with DSH_HOME redirected. Extra args are appended
# after the src_dir default so the relative-path case can override it.
run_link_dsh() {
    local src="${1:-$DSH_SRC}"
    DSH_HOME="$FAKE_DSH_HOME" bash -c '
        set -euo pipefail
        source "$1/core/config/manager.sh"
        link_dsh_resources "$2"
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

is_link_to() {
    local dest="$1" src="$2"
    [[ -L "$dest" && "$(readlink "$dest")" == "$src" && -e "$dest" ]]
}

# Files carrying {{HOME}}/{{DOTFILES_ROOT}}/{{USER}} placeholders are deployed
# as EXPANDED COPIES (install_expanded), not symlinks: the hook/cordis contexts
# read them literally and would choke on raw {{...}}. Assert dest is a real
# file (not a symlink), holds no leftover placeholder, and equals the source
# with the same substitution install_expanded applies.
is_expanded_copy() {
    local dest="$1" src="$2"
    [[ -f "$dest" && ! -L "$dest" ]] || return 1
    grep -q '{{' "$dest" && return 1
    local expected actual
    expected="$(sed -e "s|{{HOME}}|${HOME}|g" \
                    -e "s|{{DOTFILES_ROOT}}|${DOTFILES_ROOT}|g" \
                    -e "s|{{USER}}|${USER}|g" "$src")"
    # link_dsh_resources hands the profile to `jig apply --target dsh --write`
    # right after the copy, which appends its MCP rows between
    # `# jig:begin mcp` and `# jig:end mcp`. That block is jig's (tested in
    # jig/test); here only manager.sh's copy is under test, so compare the
    # file with the block and the blank line before it removed.
    actual="$(sed -e '/^# jig:begin mcp$/,/^# jig:end mcp$/d' "$dest" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
    [[ "$actual" == "$expected" ]]
}

snapshot_links() {
    find "${FAKE_DSH_HOME}" -type l -print0 2>/dev/null \
        | sort -z \
        | while IFS= read -r -d '' l; do
            printf '%s -> %s\n' "$l" "$(readlink "$l")"
          done
}

run_dsh_links_checks() {
    log_info "=== dsh Config Link Test Suite ==="
    echo ""

    if [[ ! -d "$DSH_SRC" ]]; then
        log_error "missing source dir: $DSH_SRC"
        return 1
    fi

    trap cleanup_dsh_links_fixture EXIT
    build_dsh_links_fixture

    # --- first run -----------------------------------------------------------
    check "case1: first run exits zero" \
        run_link_dsh

    check "case2: settings.yaml linked" \
        is_link_to "${FAKE_DSH_HOME}/settings.yaml" "${DSH_SRC}/settings.yaml"
    check "case3: hooks.claude.json expanded-copied (not symlink)" \
        is_expanded_copy "${FAKE_DSH_HOME}/hooks.claude.json" "${DSH_SRC}/hooks.claude.json"

    check "case4: proxy profile patch expanded-copied (scaffolded)" \
        is_expanded_copy "${FAKE_DSH_HOME}/profiles/proxy/cordis.patch.yml" \
                         "${DSH_SRC}/profiles/proxy/cordis.patch.yml"
    check "case5: headless profile patch expanded-copied (scaffolded)" \
        is_expanded_copy "${FAKE_DSH_HOME}/profiles/headless/cordis.patch.yml" \
                         "${DSH_SRC}/profiles/headless/cordis.patch.yml"

    # --- runtime state ---------------------------------------------------------
    check "case6: runtime .credentials.yaml untouched" \
        grep -q runtime "${FAKE_DSH_HOME}/.credentials.yaml"

    # --- sweep -------------------------------------------------------------
    check "case7: dangling repo link swept (top level: retired.yaml)" \
        bash -c "[[ ! -e '${FAKE_DSH_HOME}/retired.yaml' && ! -L '${FAKE_DSH_HOME}/retired.yaml' ]]"
    check "case8: dangling repo link swept (profiles/proxy/retired.patch.yml)" \
        bash -c "[[ ! -L '${FAKE_DSH_HOME}/profiles/proxy/retired.patch.yml' ]]"
    check "case9: dangling NON-repo link left alone (other-tool.yml)" \
        bash -c "[[ -L '${FAKE_DSH_HOME}/other-tool.yml' ]]"

    # --- idempotency ----------------------------------------------------------
    local before after
    before="$(snapshot_links)"
    check "case10: second run exits zero" \
        run_link_dsh
    after="$(snapshot_links)"
    check "case11: second run changes nothing (idempotent)" \
        test "$before" = "$after"

    # --- guard ----------------------------------------------------------------
    local status=0 out
    out="$(run_link_dsh "domains/dev/config/dsh" 2>&1)" || status=$?
    TOTAL=$((TOTAL + 1))
    if [[ "$status" -ne 0 ]] && grep -q "must be absolute" <<< "$out"; then
        log_success "PASS: case12: relative src_dir refused"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case12: relative src_dir refused (exit $status)"
        log_error "  output: $(head -3 <<< "$out")"
        FAILED=$((FAILED + 1))
    fi

    cleanup_dsh_links_fixture
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
    run_dsh_links_checks
fi
