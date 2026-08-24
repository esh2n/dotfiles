#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Dev Domain Installer
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

log_info "Installing Dev Domain tools..."

# -----------------------------------------------------------------------------
# 0. Capsule prompt daemon (idempotent; requires capsule from nix flake input)
# -----------------------------------------------------------------------------

if has_command "capsule"; then
    if [[ ! -S "${HOME}/.capsule/capsule.sock" ]]; then
        log_info "Registering capsule prompt daemon (launchd)..."
        capsule daemon install || log_warn "capsule daemon install failed (non-critical)"
    fi
fi

# -----------------------------------------------------------------------------
# 1. Language Runtimes (mise)
# -----------------------------------------------------------------------------

if has_command "mise"; then
    log_info "Installing language runtimes via mise..."
    eval "$(mise activate bash)" 2>/dev/null || true

    if [[ -f "${HOME}/.config/mise/config.toml" ]]; then
        # This file is managed by these dotfiles. mise invalidates trust when
        # its content changes, so reconcile trust before every install/update.
        mise trust "${HOME}/.config/mise/config.toml" >/dev/null || \
            log_warn "Failed to trust managed mise config"
        mise install
    elif [[ -f "${SCRIPT_DIR}/config/mise/config.toml" ]]; then
        mise trust "${SCRIPT_DIR}/config/mise/config.toml" >/dev/null || \
            log_warn "Failed to trust managed mise config"
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

# Default ~/.config/nvim to lazyvim on first setup. Idempotent: skips if the
# user has already switched to a different distro (symlink / dir already present).
if [[ ! -L "${HOME}/.config/nvim" && ! -e "${HOME}/.config/nvim" ]]; then
    log_info "Setting default nvim config to 'lazyvim'..."
    bash "${SCRIPT_DIR}/bin/nvim-switch" lazyvim || log_warn "nvim-switch lazyvim failed (non-critical)"
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

# GitHub CLI extensions are state managed by gh itself. Install missing
# extensions here, but keep upgrades explicit so a dotfiles rebuild cannot
# silently change their behaviour.
if has_command "gh"; then
    if ! gh extension list 2>/dev/null | grep -Fq "orangain/gh-pr-graph"; then
        log_info "Installing gh-pr-graph extension..."
        gh extension install orangain/gh-pr-graph || \
            log_warn "gh-pr-graph installation failed (is gh authenticated?)"
    fi
fi

# Codebase-Memory is packaged by Nix. Its daemon coordinates concurrent
# Claude/Codex sessions and serializes per-project graph mutations.
if has_command "codebase-memory-mcp"; then
    codebase-memory-mcp config set auto_index true >/dev/null || \
        log_warn "Failed to enable Codebase-Memory auto-index"
    codebase-memory-mcp config set auto_watch true >/dev/null || \
        log_warn "Failed to enable Codebase-Memory watcher"
fi

# Claude stores user-scoped MCP servers in ~/.claude.json, outside the symlinked
# ~/.claude directory. Project/local entries retain higher precedence.
if has_command "claude"; then
    if ! claude mcp get codebase-memory-mcp >/dev/null 2>&1; then
        log_info "Registering Codebase-Memory MCP for Claude Code..."
        claude mcp add --transport stdio --scope user codebase-memory-mcp -- \
            "${HOME}/bin/codebase-memory-mcp-managed" || \
            log_warn "Failed to register Codebase-Memory MCP for Claude Code"
    fi

    if ! claude mcp get serena >/dev/null 2>&1; then
        log_info "Registering Serena MCP for Claude Code..."
        claude mcp add --transport stdio --scope user serena -- uvx -p 3.13 \
            serena-agent==1.5.3 start-mcp-server --project-from-cwd \
            --context claude-code || \
            log_warn "Failed to register Serena MCP for Claude Code"
    fi
fi

# ~/.codex/config.toml contains machine-local trust and hook state, so it is
# intentionally not replaced wholesale by the tracked template. Reconcile MCP
# entries through the Codex CLI to preserve that local state.
if has_command "codex"; then
    if ! codex mcp get codebase-memory-mcp >/dev/null 2>&1; then
        log_info "Registering Codebase-Memory MCP for Codex..."
        codex mcp add codebase-memory-mcp -- \
            "${HOME}/bin/codebase-memory-mcp-managed" || \
            log_warn "Failed to register Codebase-Memory MCP for Codex"
    fi

    if ! codex mcp get serena >/dev/null 2>&1; then
        log_info "Registering Serena MCP for Codex..."
        codex mcp add serena -- uvx -p 3.13 serena-agent==1.5.3 \
            start-mcp-server --project-from-cwd --context codex || \
            log_warn "Failed to register Serena MCP for Codex"
    fi
fi

log_success "Dev Domain installed."
