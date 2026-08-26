#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Workspace Domain Installer
# -----------------------------------------------------------------------------
# Installs workspace-related external dependencies that are not managed by Nix:
# - SbarLua (Lua bindings for sketchybar)
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# SbarLua
# -----------------------------------------------------------------------------
# Required by ~/.config/sketchybar/init.lua (`require("sketchybar")`).
# SbarLua is not on luarocks; build from source.
# Set FORCE=true to rebuild even when the .so already exists.

SBARLUA_REPO="https://github.com/FelixKratz/SbarLua"
SBARLUA_CACHE_DIR="${HOME}/.cache/sbarlua"
SBARLUA_TARGET="${HOME}/.local/share/sketchybar_lua/sketchybar.so"

# Print the major.minor of the Lua statically linked into a SbarLua .so.
sbarlua_so_version() {
    grep -a -o 'LuaVersion: Lua [0-9]*\.[0-9]*' "$1" 2>/dev/null | head -1 | sed 's/.*Lua //'
}

install_sbarlua() {
    log_info "Setting up SbarLua..."

    # Activate mise to expose the lua interpreter (sketchybarrc uses the same approach)
    if [[ -x "${HOME}/.local/bin/mise" ]]; then
        eval "$(${HOME}/.local/bin/mise env -s bash 2>/dev/null)" || true
    fi

    if ! has_command "lua"; then
        log_error "lua not found in PATH. Install via mise (e.g. 'mise use -g lua@5.5') and retry."
        return 1
    fi

    local host_ver so_ver
    host_ver="$(lua -v 2>&1 | sed -n 's/^Lua \([0-9]*\.[0-9]*\).*/\1/p')"

    # SbarLua statically links a vendored Lua; the .so only works when loaded by
    # an interpreter of the same major.minor (mismatch = empty bar, no error).
    # Rebuild whenever the installed .so was built for a different Lua than the
    # one sketchybarrc will run.
    if [[ -f "$SBARLUA_TARGET" && "${FORCE:-false}" != "true" ]]; then
        so_ver="$(sbarlua_so_version "$SBARLUA_TARGET")"
        if [[ -n "$so_ver" && "$so_ver" == "$host_ver" ]]; then
            log_success "SbarLua already installed: $SBARLUA_TARGET (Lua ${so_ver})"
            log_info "  Run with FORCE=true to rebuild"
            return 0
        fi
        log_warn "SbarLua was built for Lua ${so_ver:-unknown} but lua is ${host_ver}; rebuilding"
    fi
    if ! has_command "git"; then
        log_error "git not found in PATH."
        return 1
    fi
    if ! has_command "make"; then
        log_error "make not found in PATH."
        return 1
    fi

    log_info "Using lua: $(command -v lua) ($(lua -v 2>&1))"

    # Clone or update the SbarLua source tree
    if [[ -d "${SBARLUA_CACHE_DIR}/.git" ]]; then
        log_info "Updating SbarLua at ${SBARLUA_CACHE_DIR}..."
        git -C "${SBARLUA_CACHE_DIR}" fetch --depth 1 origin
        git -C "${SBARLUA_CACHE_DIR}" reset --hard origin/HEAD
    else
        log_info "Cloning SbarLua to ${SBARLUA_CACHE_DIR}..."
        rm -rf "${SBARLUA_CACHE_DIR}"
        git clone --depth 1 "${SBARLUA_REPO}" "${SBARLUA_CACHE_DIR}"
    fi

    # Patch: disable orphan_check (`if (getppid() == 1) exit(0);`).
    # Under launchd the lua process's parent becomes init (PID 1) immediately,
    # which makes SbarLua self-exit ~1s after startup. That kills the event
    # loop, so subscribed callbacks (routine/forced/system_woke) never fire
    # and update_freq-driven refreshes silently stop working.
    local sbarlua_src="${SBARLUA_CACHE_DIR}/src/sketchybar.c"
    if [[ -f "$sbarlua_src" ]] && grep -q 'if (getppid() == 1) exit(0);' "$sbarlua_src"; then
        log_info "Patching SbarLua orphan_check for launchd compatibility..."
        sed -i '' 's|if (getppid() == 1) exit(0);|/* orphan_check disabled for launchd compatibility */|' "$sbarlua_src"
    fi

    log_info "Building & installing SbarLua..."
    make -C "${SBARLUA_CACHE_DIR}" clean >/dev/null 2>&1 || true
    if make -C "${SBARLUA_CACHE_DIR}" install; then
        if [[ -f "$SBARLUA_TARGET" ]]; then
            so_ver="$(sbarlua_so_version "$SBARLUA_TARGET")"
            log_success "SbarLua installed at $SBARLUA_TARGET (Lua ${so_ver:-unknown})"
            if [[ -n "$so_ver" && "$so_ver" != "$host_ver" ]]; then
                log_warn "SbarLua vendors Lua ${so_ver} but mise lua is ${host_ver}."
                log_warn "  Pin lua = \"${so_ver}\" in mise config, or sketchybarrc will fall back to 'mise exec lua@${so_ver}'."
            fi
        else
            log_error "make install completed but $SBARLUA_TARGET is missing."
            return 1
        fi
    else
        log_error "SbarLua build failed."
        return 1
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    log_info "Installing workspace domain..."

    install_sbarlua

    log_success "Workspace domain installation complete"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
