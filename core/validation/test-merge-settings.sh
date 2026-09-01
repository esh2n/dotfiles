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

    # apply() also shells out to lib/external-links.js (task T35) via
    # link_external_resources() — symlink it in for the same reason.
    local real_external_links_lib="$DOTFILES_ROOT/domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/external-links.js"
    if [[ -f "$real_external_links_lib" ]]; then
        ln -sfn "$real_external_links_lib" "$profiles/runtime/yoki/scripts/lib/external-links.js"
    fi

    # ...and real external-links.yaml layers, so the BASH half of that feature
    # is exercised end to end: node JSON -> jq @tsv -> read loop -> ln -sfn.
    # lib/test/external-links.test.js covers the JS functions in-process and
    # lib/test/doctor.test.js the read path, but neither drives the field
    # order, the TSV split, or the actual symlink side effect.
    #
    # `core prompts` has a space in it deliberately: the read loop splits on
    # TAB, and a path with a space is what naive whitespace splitting breaks.
    mkdir -p "$FIXTURE/srcs/core prompts" "$FIXTURE/srcs/personal-prompts"
    : > "$FIXTURE/srcs/core prompts/one.md"
    : > "$FIXTURE/srcs/personal-prompts/two.md"

    cat > "$profiles/core/external-links.yaml" <<YAML
- {dest: commands/shared-prompts, src: $FIXTURE/srcs/core prompts, purpose: core layer}
- {dest: skills/only-core, src: $FIXTURE/srcs/core prompts, purpose: core-only entry}
- {dest: agents/absent, src: $FIXTURE/srcs/not-on-this-machine, purpose: src missing here}
YAML

    cat > "$profiles/personal/external-links.yaml" <<YAML
- {dest: commands/shared-prompts, src: $FIXTURE/srcs/personal-prompts, purpose: personal overrides core}
YAML

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

