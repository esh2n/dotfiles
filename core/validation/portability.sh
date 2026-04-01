#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Portability Checker (portability.sh)
# -----------------------------------------------------------------------------
# Detects hardcoded user-specific paths that break portability for other users.
# Usage: ./portability.sh [--fix-dry-run]
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

FAILED=0
PASSED=0
TOTAL=0

# -----------------------------------------------------------------------------
# Test helpers
# -----------------------------------------------------------------------------
assert_no_hardcoded_user() {
    local file="$1"
    local description="$2"
    local rel_path="${file#"$DOTFILES_ROOT"/}"
    TOTAL=$((TOTAL + 1))

    if [[ ! -f "$file" ]]; then
        log_warn "SKIP: $rel_path (file not found)"
        return 0
    fi

    # Match /Users/<anything>/ as absolute path (excluding templates like {{HOME}})
    # Match esh2n in path context (go/github.com/esh2n/ or /Users/esh2n/)
    local issues=""
    issues=$(grep -nE '(/Users/[a-zA-Z0-9_.]+/|go/github\.com/esh2n/)' "$file" \
        | grep -v '{{' \
        | grep -v '^\s*#.*example' \
        | grep -v 'shell-snapshots/' \
        || true)

    if [[ -n "$issues" ]]; then
        log_error "FAIL: $rel_path — $description"
        echo "$issues" | head -5 | while IFS= read -r line; do
            echo "       $line"
        done
        FAILED=$((FAILED + 1))
        return 1
    else
        log_success "PASS: $rel_path — $description"
        PASSED=$((PASSED + 1))
        return 0
    fi
}

assert_no_hardcoded_hostname() {
    local file="$1"
    local description="$2"
    local rel_path="${file#"$DOTFILES_ROOT"/}"
    TOTAL=$((TOTAL + 1))

    if [[ ! -f "$file" ]]; then
        log_warn "SKIP: $rel_path (file not found)"
        return 0
    fi

    local issues=""
    issues=$(grep -nE 'esh2n-mac' "$file" || true)

    if [[ -n "$issues" ]]; then
        log_error "FAIL: $rel_path — $description"
        echo "$issues" | while IFS= read -r line; do
            echo "       $line"
        done
        FAILED=$((FAILED + 1))
        return 1
    else
        log_success "PASS: $rel_path — $description"
        PASSED=$((PASSED + 1))
        return 0
    fi
}

assert_file_exists() {
    local file="$1"
    local description="$2"
    local rel_path="${file#"$DOTFILES_ROOT"/}"
    TOTAL=$((TOTAL + 1))

    if [[ -f "$file" ]]; then
        log_success "PASS: $rel_path — $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $rel_path — $description"
        FAILED=$((FAILED + 1))
    fi
}

assert_env_var_used() {
    local file="$1"
    local var_name="$2"
    local description="$3"
    local rel_path="${file#"$DOTFILES_ROOT"/}"
    TOTAL=$((TOTAL + 1))

    if [[ ! -f "$file" ]]; then
        log_warn "SKIP: $rel_path (file not found)"
        return 0
    fi

    if grep -q "\$$var_name\|$\{$var_name" "$file"; then
        log_success "PASS: $rel_path — $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $rel_path — $description"
        FAILED=$((FAILED + 1))
    fi
}

# -----------------------------------------------------------------------------
# Test suite
# -----------------------------------------------------------------------------
run_portability_checks() {
    log_info "=== Portability Check Suite ==="
    echo ""

    log_info "--- 1. CI: No hardcoded hostname ---"
    assert_no_hardcoded_hostname \
        "$DOTFILES_ROOT/.github/workflows/nix-build.yaml" \
        "CI should not hardcode hostname" || true

    echo ""
    log_info "--- 2. Shell config: No hardcoded user paths ---"
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/home/.zshrc" \
        ".zshrc should use variables, not absolute paths" || true

    echo ""
    log_info "--- 3. Scripts: No hardcoded user paths ---"
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/bin/claude-switch" \
        "claude-switch should use DOTFILES_ROOT or GITHUB_USER" || true

    echo ""
    log_info "--- 4. Claude settings (sources only, not merge output): No hardcoded user paths ---"
    # NOTE: domains/dev/config/claude/settings.json is a GENERATED file (output of claude-switch).
    # It is expected to contain resolved user-specific paths. Only test SOURCE files.
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/ecc/settings.layer.json" \
        "ECC layer should not contain esh2n paths" || true
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/ecc/CLAUDE.layer.md" \
        "ECC CLAUDE.md should not contain esh2n paths" || true
    # NOTE: domains/dev/config/claude/CLAUDE.md is a GENERATED file (output of claude-switch).
    # Only test the source CLAUDE.layer.md above.

    echo ""
    log_info "--- 5. VSCode: No hardcoded user paths ---"
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/vscode/settings.json.template" \
        "VSCode template should use {{HOME}} consistently" || true

    echo ""
    log_info "--- 6. Sketchybar: No hardcoded user paths ---"
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/workspace/config/sketchybar/plugins/weather.sh" \
        "weather.sh should use DOTFILES_ROOT" || true

    echo ""
    log_info "--- 7. Skills: No hardcoded user paths ---"
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/base/skills/morning-brief/SKILL.md" \
        "morning-brief should use variable paths" || true
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/base/skills/workday-calc/SKILL.md" \
        "workday-calc should use variable paths" || true
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/base/skills/workday-input/SKILL.md" \
        "workday-input should use variable paths" || true

    echo ""
    log_info "--- 8. Documentation ---"
    assert_file_exists \
        "$DOTFILES_ROOT/.env.example" \
        ".env.example should exist for required env vars"

    echo ""
    log_info "=== Results ==="
    echo ""
    if [[ "$FAILED" -gt 0 ]]; then
        log_error "FAILED: $FAILED / $TOTAL checks"
        log_info "PASSED: $PASSED / $TOTAL checks"
        return 1
    else
        log_success "ALL PASSED: $PASSED / $TOTAL checks"
        return 0
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_portability_checks
fi
