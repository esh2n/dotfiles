#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Dev Domain Installer
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

log_info "Installing Dev Domain tools..."

# -----------------------------------------------------------------------------
# 1. Language Runtimes (mise)
# -----------------------------------------------------------------------------

if has_command "mise"; then
    log_info "Installing language runtimes via mise..."
    eval "$(mise activate bash)" 2>/dev/null || true
    
    if [[ -f "${HOME}/.config/mise/config.toml" ]]; then
        mise install
    elif [[ -f "${SCRIPT_DIR}/config/mise/config.toml" ]]; then
        MISE_CONFIG_DIR="${SCRIPT_DIR}/config/mise" mise install
    fi
    
    eval "$(mise activate bash)" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 2. Neovim Distributions
# -----------------------------------------------------------------------------

if [[ -f "${SCRIPT_DIR}/bin/nvim-switch" ]]; then
    chmod +x "${SCRIPT_DIR}/bin/nvim-switch"
fi

if [[ ! -d "${HOME}/.config/nvim-nvchad" ]]; then
    log_info "Cloning NvChad..."
    git clone https://github.com/NvChad/NvChad ~/.config/nvim-nvchad --depth 1
fi

if [[ ! -d "${HOME}/.config/nvim-lazyvim" ]]; then
    log_info "Cloning LazyVim..."
    git clone https://github.com/LazyVim/starter ~/.config/nvim-lazyvim
fi

if [[ ! -d "${HOME}/.config/nvim-astrovim" ]]; then
    log_info "Cloning AstroVim..."
    git clone --depth 1 https://github.com/AstroNvim/AstroNvim ~/.config/nvim-astrovim
fi

# -----------------------------------------------------------------------------
# 3. Zellij Plugins
# -----------------------------------------------------------------------------

log_info "Setting up Zellij plugins..."
ZELLIJ_PLUGIN_DIR="${HOME}/.config/zellij/plugins"
    mkdir -p "$ZELLIJ_PLUGIN_DIR"

if [[ ! -f "$ZELLIJ_PLUGIN_DIR/zjstatus.wasm" ]]; then
    curl -L -o "$ZELLIJ_PLUGIN_DIR/zjstatus.wasm" \
        "https://github.com/dj95/zjstatus/releases/latest/download/zjstatus.wasm" || \
        log_warn "Failed to download zjstatus plugin"
fi

if [[ ! -f "$ZELLIJ_PLUGIN_DIR/harpoon.wasm" ]]; then
    curl -L -o "$ZELLIJ_PLUGIN_DIR/harpoon.wasm" \
        "https://github.com/Nacho114/harpoon/releases/latest/download/harpoon.wasm" || \
        log_warn "Failed to download harpoon plugin"
fi

if [[ ! -f "$ZELLIJ_PLUGIN_DIR/monocle.wasm" ]]; then
    curl -L -o "$ZELLIJ_PLUGIN_DIR/monocle.wasm" \
        "https://github.com/imsnif/monocle/releases/latest/download/monocle.wasm" || \
        log_warn "Failed to download monocle plugin"
fi

# -----------------------------------------------------------------------------
# 4. Additional Setup
# -----------------------------------------------------------------------------

if has_command "git-lfs"; then
    log_info "Initializing git-lfs..."
    git lfs install
fi

log_success "Dev Domain installed."
