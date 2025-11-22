#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Dev Domain Installer
# 開発ドメインインストーラー
# -----------------------------------------------------------------------------
# All development tools: Terminal, Shell, Editor, Languages, DB, AI
# 全開発ツール: ターミナル, シェル, エディタ, 言語, DB, AI
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# 1. System Tools (Brewfile)
# システムツール (Brewfile)
# -----------------------------------------------------------------------------

log_info "Installing Dev Domain tools..."

if has_command "brew"; then
    log_info "Running brew bundle..."
    brew bundle --file="${SCRIPT_DIR}/packages/Brewfile"
else
    log_error "Homebrew not found. Skipping Brewfile."
fi

# -----------------------------------------------------------------------------
# 2. Language Runtimes & Tools (mise)
# 言語ランタイムとツール (mise)
# -----------------------------------------------------------------------------

if has_command "mise"; then
    log_info "Setting up mise..."
    mise install
else
    log_warn "mise not found. Skipping runtime setup."
fi

# -----------------------------------------------------------------------------
# 3. Package Manager Installations
# パッケージマネージャーインストール
# -----------------------------------------------------------------------------

# Cargo packages (Rust)
if has_command "cargo" && [[ -f "${SCRIPT_DIR}/packages/cargo.txt" ]]; then
    log_info "Installing Cargo packages..."
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ $line =~ ^#.*$ ]] && continue
        [[ -z $line ]] && continue
        
        package_name=$(echo "$line" | sed 's/\s*#.*$//')
        log_info "Installing: $package_name"
        
        if [[ $package_name == "pacifica" ]]; then
            cargo install --git https://github.com/serinuntius/pacifica.git || log_warn "Failed to install: $package_name"
        else
            cargo install "$package_name" || log_warn "Failed to install: $package_name"
        fi
    done < "${SCRIPT_DIR}/packages/cargo.txt"
fi

# Go packages
if has_command "go" && [[ -f "${SCRIPT_DIR}/packages/go.txt" ]]; then
    log_info "Installing Go packages..."
    export GOPATH="${HOME}/go"
    export GOBIN="${GOPATH}/bin"
    mkdir -p "$GOBIN"
    
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ $line =~ ^#.*$ ]] && continue
        [[ -z $line ]] && continue
        
        log_info "Installing: ${line}@latest"
        go install "${line}@latest" || log_warn "Failed to install: ${line}@latest"
    done < "${SCRIPT_DIR}/packages/go.txt"
fi

# Bun packages
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

# Gem packages (Ruby)
if has_command "gem" && [[ -f "${SCRIPT_DIR}/packages/gem.txt" ]]; then
    log_info "Installing Ruby gems..."
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ $line =~ ^#.*$ ]] && continue
        [[ -z $line ]] && continue
        
        package_name=$(echo "$line" | sed 's/\s*#.*$//')
        log_info "Installing: $package_name"
        gem install "$package_name" || log_warn "Failed to install: $package_name"
    done < "${SCRIPT_DIR}/packages/gem.txt"
fi

# -----------------------------------------------------------------------------
# 4. Neovim Setup
# Neovimセットアップ
# -----------------------------------------------------------------------------

# Ensure nvim-switcher is executable
if [[ -f "${SCRIPT_DIR}/bin/nvim-switch" ]]; then
    chmod +x "${SCRIPT_DIR}/bin/nvim-switch"
fi

# Install Neovim distributions if needed
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
# 5. Additional Setup
# 追加セットアップ
# -----------------------------------------------------------------------------

# Setup git-lfs
if has_command "git-lfs"; then
    log_info "Initializing git-lfs..."
    git lfs install
fi

log_success "Dev Domain installed."
