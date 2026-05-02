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

install_sbarlua() {
    log_info "Setting up SbarLua..."

    if [[ -f "$SBARLUA_TARGET" && "${FORCE:-false}" != "true" ]]; then
        log_success "SbarLua already installed: $SBARLUA_TARGET"
        log_info "  Run with FORCE=true to rebuild"
        return 0
    fi

    # Activate mise to expose the lua interpreter (sketchybarrc uses the same approach)
    if [[ -x "${HOME}/.local/bin/mise" ]]; then
        eval "$(${HOME}/.local/bin/mise env -s bash 2>/dev/null)" || true
    fi

    if ! has_command "lua"; then
        log_error "lua not found in PATH. Install via mise (e.g. 'mise use -g lua@5.5') and retry."
        return 1
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
    if make -C "${SBARLUA_CACHE_DIR}" install; then
        if [[ -f "$SBARLUA_TARGET" ]]; then
            log_success "SbarLua installed at $SBARLUA_TARGET"
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
