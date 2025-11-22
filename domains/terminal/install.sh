#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Terminal Domain Installer
# ターミナルドメインインストーラー
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# 1. System Tools (Brewfile)
# システムツール (Brewfile)
# -----------------------------------------------------------------------------

log_info "Installing Terminal Domain tools..."

if has_command "brew"; then
    log_info "Running brew bundle..."
    brew bundle --file="${SCRIPT_DIR}/packages/Brewfile"
else
    log_error "Homebrew not found. Skipping Brewfile."
fi

# -----------------------------------------------------------------------------
# 2. Setup Starship
# Starshipセットアップ
# -----------------------------------------------------------------------------

# Starship init is handled in .zshrc via eval, but we ensure it's installed
if ! has_command "starship"; then
    log_warn "Starship not installed correctly."
fi

# -----------------------------------------------------------------------------
# 3. Setup Tmux/Zellij
# Tmux/Zellijセットアップ
# -----------------------------------------------------------------------------

if has_command "tmux"; then
    # Install TPM if needed
    if [[ ! -d "${HOME}/.tmux/plugins/tpm" ]]; then
        log_info "Installing Tmux Plugin Manager..."
        git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
    fi
fi

log_success "Terminal Domain installed."
