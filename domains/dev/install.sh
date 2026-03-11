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

# Harpoon: build from source with matching zellij-tile version
if [[ ! -f "$ZELLIJ_PLUGIN_DIR/harpoon.wasm" ]]; then
    if has_command "zellij" && has_command "cargo"; then
        ZELLIJ_VERSION=$(zellij --version | awk '{print $2}')
        log_info "Building harpoon plugin for Zellij ${ZELLIJ_VERSION}..."

        HARPOON_TMP="/tmp/harpoon-build-$$"
        git clone --depth 1 https://github.com/Nacho114/harpoon.git "$HARPOON_TMP" 2>/dev/null

        if [[ -d "$HARPOON_TMP" ]]; then
            cd "$HARPOON_TMP"
            # Update zellij-tile version to match installed zellij
            sed -i '' "s/zellij-tile = \".*\"/zellij-tile = \"${ZELLIJ_VERSION}\"/" Cargo.toml

            # Ensure wasm target is installed
            rustup target add wasm32-wasip1 2>/dev/null

            if cargo build --release --target wasm32-wasip1 2>/dev/null; then
                cp target/wasm32-wasip1/release/harpoon.wasm "$ZELLIJ_PLUGIN_DIR/"
                log_success "Harpoon plugin built successfully"
            else
                log_warn "Failed to build harpoon plugin"
            fi

            cd - > /dev/null
            rm -rf "$HARPOON_TMP"
        fi
    else
        log_warn "Skipping harpoon: zellij or cargo not installed"
    fi
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
