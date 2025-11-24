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
    else
        log_success "Homebrew already installed."
    fi
    
    # Ensure brew is in PATH for this session (required for subsequent phases)
    # このセッションでbrewをPATHに確実に追加（後続フェーズで必要）
    if ! has_command "brew"; then
        if [[ -f "/opt/homebrew/bin/brew" ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -f "/usr/local/bin/brew" ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        else
            log_error "Homebrew installation not found. Please install Homebrew manually."
            exit 1
        fi
    fi
    
    # Verify brew is available
    # brewが利用可能であることを確認
    if ! has_command "brew"; then
        log_error "Homebrew is not available in PATH. Please check your installation."
        exit 1
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
    # 重要なツールをbrew経由でインストール（不足している場合）
    
    # Install zsh
    if ! has_command "zsh"; then
        brew install zsh
    fi
    
    # Setup zsh as default shell
    if [[ "$SHELL" != */zsh ]]; then
        log_info "Changing default shell to zsh..."
        chsh -s "$(which zsh)"
    fi
    
    # Install mise (prerequisite for language runtimes used across domains)
    # miseをインストール（複数ドメインで使用される言語ランタイムの前提条件）
    if ! has_command "mise" && ! is_brew_formula_installed "mise"; then
        log_info "Installing mise (prerequisite for language runtimes)..."
        brew install mise
    fi
    
    # Ensure mise is in PATH after installation
    # インストール後、miseをPATHに追加
    if ! has_command "mise"; then
        if [[ -f "/opt/homebrew/bin/mise" ]]; then
            export PATH="/opt/homebrew/bin:$PATH"
        elif [[ -f "/usr/local/bin/mise" ]]; then
            export PATH="/usr/local/bin:$PATH"
        fi
    fi
    
    # Verify mise is available
    # miseが利用可能であることを確認
    if ! has_command "mise"; then
        log_warn "mise is not available in PATH. Language runtime setup may fail."
    fi

    # Install Tmux Plugin Manager (TPM)
    # Install Tmux Plugin Manager (TPM)
    # Check for broken symlink at ~/.tmux
    if [[ -L "$HOME/.tmux" ]] && [[ ! -e "$HOME/.tmux" ]]; then
        log_warn "Removing broken symlink at $HOME/.tmux"
        rm "$HOME/.tmux"
    fi

    # Ensure directory exists
    if [[ ! -d "$HOME/.tmux/plugins" ]]; then
        mkdir -p "$HOME/.tmux/plugins"
    fi

    if [[ ! -d "$HOME/.tmux/plugins/tpm" ]]; then
        log_info "Installing Tmux Plugin Manager (TPM)..."
        git clone https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
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
    
    # Process templates first (e.g., mise config.toml.template, vscode settings.json.template)
    # テンプレートを先に処理（例: mise config.toml.template, vscode settings.json.template）
    log_info "Processing templates..."
    "${DOTFILES_ROOT}/core/config/manager.sh" template
    
    # Then create symlinks
    # その後、symlinkを作成
    log_info "Creating symlinks..."
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
