#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Productivity Domain Installer
# 生産性ドメインインストーラー
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# 1. System Tools (Brewfile)
# システムツール (Brewfile)
# -----------------------------------------------------------------------------

log_info "Installing Productivity Domain tools..."

if has_command "brew"; then
    log_info "Running brew bundle..."
    brew bundle --file="${SCRIPT_DIR}/packages/Brewfile"
else
    log_error "Homebrew not found. Skipping Brewfile."
fi

log_success "Productivity Domain installed."
