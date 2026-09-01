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

# -----------------------------------------------------------------------------
# Symlink safety (task T35): every git-tracked symlink must be RELATIVE and
# stay INSIDE the repository. Anything that needs to point into $HOME or is
# machine/account specific belongs in an external-links.yaml layer instead
# (personal/external-links.yaml + yoki-switch's link_external_resources()),
# linked at apply time rather than committed as a real symlink.
# -----------------------------------------------------------------------------

# Normalizes a slash-separated relative path (may contain "." / ".."
# components) without touching the filesystem — the shell equivalent of
# Python's os.path.normpath / Node's path.posix.normalize. A result that is
# ".." or starts with "../" means the path climbs above wherever it started
# (here: above the repo root, since every input is repo-root-relative).
# Written without negative array indices (`${arr[-1]}`) — macOS ships bash
# 3.2, which lacks them.
_normalize_relpath() {
    local input="$1"
    local -a parts=()
    local n=0
    local seg
    local old_ifs="$IFS"
    IFS='/'
    for seg in $input; do
        case "$seg" in
            ""|".") ;;
            "..")
                if [[ $n -gt 0 && "${parts[$((n - 1))]}" != ".." ]]; then
                    n=$((n - 1))
                else
                    parts[$n]=".."
                    n=$((n + 1))
                fi
                ;;
            *)
                parts[$n]="$seg"
                n=$((n + 1))
                ;;
        esac
    done
    IFS="$old_ifs"

    local out="" i
    for ((i = 0; i < n; i++)); do
        if [[ -z "$out" ]]; then
            out="${parts[$i]}"
        else
            out="$out/${parts[$i]}"
        fi
    done
    printf '%s' "$out"
}

# Enumerates every git-tracked symlink (`git ls-files -s` mode 120000) and
# fails one whose target is absolute, starts with `~`, or — once resolved
# against the link's own directory — escapes the repo root via `..`.
check_tracked_symlinks_safe() {
    log_info "--- 9. Tracked symlinks: relative targets that stay inside the repo ---"

    local checked=0
    local rel target link_dir normalized
    while IFS= read -r rel; do
        [[ -n "$rel" ]] || continue

        # The index still lists it (still tracked) but the worktree copy is
        # gone — an uncommitted `rm`/`git rm` pending a later commit. Nothing
        # on disk to mis-resolve; skip rather than fabricate a verdict from
        # an empty readlink.
        if [[ ! -L "$DOTFILES_ROOT/$rel" ]]; then
            log_warn "SKIP: $rel (indexed as a symlink, but not one in the worktree — pending removal?)"
            continue
        fi

        target="$(readlink "$DOTFILES_ROOT/$rel")"
        checked=$((checked + 1))
        TOTAL=$((TOTAL + 1))

        # core/validation/fixtures/targets/expected encodes a fake absolute
        # path this way for the targets-golden suite — not a real hazard.
        if [[ "$target" == "__FIXTURES_ROOT__" || "$target" == __FIXTURES_ROOT__/* ]]; then
            log_success "PASS: $rel — fixture placeholder target"
            PASSED=$((PASSED + 1))
            continue
        fi

        if [[ "$target" == /* ]]; then
            log_error "FAIL: $rel — symlink target is absolute: $target"
            FAILED=$((FAILED + 1))
            continue
        fi

        if [[ "$target" == "~"* ]]; then
            log_error "FAIL: $rel — symlink target starts with ~: $target"
            FAILED=$((FAILED + 1))
            continue
        fi

        link_dir="$(dirname "$rel")"
        if [[ "$link_dir" == "." ]]; then
            normalized="$(_normalize_relpath "$target")"
        else
            normalized="$(_normalize_relpath "$link_dir/$target")"
        fi

        if [[ "$normalized" == ".." || "$normalized" == ../* ]]; then
            log_error "FAIL: $rel — symlink target escapes the repo root: $target"
            FAILED=$((FAILED + 1))
            continue
        fi

        log_success "PASS: $rel — relative target stays inside the repo"
        PASSED=$((PASSED + 1))
    done < <(git -C "$DOTFILES_ROOT" ls-files -s | awk '$1 == "120000" { print $4 }')

    if [[ "$checked" -eq 0 ]]; then
        log_warn "No tracked symlinks found — nothing to check"
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
        "$DOTFILES_ROOT/domains/dev/bin/yoki-switch" \
        "yoki-switch should use DOTFILES_ROOT or GITHUB_USER" || true

    echo ""
    log_info "--- 4. Claude settings (sources only, not merge output): No hardcoded user paths ---"
    # NOTE: domains/dev/config/claude/settings.json is a GENERATED file (output of yoki-switch).
    # It is expected to contain resolved user-specific paths. Only test SOURCE files.
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/ecc/settings.layer.json" \
        "ECC layer should not contain esh2n paths" || true
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/ecc/CLAUDE.layer.md" \
        "ECC CLAUDE.md should not contain esh2n paths" || true
    # NOTE: domains/dev/config/claude/CLAUDE.md is a GENERATED file (output of yoki-switch).
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
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/personal/skills/morning-brief/SKILL.md" \
        "morning-brief should use variable paths" || true
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/personal/skills/workday-calc/SKILL.md" \
        "workday-calc should use variable paths" || true
    assert_no_hardcoded_user \
        "$DOTFILES_ROOT/domains/dev/config/claude-profiles/personal/skills/workday-input/SKILL.md" \
        "workday-input should use variable paths" || true

    echo ""
    log_info "--- 8. Documentation ---"
    assert_file_exists \
        "$DOTFILES_ROOT/.env.example" \
        ".env.example should exist for required env vars"

    echo ""
    check_tracked_symlinks_safe

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
