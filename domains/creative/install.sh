#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Creative Domain Installer
# 制作ドメインインストーラー
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

log_info "Installing Creative Domain tools..."

# -----------------------------------------------------------------------------
# 1. System Tools (Brewfile)
# システムツール (Brewfile)
# -----------------------------------------------------------------------------

if has_command "brew"; then
    log_info "Running brew bundle..."
    brew bundle --file="${SCRIPT_DIR}/packages/Brewfile"
else
    log_error "Homebrew not found. Skipping Brewfile."
fi

# -----------------------------------------------------------------------------
# 2. Bun Packages
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

log_success "Creative Domain installed."
