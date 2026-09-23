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
# Default (no-args) run: every self-contained regression suite, in one pass.
# -----------------------------------------------------------------------------
# Excludes "pre"/"post" (real sudo/internet/brew checks against this machine,
# not a repeatable regression suite) and "workday-calc" (needs `uv`, a skill
# runtime dependency rather than a harness/hook one). Each suite is re-run as
# its own case invocation of this same script, so the default run and e.g.
# `validator.sh portability` on its own always do exactly the same thing.
run_all_checks() {
    local suites=(
        portability
        pi-links
        dsh-links
        code-graph-cache-gc
        artifact
    )

    local overall_failed=0
    local suite status
    for suite in "${suites[@]}"; do
        echo "============================================================"
        log_info "Suite: $suite"
        echo "============================================================"
        status=0
        "${BASH_SOURCE[0]}" "$suite" || status=$?
        if [[ "$status" -ne 0 ]]; then
            overall_failed=1
            log_error "Suite failed: $suite"
        fi
        echo ""
    done

    if [[ "$overall_failed" -ne 0 ]]; then
        log_error "One or more suites failed."
        return 1
    fi

    log_success "All suites passed."
    return 0
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-}" in
        "")
            run_all_checks
            ;;
        "pre")
            check_requirements
            ;;
        "post")
            run_validation
            ;;
        "portability")
            source "${SCRIPT_DIR}/portability.sh"
            run_portability_checks
            ;;
        "pi-links")
            source "${SCRIPT_DIR}/test-pi-links.sh"
            run_pi_links_checks
            ;;
        "dsh-links")
            source "${SCRIPT_DIR}/test-dsh-links.sh"
            run_dsh_links_checks
            ;;
        "code-graph-cache-gc")
            bash "${SCRIPT_DIR}/test-code-graph-cache-gc.sh"
            ;;
        "artifact")
            if ! command -v node >/dev/null 2>&1; then
                log_error "artifact requires node (the CLI, the fake Worker and both \`node --test\` suites) — none found on PATH."
                exit 1
            fi

            source "${SCRIPT_DIR}/test-artifact.sh"
            run_artifact_checks
            ;;
        "workday-calc")
            uv run "${DOTFILES_ROOT}/domains/dev/llm/harness/skills/workday-calc/scripts/calc.py" --selftest
            ;;
        *)
            echo "Usage: $0 [pre|post|portability|pi-links|dsh-links|code-graph-cache-gc|artifact|workday-calc]"
            echo "       (no args runs every self-contained regression suite)"
            exit 1
            ;;
    esac
fi
