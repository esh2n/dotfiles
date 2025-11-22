#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Development Domain Installer
# 開発ドメインインストーラー
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# 1. System Tools (Brewfile)
# システムツール (Brewfile)
# -----------------------------------------------------------------------------

log_info "Installing Development Domain tools..."

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
    
    # Link mise config first if not already linked by manager
    # (Manager runs after domains usually, but mise needs config to install)
    # For now, we rely on global config or just install plugins
    
    # Install tools defined in global/local config
    mise install
    
    # Explicitly install uv if not present (though Brewfile should handle it or mise)
    # mise use -g python@latest
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
        # Skip comments and empty lines
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
# 4. Additional Setup
# 追加セットアップ
# -----------------------------------------------------------------------------

# Setup git-lfs
if has_command "git-lfs"; then
    log_info "Initializing git-lfs..."
    git lfs install
fi

log_success "Development Domain installed."
