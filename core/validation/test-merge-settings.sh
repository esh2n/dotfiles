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
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "personal-hook" } ] }
    ]
  }
}
JSON

    # Permissions (T8): source of truth is permissions.yaml, not the
    # settings JSON above — see yoki-switch merge_settings().
    cat > "$profiles/core/permissions.yaml" <<'YAML'
allow:
  - pattern: "A"
deny:
  - pattern: "D1"
defaultMode: auto
YAML

    cat > "$profiles/personal/permissions.yaml" <<'YAML'
allow:
  - pattern: "B"
deny:
  - pattern: "D2"
defaultMode: auto
YAML

    # merge_settings() shells out to the real lib/permissions/to-claude.js —
    # symlink it into the fixture's own runtime/yoki tree so the DOTFILES_ROOT
    # override below (which isolates every other path from the real machine)
    # still resolves a working converter.
    local real_permissions_lib="$DOTFILES_ROOT/domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/permissions"
    mkdir -p "$profiles/runtime/yoki/scripts/lib/permissions"
    if [[ -d "$real_permissions_lib" ]]; then
        local lib_file
        for lib_file in "$real_permissions_lib"/*.js; do
            [[ -f "$lib_file" ]] || continue
            ln -sfn "$lib_file" "$profiles/runtime/yoki/scripts/lib/permissions/$(basename "$lib_file")"
        done
    fi

    # merge_settings() also shells out to lib/mcp-inventory/writers/claude.js
    # (task T13) — symlink the whole real directory in for the same reason.
    local real_mcp_inventory_lib="$DOTFILES_ROOT/domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/mcp-inventory"
    mkdir -p "$profiles/runtime/yoki/scripts/lib"
    if [[ -d "$real_mcp_inventory_lib" ]]; then
        ln -sfn "$real_mcp_inventory_lib" "$profiles/runtime/yoki/scripts/lib/mcp-inventory"
    fi

    # mcp.json (T13): a minimal core/personal layer pair — this fixture's own
    # data, not the real repo's — asserted against below (mirrors the
    # permissions.yaml fixture above).
    cat > "$profiles/core/mcp.json" <<'JSON'
{
  "schemaVersion": "ecc.mcp.v1",
  "servers": [
    { "name": "core-server", "transport": "http", "url": "https://core.example/mcp", "env": {}, "targets": { "claude": true, "codex": false, "omp": false } }
  ]
}
JSON

    cat > "$profiles/personal/mcp.json" <<'JSON'
{
  "schemaVersion": "ecc.mcp.v1",
  "servers": [
    { "name": "personal-server", "transport": "stdio", "command": "personal-cmd", "args": [], "env": {}, "targets": { "claude": true, "codex": false, "omp": false } }
  ]
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
    # --target claude (task T12): this suite only exercises the ~/.claude
    # merge, and the fixture's runtime/yoki tree only symlinks
    # lib/permissions (see build_fixture) — a bare `apply` would also try
    # the codex/omp targets via lib/targets/gen.js, which does not exist
    # under this fixture, and would spuriously fail (or spuriously pass)
    # depending on whether the machine running this test happens to have
    # ~/.codex or ~/.omp/agent already.
    if ! output=$(DOTFILES_ROOT="$FIXTURE" CLAUDE_DIR="$FIXTURE_CLAUDE" CURSOR_DIR="$FIXTURE/cursor" \
        bash "$CLAUDE_SWITCH" apply --target claude 2>&1); then
        log_error "FAIL: yoki-switch apply --target claude exited non-zero"
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

    # mcpServers (T13): sourced from mcp.json layers, not settings.layer.json.
    assert_jq_eq "mcpServers.core-server: from core/mcp.json" \
        '.mcpServers["core-server"].url' "https://core.example/mcp" "$settings"
    assert_jq_eq "mcpServers.personal-server: from personal/mcp.json" \
        '.mcpServers["personal-server"].command' "personal-cmd" "$settings"

    cleanup_fixture
    trap - RETURN

    # -------------------------------------------------------------------
    # mcpServers regression (T13): the REAL claude-profiles core/mcp.json +
    # personal/mcp.json (not the synthetic fixture above) must still convert
    # to exactly today's two figma servers — the content that used to live
    # directly in core/settings.layer.json's own `mcpServers` key.
    # -------------------------------------------------------------------
    TOTAL=$((TOTAL + 1))
    local real_profiles="${DOTFILES_ROOT}/domains/dev/config/claude-profiles"
    local real_claude_writer="${real_profiles}/runtime/yoki/scripts/lib/mcp-inventory/writers/claude.js"
    local real_mcp
    if ! real_mcp="$(node "$real_claude_writer" --sources "${real_profiles}/core/mcp.json" "${real_profiles}/personal/mcp.json" 2>&1)"; then
        log_error "FAIL: real mcp-inventory writers/claude.js exited non-zero"
        echo "$real_mcp" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
    else
        local expected_real_mcp='{"figma-remote":{"url":"https://mcp.figma.com/mcp","type":"http"},"figma-desktop":{"url":"http://127.0.0.1:3845/mcp","type":"http"}}'
        if [[ "$(echo "$real_mcp" | jq -Sc .)" == "$(echo "$expected_real_mcp" | jq -Sc .)" ]]; then
            log_success "PASS: real core/mcp.json + personal/mcp.json convert to today's exact figma-only mcpServers"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: real mcpServers output changed (expected '$expected_real_mcp', got '$real_mcp')"
            FAILED=$((FAILED + 1))
        fi
    fi

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
