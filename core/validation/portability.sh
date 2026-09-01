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

    # Globbing MUST be off for the unquoted `$input` word-split below: with it
    # on, each `/`-separated segment is also pathname-expanded against the CWD,
    # so a target like `*/../../x` expands `*` into several words and the `..`
    # segments pop those instead of climbing — the escape check then passes a
    # path that really does resolve above the repo root. (`local -` is bash
    # 4.4+; macOS ships bash 3.2, hence the manual save/restore.)
    local glob_was_on=0
    case "$-" in
        *f*) ;;
        *) glob_was_on=1 ;;
    esac
    set -f

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
    if [[ "$glob_was_on" -eq 1 ]]; then
        set +f
    fi

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

# Enumerates every git-tracked symlink in <repo_root> and judges its target,
# printing one TAB-separated record per link:
#
#   <verdict>\t<rel>\t<target>
#
# verdict: missing (indexed but not a symlink on disk) | fixture | absolute |
#          home | escape | ok
#
# Split out from the reporting loop so the suite can drive it against a
# throwaway fixture repo (check_symlink_scan_fixture below) instead of only
# against this checkout, which happens to contain no unsafe link.
_scan_tracked_symlinks() {
    local repo_root="$1"
    local entry mode rel target link_dir normalized

    # `git ls-files -s -z` emits "<mode> SP <oid> SP <stage> TAB <path>" NUL-
    # terminated. Split on the TAB, never on whitespace: awk's default field
    # splitting yielded only the first token of a path containing a space
    # ("bad link" -> "bad"), and without -z git C-quotes non-ASCII paths
    # ("m\303\251chant"). Either way the path did not resolve on disk and the
    # link fell through to a SKIP warning — a fail-open on exactly the links
    # this check exists to catch.
    while IFS= read -r -d '' entry; do
        mode="${entry%% *}"
        [[ "$mode" == "120000" ]] || continue
        rel="${entry#*$'\t'}"
        [[ -n "$rel" ]] || continue

        # The index still lists it (still tracked) but the worktree copy is
        # gone — an uncommitted `rm`/`git rm` pending a later commit. Nothing
        # on disk to mis-resolve; report rather than fabricate a verdict from
        # an empty readlink.
        if [[ ! -L "$repo_root/$rel" ]]; then
            printf 'missing\t%s\t\n' "$rel"
            continue
        fi

        target="$(readlink "$repo_root/$rel")"

        # core/validation/fixtures/targets/expected encodes a fake absolute
        # path this way for the targets-golden suite — not a real hazard.
        if [[ "$target" == "__FIXTURES_ROOT__" || "$target" == __FIXTURES_ROOT__/* ]]; then
            printf 'fixture\t%s\t%s\n' "$rel" "$target"
            continue
        fi

        if [[ "$target" == /* ]]; then
            printf 'absolute\t%s\t%s\n' "$rel" "$target"
            continue
        fi

        if [[ "$target" == "~"* ]]; then
            printf 'home\t%s\t%s\n' "$rel" "$target"
            continue
        fi

        link_dir="$(dirname "$rel")"
        if [[ "$link_dir" == "." ]]; then
            normalized="$(_normalize_relpath "$target")"
        else
            normalized="$(_normalize_relpath "$link_dir/$target")"
        fi

        if [[ "$normalized" == ".." || "$normalized" == ../* ]]; then
            printf 'escape\t%s\t%s\n' "$rel" "$target"
            continue
        fi

        printf 'ok\t%s\t%s\n' "$rel" "$target"
    done < <(git -C "$repo_root" ls-files -s -z)
}

# Fails a tracked symlink whose target is absolute, starts with `~`, or — once
# resolved against the link's own directory — escapes the repo root via `..`.
check_tracked_symlinks_safe() {
    log_info "--- 9. Tracked symlinks: relative targets that stay inside the repo ---"

    local checked=0
    local verdict rel target
    while IFS=$'\t' read -r verdict rel target; do
        [[ -n "$verdict" ]] || continue

        if [[ "$verdict" == "missing" ]]; then
            log_warn "SKIP: $rel (indexed as a symlink, but not one in the worktree — pending removal?)"
            continue
        fi

        checked=$((checked + 1))
        TOTAL=$((TOTAL + 1))

        case "$verdict" in
            fixture)
                log_success "PASS: $rel — fixture placeholder target"
                PASSED=$((PASSED + 1))
                ;;
            absolute)
                log_error "FAIL: $rel — symlink target is absolute: $target"
                FAILED=$((FAILED + 1))
                ;;
            home)
                log_error "FAIL: $rel — symlink target starts with ~: $target"
                FAILED=$((FAILED + 1))
                ;;
            escape)
                log_error "FAIL: $rel — symlink target escapes the repo root: $target"
                FAILED=$((FAILED + 1))
                ;;
            *)
                log_success "PASS: $rel — relative target stays inside the repo"
                PASSED=$((PASSED + 1))
                ;;
        esac
    done < <(_scan_tracked_symlinks "$DOTFILES_ROOT")

    if [[ "$checked" -eq 0 ]]; then
        log_warn "No tracked symlinks found — nothing to check"
    fi
}

# Drives _scan_tracked_symlinks against a throwaway repo whose unsafe links are
# named the way the old awk-based enumeration silently dropped them: with a
# space, and with non-ASCII characters (git C-quotes those without -z).
check_symlink_scan_fixture() {
    log_info "--- 10. Tracked symlink scan: fixture repo (paths with spaces / non-ASCII) ---"

    if ! command -v git >/dev/null 2>&1; then
        log_warn "SKIP: git not on PATH"
        return 0
    fi

    local tmp
    tmp="$(mktemp -d)"
    mkdir -p "$tmp/nested"
    : > "$tmp/nested/inside.txt"
    ln -s /etc/passwd "$tmp/nested/bad link"
    ln -s /etc/passwd "$tmp/nested/méchant link"
    ln -s inside.txt "$tmp/nested/good link"
    git -C "$tmp" init -q >/dev/null 2>&1
    git -C "$tmp" add -A >/dev/null 2>&1

    local scan
    scan="$(_scan_tracked_symlinks "$tmp")"
    /bin/rm -rf "$tmp"

    local case_desc expected
    while IFS='|' read -r case_desc expected; do
        [[ -n "$case_desc" ]] || continue
        TOTAL=$((TOTAL + 1))
        if printf '%s\n' "$scan" | grep -qF -- "$expected"; then
            log_success "PASS: $case_desc"
            PASSED=$((PASSED + 1))
        else
            log_error "FAIL: $case_desc (no '$expected' record in scan output)"
            printf '%s\n' "$scan" | sed 's/^/       /'
            FAILED=$((FAILED + 1))
        fi
    done <<EOF
symlink named with a space is enumerated and judged absolute|absolute	nested/bad link	/etc/passwd
symlink named with non-ASCII characters is enumerated and judged absolute|absolute	nested/méchant link	/etc/passwd
safe relative symlink is judged ok|ok	nested/good link	inside.txt
EOF
}

# -----------------------------------------------------------------------------
# A tracked source file holding a literal NUL byte makes git classify it as
# BINARY: `git diff`/`git show` render it as "Binary files ... differ", so
# every future change to it ships unreviewable, and lib/prepush-scan.js's
# added-line secret scan sees no `+` lines for it at all (its own binary-text
# category is the per-push half of this same rule). A NUL that is genuinely
# wanted as a separator belongs in the source as an escape (`\0` / `\u0000`),
# which keeps the file text.
# -----------------------------------------------------------------------------
check_no_nul_in_text_files() {
    log_info "--- 11. Tracked text files: no literal NUL bytes ---"
    TOTAL=$((TOTAL + 1))

    if ! command -v node >/dev/null 2>&1; then
        log_warn "SKIP: node not on PATH (needed to scan for NUL bytes)"
        return 0
    fi

    local offenders
    offenders="$(git -C "$DOTFILES_ROOT" ls-files -z | node -e '
const fs = require("fs");
const path = require("path");
const root = process.argv[1];
// Text-like extensions only: a vendored binary or image is expected to hold
// NUL bytes. Kept in sync with TEXT_EXTENSIONS in
// runtime/yoki/scripts/lib/prepush-scan.js.
const exts = new Set([".js", ".mjs", ".ts", ".sh", ".md", ".json", ".yaml",
  ".yml", ".toml", ".nix", ".html", ".css", ".txt", ".zsh"]);
for (const rel of fs.readFileSync(0).toString("utf8").split("\u0000")) {
  if (!rel) continue;
  if (!exts.has(path.extname(rel).toLowerCase())) continue;
  let data;
  try { data = fs.readFileSync(path.join(root, rel)); } catch { continue; }
  if (data.includes(0)) process.stdout.write(rel + "\n");
}
' "$DOTFILES_ROOT")"

    if [[ -n "$offenders" ]]; then
        log_error "FAIL: tracked text files contain a literal NUL byte (git treats them as binary — use a \\0 / \\u0000 escape)"
        printf '%s\n' "$offenders" | head -20 | while IFS= read -r line; do
            echo "       $line"
        done
        FAILED=$((FAILED + 1))
        return 1
    fi

    log_success "PASS: no tracked text file contains a literal NUL byte"
    PASSED=$((PASSED + 1))
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
    check_symlink_scan_fixture

    echo ""
    check_no_nul_in_text_files || true

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
