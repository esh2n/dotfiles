#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Installer (installer.sh)
# インストーラー (installer.sh)
# -----------------------------------------------------------------------------
# Main entry point for the dotfiles installation.
# Orchestrates validation, bootstrapping, core setup, and domain installation.
# ドットファイルインストールのメインエントリーポイントです。
# 検証、ブートストラップ、コアセットアップ、ドメインインストールを制御します。
# -----------------------------------------------------------------------------

# Source core modules
# コアモジュールの読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${DOTFILES_ROOT}/core/utils/common.sh"
# loader.sh is sourced by zshrc, not needed here directly unless we use lazy functions
# manager.sh is called as a script
# validator.sh is called as a script

# -----------------------------------------------------------------------------
# Phases
# -----------------------------------------------------------------------------

phase_validation() {
    log_info "Phase 1: Validation"
    "${DOTFILES_ROOT}/core/validation/validator.sh" pre
}

phase_bootstrap() {
    log_info "Phase 2: Bootstrap"
    
    # Install Homebrew
    if ! has_command "brew"; then
        log_info "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        
        # Add brew to path for this session
        if [[ -f "/opt/homebrew/bin/brew" ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -f "/usr/local/bin/brew" ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
    else
        log_success "Homebrew already installed."
    fi
    
    # Install Git (if not present, though usually comes with Xcode tools)
    if ! has_command "git"; then
        log_info "Installing Git..."
        brew install git
    fi
}

phase_core() {
    log_info "Phase 3: Core Setup"
    
    # Install critical tools via brew if missing
    # We might want a core Brewfile, but for now let's just ensure zsh
    if ! has_command "zsh"; then
        brew install zsh
    fi
    
    # Setup zsh as default shell
    if [[ "$SHELL" != */zsh ]]; then
        log_info "Changing default shell to zsh..."
        chsh -s "$(which zsh)"
    fi
}

phase_domains() {
    log_info "Phase 4: Domain Installation"
    
    # List available domains
    local domains=()
    for d in "${DOTFILES_ROOT}/domains/"*; do
        if [[ -d "$d" ]]; then
            domains+=("$(basename "$d")")
        fi
    done
    
    # TODO: Interactive selection or all
    # For now, install all
    for domain in "${domains[@]}"; do
        local install_script="${DOTFILES_ROOT}/domains/${domain}/install.sh"
        if [[ -f "$install_script" ]]; then
            log_info "Installing domain: ${domain}"
            # Execute domain installer
            bash "$install_script"
        else
            log_debug "No install script for domain: ${domain}"
        fi
    done
}

phase_config() {
    log_info "Phase 5: Configuration (Symlinking)"
    "${DOTFILES_ROOT}/core/config/manager.sh" link
}

phase_verify() {
    log_info "Phase 6: Verification"
    "${DOTFILES_ROOT}/core/validation/validator.sh" post
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    log_info "Starting Dotfiles Installation..."
    
    phase_validation
    phase_bootstrap
    phase_core
    phase_domains
    phase_config
    phase_verify
    
    log_success "Installation Complete!"
    log_info "Please restart your shell or computer."
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
