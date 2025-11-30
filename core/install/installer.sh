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
    # このセッションでbrewをPATHに追加
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
    
    # -------------------------------------------------------------------------
    # Install Nix
    # Nixのインストール
    # -------------------------------------------------------------------------
    if ! has_command "nix"; then
        log_info "Installing Nix..."
        curl -L https://nixos.org/nix/install | sh -s -- --daemon
        
        # Source nix profile for this session
        # このセッションでnixプロファイルを読み込み
        if [[ -f "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" ]]; then
            source "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh"
        fi
    else
        log_success "Nix already installed."
    fi
    
    if ! has_command "nix"; then
        if [[ -f "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" ]]; then
            source "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh"
        fi
    fi
    
    # Verify nix is available
    # nixが利用可能であることを確認
    if has_command "nix"; then
        log_success "Nix is available: $(nix --version)"
        
        # Enable experimental features (required for flakes)
        # 実験的機能を有効化（flakesに必要）
        local nix_conf_dir="${HOME}/.config/nix"
        local nix_conf="${nix_conf_dir}/nix.conf"
        if [[ ! -f "$nix_conf" ]] || ! grep -q "experimental-features" "$nix_conf"; then
            log_info "Enabling Nix experimental features..."
            mkdir -p "$nix_conf_dir"
            echo "experimental-features = nix-command flakes" >> "$nix_conf"
        fi
    else
        log_warn "Nix is not available in PATH. You may need to restart your shell."
    fi
    
}

phase_core() {
    log_info "Phase 3: Core Setup"
    
    # -------------------------------------------------------------------------
    # Apply nix-darwin configuration (installs all packages via Nix)
    # nix-darwin設定を適用（Nixで全パッケージをインストール）
    # -------------------------------------------------------------------------
    if has_command "nix"; then
        log_info "Building and applying nix-darwin configuration..."
        local nix_dir="${DOTFILES_ROOT}/core/nix"
        
        if [[ -f "${nix_dir}/flake.nix" ]]; then
            # Backup files that nix-darwin will manage
            for f in /etc/bashrc /etc/zshrc; do
                if [[ -f "$f" ]] && [[ ! -f "$f.before-nix-darwin" ]]; then
                    log_info "Backing up $f..."
                    sudo mv "$f" "$f.before-nix-darwin"
                fi
            done
            
            # Build the darwin configuration
            local hostname="${USER}-mac"
            if nix build "${nix_dir}#darwinConfigurations.${hostname}.system" --impure -o "${nix_dir}/result"; then
                log_info "Applying nix-darwin configuration..."
                # Fix Homebrew symlink conflicts before activation
                if has_command "brew"; then
                    brew unlink ollama 2>/dev/null || true
                fi
                if sudo "${nix_dir}/result/activate"; then
                    log_success "nix-darwin configuration applied."
                else
                    log_error "nix-darwin activation failed."
                fi
            else
                log_warn "nix-darwin build failed."
            fi
        fi
    else
        log_warn "Nix not available. Skipping nix-darwin setup."
    fi
    
    # Setup zsh as default shell (if not already)
    if [[ "$SHELL" != */zsh ]]; then
        log_info "Changing default shell to zsh..."
        chsh -s "$(which zsh)"
    fi
    
    if has_command "cargo" && ! has_command "pacifica"; then
        cargo install --git https://github.com/serinuntius/pacifica
    fi

    # Install Tmux Plugin Manager (TPM)
    if [[ -L "$HOME/.tmux" ]] && [[ ! -e "$HOME/.tmux" ]]; then
        log_warn "Removing broken symlink at $HOME/.tmux"
        rm "$HOME/.tmux"
    fi

    if [[ ! -d "$HOME/.tmux/plugins" ]]; then
        mkdir -p "$HOME/.tmux/plugins"
    fi

    if [[ ! -d "$HOME/.tmux/plugins/tpm" ]]; then
        log_info "Installing Tmux Plugin Manager (TPM)..."
        git clone https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
    fi
}

phase_domains() {
    log_info "Phase 4: Domain Setup"
    
    for d in "${DOTFILES_ROOT}/domains/"*; do
        if [[ -d "$d" ]]; then
            local install_script="${d}/install.sh"
            if [[ -f "$install_script" ]]; then
                log_info "Installing domain: $(basename "$d")"
                bash "$install_script"
            fi
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