assert_symlink_target() {
    local description="$1" link="$2" expected="$3"
    TOTAL=$((TOTAL + 1))

    if [[ ! -L "$link" ]]; then
        log_error "FAIL: $description ($link is not a symlink)"
        FAILED=$((FAILED + 1))
        return 0
    fi

    local actual
    actual="$(readlink "$link")"
    if [[ "$actual" == "$expected" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description (expected '$expected', got '$actual')"
        FAILED=$((FAILED + 1))
    fi
}

assert_path_absent() {
    local description="$1" target="$2"
    TOTAL=$((TOTAL + 1))

    if [[ -e "$target" || -L "$target" ]]; then
        log_error "FAIL: $description ($target exists)"
        FAILED=$((FAILED + 1))
    else
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    fi
}

# _mtime_of <path> — epoch mtime, BSD stat first then GNU. Both are
# lstat-by-default, so a dangling symlink is reported, never followed.
_mtime_of() {
    stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null || echo "?"
}

# tree_mtimes <dir> — "<relative path><TAB><epoch mtime>" for the directory
# itself and everything under it, LC_ALL=C sorted.
#
# Complements common.sh's tree_manifest() (content hashes) for the
# `apply --dry-run` untouched-tree assertion: a rewrite that happens to
# reproduce the same bytes still moves the file's mtime, and merge_dir()'s
# wipe-and-restage moves the staging DIRECTORY's mtime even when every entry
# comes back identical. Directories are included for exactly that reason.
tree_mtimes() {
    local dir="$1"
    [[ -d "$dir" ]] || return 0
    (
        cd "$dir" || return 0
        printf '.\t%s\n' "$(_mtime_of .)"
        find . -mindepth 1 | LC_ALL=C sort | while IFS= read -r f; do
            printf '%s\t%s\n' "${f#./}" "$(_mtime_of "$f")"
        done
    )
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

    # External links (T35): link_external_resources() end to end.
    assert_symlink_target "external-link: personal layer wins the same dest" \
        "$FIXTURE_CLAUDE/.commands-merged/shared-prompts" "$FIXTURE/srcs/personal-prompts"
    assert_symlink_target "external-link: a core-only entry is linked, space in src survives the TSV split" \
        "$FIXTURE_CLAUDE/.skills-merged/only-core" "$FIXTURE/srcs/core prompts"
    assert_path_absent "external-link: an entry whose src is absent on this machine is skipped, not linked" \
        "$FIXTURE_CLAUDE/.agents-merged/absent"

    TOTAL=$((TOTAL + 1))
    if printf '%s\n' "$output" | grep -q "External links: 2 linked"; then
        log_success "PASS: external-link: apply reports exactly the 2 resolvable links"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: external-link: apply did not report 'External links: 2 linked'"
        printf '%s\n' "$output" | grep -i 'external' | sed 's/^/       /' || true
        FAILED=$((FAILED + 1))
    fi

    # -------------------------------------------------------------------
    # apply --dry-run, claude target: prints the plan, writes NOTHING under
    # CLAUDE_DIR. The fixture has just been applied for real above, so the
    # planned output must also come out byte-identical ("(no change)") —
    # that is what proves the plan is the real merge run against a throwaway
    # CLAUDE_DIR rather than a hand-written description of it.
    # -------------------------------------------------------------------
    local before_tree before_mtimes after_tree after_mtimes
    before_tree="$(tree_manifest "$FIXTURE_CLAUDE")"
    before_mtimes="$(tree_mtimes "$FIXTURE_CLAUDE")"

    local dry_output dry_status=0
    dry_output=$(DOTFILES_ROOT="$FIXTURE" CLAUDE_DIR="$FIXTURE_CLAUDE" CURSOR_DIR="$FIXTURE/cursor" \
        bash "$CLAUDE_SWITCH" apply --target claude --dry-run 2>&1) || dry_status=$?

    after_tree="$(tree_manifest "$FIXTURE_CLAUDE")"
    after_mtimes="$(tree_mtimes "$FIXTURE_CLAUDE")"

    TOTAL=$((TOTAL + 1))
    if [[ "$dry_status" -eq 0 ]]; then
        log_success "PASS: dry-run: apply --target claude --dry-run exits 0"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: dry-run: apply --target claude --dry-run exited $dry_status"
        echo "$dry_output" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
    fi

    assert_eq_text "dry-run: CLAUDE_DIR file tree is byte-identical afterwards" \
        "$before_tree" "$after_tree"
    assert_eq_text "dry-run: CLAUDE_DIR mtimes (files and dirs) are unchanged afterwards" \
        "$before_mtimes" "$after_mtimes"

    assert_contains "dry-run: plan says nothing is written" \
        "Plan only" "$dry_output"
    assert_contains "dry-run: plan reports the settings.json diff section" \
        "--- settings.json ---" "$dry_output"
    assert_contains "dry-run: plan reports the CLAUDE.md diff section" \
        "--- CLAUDE.md ---" "$dry_output"
    assert_contains "dry-run: plan reports the permissions.json diff section" \
        "--- .yoki/permissions.json ---" "$dry_output"
    assert_contains "dry-run: plan reports the external links section" \
        "--- external links ---" "$dry_output"
    assert_contains "dry-run: plan lists a staging dir from MERGE_DIRS with per-layer counts" \
        ".skills-merged" "$dry_output"
    assert_contains "dry-run: plan names the external link that would be linked" \
        "commands/shared-prompts" "$dry_output"
    assert_contains "dry-run: plan names the external link that would be skipped" \
        "agents/absent" "$dry_output"
    assert_lacks "dry-run: the claude target is planned, not skipped as unsupported" \
        "no dry-run mode" "$dry_output"

    # Re-running the plan over an already-applied tree must find nothing to
    # change: three "(no change)" lines, one per diffed file.
    TOTAL=$((TOTAL + 1))
    local no_change_count
    no_change_count="$(printf '%s\n' "$dry_output" | grep -cF '(no change)' || true)"
    if [[ "$no_change_count" == "3" ]]; then
        log_success "PASS: dry-run: right after an apply the plan reports no change to all 3 files"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: dry-run: expected 3 '(no change)' lines, got $no_change_count"
        echo "$dry_output" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
    fi

    # ...and a real pending change must show up as a real diff, still
    # without touching CLAUDE_DIR.
    cat > "$FIXTURE/domains/dev/config/claude-profiles/personal/settings.personal.json" <<'JSON'
{
  "model": "dry-run-model",
  "env": { "FOO": "personal" },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "personal-hook" } ] }
    ]
  }
}
JSON

    local pending_output pending_status=0
    pending_output=$(DOTFILES_ROOT="$FIXTURE" CLAUDE_DIR="$FIXTURE_CLAUDE" CURSOR_DIR="$FIXTURE/cursor" \
        bash "$CLAUDE_SWITCH" apply --target claude --dry-run 2>&1) || pending_status=$?

    TOTAL=$((TOTAL + 1))
    if [[ "$pending_status" -eq 0 ]]; then
        log_success "PASS: dry-run: exits 0 even when the diff is non-empty"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: dry-run: exited $pending_status on a non-empty diff (a diff is the report, not a failure)"
        echo "$pending_output" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
    fi

    assert_contains "dry-run: the pending settings.json change appears as an added line" \
        '+  "model": "dry-run-model"' "$pending_output"
    assert_contains "dry-run: the current settings.json value appears as a removed line" \
        '-  "model": "personal-model"' "$pending_output"

    assert_jq_eq "dry-run: the pending change was NOT written to CLAUDE_DIR/settings.json" \
        '.model' "personal-model" "$settings"
    assert_eq_text "dry-run: CLAUDE_DIR file tree still unchanged after planning a real change" \
        "$before_tree" "$(tree_manifest "$FIXTURE_CLAUDE")"
    assert_eq_text "dry-run: CLAUDE_DIR mtimes still unchanged after planning a real change" \
        "$before_mtimes" "$(tree_mtimes "$FIXTURE_CLAUDE")"

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
