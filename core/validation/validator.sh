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
# `validator.sh harness-adapter` on its own always do exactly the same thing.
run_all_checks() {
    local suites=(
        portability
        merge-settings
        yoki-switch-targets
        targets-golden
        git-guard
        unattended-guard
        correction-distill
        worktree-guard
        yoki-box
        omp-yoki-bridge
        harness-adapter
        yoki-artifact
        yoki-graph
        suggest-compact
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
        "merge-settings")
            source "${SCRIPT_DIR}/test-merge-settings.sh"
            run_merge_settings_checks
            ;;
        "yoki-switch-targets")
            if ! command -v node >/dev/null 2>&1; then
                log_error "yoki-switch-targets requires node (for lib/targets/gen.js) — none found on PATH."
                exit 1
            fi
            source "${SCRIPT_DIR}/test-yoki-switch-targets.sh"
            run_yoki_switch_targets_checks
            ;;
        "targets-golden")
            if ! command -v node >/dev/null 2>&1; then
                log_error "targets-golden requires node (for lib/targets/gen.js) — none found on PATH."
                exit 1
            fi
            source "${SCRIPT_DIR}/test-targets-golden.sh"
            run_targets_golden_checks
            ;;
        "git-guard")
            source "${SCRIPT_DIR}/test-git-guard.sh"
            run_git_guard_checks
            ;;
        "unattended-guard")
            source "${SCRIPT_DIR}/test-unattended-guard.sh"
            run_unattended_guard_checks
            ;;
        "correction-distill")
            source "${SCRIPT_DIR}/test-correction-distill.sh"
            run_correction_distill_checks
            ;;
        "worktree-guard")
            source "${SCRIPT_DIR}/test-worktree-guard.sh"
            run_worktree_guard_checks
            ;;
        "yoki-box")
            source "${SCRIPT_DIR}/test-yoki-box.sh"
            run_yoki_box_checks
            ;;
        "omp-yoki-bridge")
            source "${SCRIPT_DIR}/test-omp-yoki-bridge.sh"
            run_omp_yoki_bridge_checks
            ;;
        "harness-adapter")
            if ! command -v node >/dev/null 2>&1; then
                log_error "harness-adapter requires node (for \`node --test\` and the real hook runners) — none found on PATH."
                exit 1
            fi

            node_unit_status=0
            node --test \
                "${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/harness/test/**/*.test.js" \
                "${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki/scripts/hooks/test/**/*.test.js" \
                || node_unit_status=$?

            source "${SCRIPT_DIR}/test-harness-adapter.sh"
            node_contract_status=0
            run_harness_adapter_checks || node_contract_status=$?

            if [[ "$node_unit_status" -ne 0 || "$node_contract_status" -ne 0 ]]; then
                exit 1
            fi
            ;;
        "yoki-artifact")
            if ! command -v node >/dev/null 2>&1; then
                log_error "yoki-artifact requires node (the CLI, the fake Worker and both \`node --test\` suites) — none found on PATH."
                exit 1
            fi

            source "${SCRIPT_DIR}/test-yoki-artifact.sh"
            run_yoki_artifact_checks
            ;;
        "yoki-graph")
            if ! command -v node >/dev/null 2>&1; then
                log_error "yoki-graph requires node (for \`node --test\` and the mock-backend CLI) — none found on PATH."
                exit 1
            fi

            source "${SCRIPT_DIR}/test-yoki-graph.sh"
            run_yoki_graph_checks
            ;;
        "suggest-compact")
            source "${SCRIPT_DIR}/test-suggest-compact.sh"
            run_suggest_compact_checks
            ;;
        "workday-calc")
            uv run "${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/skills/workday-calc/scripts/calc.py" --selftest
            ;;
        *)
            echo "Usage: $0 [pre|post|portability|merge-settings|yoki-switch-targets|targets-golden|git-guard|unattended-guard|correction-distill|worktree-guard|yoki-box|omp-yoki-bridge|harness-adapter|yoki-artifact|yoki-graph|suggest-compact|workday-calc]"
            echo "       (no args runs every self-contained regression suite)"
            exit 1
            ;;
    esac
fi
