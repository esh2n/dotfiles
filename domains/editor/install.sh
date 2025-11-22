#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Editor Domain Installer
# エディタドメインインストーラー
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# 1. System Tools (Brewfile)
# システムツール (Brewfile)
# -----------------------------------------------------------------------------

log_info "Installing Editor Domain tools..."

if has_command "brew"; then
    log_info "Running brew bundle..."
    brew bundle --file="${SCRIPT_DIR}/packages/Brewfile"
else
    log_error "Homebrew not found. Skipping Brewfile."
fi

# -----------------------------------------------------------------------------
# 2. Neovim Setup
# Neovimセットアップ
# -----------------------------------------------------------------------------

# Ensure nvim-switcher is executable
if [[ -f "${SCRIPT_DIR}/bin/nvim-switch" ]]; then
    chmod +x "${SCRIPT_DIR}/bin/nvim-switch"
fi

# Install Neovim distributions if needed
# This is handled by nvim-switcher usually, but we can pre-clone
# NvChad
if [[ ! -d "${HOME}/.config/nvim-nvchad" ]]; then
    log_info "Cloning NvChad..."
    git clone https://github.com/NvChad/NvChad ~/.config/nvim-nvchad --depth 1
fi

# LazyVim
if [[ ! -d "${HOME}/.config/nvim-lazyvim" ]]; then
    log_info "Cloning LazyVim..."
    git clone https://github.com/LazyVim/starter ~/.config/nvim-lazyvim
fi

# AstroVim
if [[ ! -d "${HOME}/.config/nvim-astrovim" ]]; then
    log_info "Cloning AstroVim..."
    git clone --depth 1 https://github.com/AstroNvim/AstroNvim ~/.config/nvim-astrovim
fi

# -----------------------------------------------------------------------------
# 3. Bun Packages
# Bunパッケージ
# -----------------------------------------------------------------------------

if has_command "bun" && [[ -f "${SCRIPT_DIR}/packages/bun.txt" ]]; then
    log_info "Installing Bun packages..."
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ $line =~ ^#.*$ ]] && continue
        [[ -z $line ]] && continue
        
        package_name=$(echo "$line" | sed 's/\s*#.*$//')
        log_info "Installing: $package_name"
        bun install -g "$package_name" || log_warn "Failed to install: $package_name"
    done < "${SCRIPT_DIR}/packages/bun.txt"
fi

log_success "Editor Domain installed."
