#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Validator (validator.sh)
# バリデーター (validator.sh)
# -----------------------------------------------------------------------------
# Performs pre-flight checks and post-installation validation.
# 事前チェックとインストール後の検証を実行します。
# -----------------------------------------------------------------------------

# Source common utilities
# 共通ユーティリティの読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# Pre-flight Checks
# -----------------------------------------------------------------------------

check_os() {
    log_info "Checking OS..."
    if ! is_macos; then
        log_error "This dotfiles setup is designed for macOS."
        return 1
    fi
    
    # Check macOS version (e.g., 14.0+)
    if ! check_macos_version "14.0"; then
        log_warn "macOS version is older than 14.0. Some features may not work."
    else
        log_success "macOS version $(get_os_version) is supported."
    fi
}

check_internet() {
    log_info "Checking internet connection..."
    if ping -c 1 google.com &>/dev/null; then
        log_success "Internet connection active."
    else
        log_error "No internet connection."
        return 1
    fi
}

check_sudo() {
    log_info "Checking sudo access..."
    if sudo -v; then
        log_success "Sudo access confirmed."
    else
        log_error "Sudo access required."
        return 1
    fi
}

check_requirements() {
    log_info "Running pre-flight checks..."
    local failed=0
    
    check_os || failed=1
    check_internet || failed=1
    check_sudo || failed=1
    
    if [[ "$failed" -eq 1 ]]; then
        log_error "Pre-flight checks failed."
        exit 1
    fi
    
    log_success "All pre-flight checks passed."
}

# -----------------------------------------------------------------------------
# Post-install Validation
# -----------------------------------------------------------------------------

validate_command() {
    local cmd="$1"
    if has_command "$1"; then
        log_success "Command found: $cmd"
    else
        log_error "Command missing: $cmd"
        return 1
    fi
}

validate_symlink() {
    local path="$1"
    if [[ -L "$path" ]]; then
        log_success "Symlink exists: $path"
    else
        log_error "Symlink missing or invalid: $path"
        return 1
    fi
}

run_validation() {
    log_info "Running post-install validation..."
    
    # Core tools
    validate_command "git"
    validate_command "brew"
    validate_command "zsh"
    
    # Check critical symlinks (example)
    # validate_symlink "${HOME}/.zshrc"
    
    log_info "Validation complete."
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-}" in
        "pre")
            check_requirements
            ;;
        "post")
            run_validation
            ;;
        *)
            echo "Usage: $0 {pre|post}"
            exit 1
            ;;
    esac
fi
