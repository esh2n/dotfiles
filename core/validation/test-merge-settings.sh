#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Merge Settings Regression Test (test-merge-settings.sh)
# -----------------------------------------------------------------------------
# Verifies domains/dev/bin/yoki-switch's `apply` merge semantics for
# settings.json: personal wins scalar keys, permissions.deny/allow are a
# union, and personal hook entries run before core hook entries.
#
# Runs yoki-switch against a synthetic fixture tree (built under mktemp)
# via CLAUDE_DIR / CURSOR_DIR / DOTFILES_ROOT overrides, so the real
# ~/.claude on this machine is never touched.
#
# Usage: ./test-merge-settings.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

CLAUDE_SWITCH="${DOTFILES_ROOT}/domains/dev/bin/yoki-switch"

FAILED=0
PASSED=0
TOTAL=0

# -----------------------------------------------------------------------------
# Fixture
# -----------------------------------------------------------------------------
FIXTURE=""
FIXTURE_CLAUDE=""

cleanup_fixture() {
    if [[ -n "$FIXTURE" && -d "$FIXTURE" ]]; then
        /bin/rm -rf "$FIXTURE"
    fi
}

build_fixture() {
    FIXTURE="$(mktemp -d)"
    FIXTURE_CLAUDE="$FIXTURE/claude"

    local profiles="$FIXTURE/domains/dev/config/claude-profiles"
    mkdir -p "$profiles/core"
    mkdir -p "$profiles/personal"
    mkdir -p "$profiles/packs"
    mkdir -p "$profiles/runtime/yoki"

    cat > "$profiles/core/settings.layer.json" <<'JSON'
{
  "model": "core-model",
  "env": { "FOO": "core" },
  "permissions": {
    "allow": ["A"],
    "deny": ["D1"]
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "layer-hook" } ] }
    ]
  }
}
JSON

    cat > "$profiles/personal/settings.personal.json" <<'JSON'
{
  "model": "personal-model",
  "env": { "FOO": "personal" },
  "permissions": {
    "allow": ["B"],
    "deny": ["D2"]
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "personal-hook" } ] }
    ]
  }
}
JSON

    : > "$profiles/core/CLAUDE.layer.md"
    : > "$profiles/personal/CLAUDE.personal.md"
    : > "$profiles/packs.default"
}

# -----------------------------------------------------------------------------
# Test helpers
# -----------------------------------------------------------------------------
assert_jq_eq() {
    local description="$1" filter="$2" expected="$3" file="$4"
    TOTAL=$((TOTAL + 1))

    local actual
    actual=$(jq -r "$filter" "$file" 2>/dev/null || echo "<jq-error>")

    if [[ "$actual" == "$expected" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected '$expected', got '$actual')"
        FAILED=$((FAILED + 1))
    fi
}

assert_jq_true() {
    local description="$1" filter="$2" file="$3"
    TOTAL=$((TOTAL + 1))

    if jq -e "$filter" "$file" >/dev/null 2>&1; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (jq filter: $filter)"
        FAILED=$((FAILED + 1))
    fi
}

# -----------------------------------------------------------------------------
# Test suite
# -----------------------------------------------------------------------------
run_merge_settings_checks() {
    log_info "=== Merge Settings Test Suite ==="
    echo ""

    build_fixture
    trap cleanup_fixture RETURN

    local output
    if ! output=$(DOTFILES_ROOT="$FIXTURE" CLAUDE_DIR="$FIXTURE_CLAUDE" CURSOR_DIR="$FIXTURE/cursor" \
        bash "$CLAUDE_SWITCH" apply 2>&1); then
        log_error "FAIL: yoki-switch apply exited non-zero"
        echo "$output" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
        TOTAL=$((TOTAL + 1))
        cleanup_fixture
        trap - RETURN
        log_error "FAILED: $FAILED / $TOTAL checks"
        return 1
    fi

    local settings="$FIXTURE_CLAUDE/settings.json"
    if [[ ! -f "$settings" ]]; then
        log_error "FAIL: $settings was not generated"
        FAILED=$((FAILED + 1))
        TOTAL=$((TOTAL + 1))
        cleanup_fixture
        trap - RETURN
        log_error "FAILED: $FAILED / $TOTAL checks"
        return 1
    fi

    assert_jq_eq "model: personal wins over core" \
        '.model' "personal-model" "$settings"

    assert_jq_eq "env.FOO: personal wins over core" \
        '.env.FOO' "personal" "$settings"

    assert_jq_true "permissions.deny: union contains D1 (core)" \
        '.permissions.deny | index("D1") != null' "$settings"
    assert_jq_true "permissions.deny: union contains D2 (personal)" \
        '.permissions.deny | index("D2") != null' "$settings"

    assert_jq_true "permissions.allow: union contains A (core)" \
        '.permissions.allow | index("A") != null' "$settings"
    assert_jq_true "permissions.allow: union contains B (personal)" \
        '.permissions.allow | index("B") != null' "$settings"

    assert_jq_eq "hooks.PreToolUse[0]: personal hook runs first" \
        '.hooks.PreToolUse[0].hooks[0].command' "personal-hook" "$settings"

    cleanup_fixture
    trap - RETURN

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
    run_merge_settings_checks
fi
