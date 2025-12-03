#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Infrastructure Domain Installer
# -----------------------------------------------------------------------------
# Installs infrastructure-related configurations:
# - Browser extensions (Chrome, Dia, etc.)
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# Browser Extensions
# -----------------------------------------------------------------------------

install_browser_extensions() {
    log_info "Setting up browser extensions..."

    local script="${SCRIPT_DIR}/scripts/install-browser-extensions.sh"

    if [[ ! -f "$script" ]]; then
        log_warn "Browser extensions script not found: $script"
        return 0
    fi

    if bash "$script"; then
        log_success "Browser extensions configured"
        log_info "Extensions will be installed when you restart your browsers"
    else
        log_warn "Browser extensions configuration failed (non-critical)"
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    log_info "Installing infra domain..."

    install_browser_extensions

    log_success "Infra domain installation complete"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
