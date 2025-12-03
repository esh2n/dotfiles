#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# System Domain Installer
# -----------------------------------------------------------------------------
# Installs system-related configurations:
# - Browser extensions (Chrome, Dia, etc.)
# - Userstyles (GitHub, YouTube, ChatGPT themes)
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------

install_dependencies() {
    log_info "Checking dependencies for userstyles generation..."

    # Check if lessc is available
    if ! command -v lessc &> /dev/null; then
        log_error "lessc not found. Please run the main installer first:"
        log_info "  cd ${DOTFILES_ROOT}"
        log_info "  ./core/install/installer.sh"
        log_info ""
        log_info "The main installer will set up nix-darwin with all required dependencies."
        return 1
    else
        log_success "LESS compiler available: $(lessc --version)"
    fi

    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        log_error "jq not found. Please run the main installer first:"
        log_info "  cd ${DOTFILES_ROOT}"
        log_info "  ./core/install/installer.sh"
        return 1
    else
        log_success "jq available: $(jq --version)"
    fi
}

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
# Userstyles
# -----------------------------------------------------------------------------

install_userstyles() {
    log_info "Generating userstyles for all themes..."

    # Generate LESS variables first
    local vars_script="${SCRIPT_DIR}/userstyles/scripts/generate-less-variables.sh"
    if [[ -f "$vars_script" ]]; then
        if bash "$vars_script" --all >/dev/null 2>&1; then
            log_success "Generated LESS variables"
        fi
    fi

    # Generate userstyles
    local script="${SCRIPT_DIR}/userstyles/scripts/generate-userstyles.sh"

    if [[ ! -f "$script" ]]; then
        log_warn "Userstyles generation script not found: $script"
        return 0
    fi

    # Generate userstyles for all themes
    if bash "$script" --all; then
        log_success "Userstyles generated for all themes"
    else
        log_warn "Userstyles generation failed (non-critical)"
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    log_info "Installing system domain..."

    install_dependencies
    install_browser_extensions
    install_userstyles

    log_success "System domain installation complete"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
