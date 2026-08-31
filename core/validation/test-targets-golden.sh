#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Install-Target Golden Suite (test-targets-golden.sh)
# -----------------------------------------------------------------------------
# Task T15. Runs lib/targets/gen.js directly (never yoki-switch — that is
# already covered end to end by test-yoki-switch-targets.sh against the REAL
# claude-profiles sources) for both --target codex and --target omp against a
# minimal, checked-in core+personal fixture tree
# (fixtures/targets/{core,personal}) and diffs the produced homes against
# checked-in expected output trees (fixtures/targets/expected/{codex,omp}).
#
# The fixture covers: one hook per common Claude event (the events both
# codex-hooks-merge.js's KNOWN_EVENTS and omp-hooks.js's EVENT_MAP recognize:
# PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, UserPromptSubmit,
# PreCompact), one agent, one command, one skill WITH a codex/ port and one
# WITHOUT, and a permissions.yaml with one hook-enforced deny (a curl-pipe-
# to-shell installer pattern — no execpolicy/omp-declarative equivalent,
# also explicitly `enforce: [hook]`).
#
# Portability: two absolute-path families would otherwise leak into the
# generated content and make a byte-for-byte diff fail on every other
# checkout/machine — this fixture's own absolute path (varies per checkout)
# and the ephemeral --home/--out temp dir (varies per run). Both are
# substituted for stable placeholder tokens (__FIXTURES_ROOT__,
# __RUN_HOME__) before comparing OR before writing new expected output, so
# the checked-in expected/ trees never contain a real absolute path. Plain
# `diff -r` is avoided for the actual comparison: BSD diff dereferences
# symlinks even under -r (verified: a dangling symlink makes it print "No
# such file or directory" and still exit 0 — a silent false pass), so
# symlinks are compared by their own target text instead, the same
# discipline test-yoki-switch-targets.sh's snapshot_tree already uses. What
# WOULD vary from run to run regardless (env.YOKI_ROOT/CLAUDE_PLUGIN_ROOT,
# which the real environment sets — see core/settings.layer.json) is pinned
# to fixed literal strings via explicit env vars on the gen.js invocation,
# never left to inherit the caller's shell.
#
# UPDATE_GOLDEN=1 ./test-targets-golden.sh regenerates
# fixtures/targets/expected/{codex,omp} from the current generator output
# (after normalization) instead of comparing against it — run it once after
# a deliberate fixture or generator change, inspect the diff, then commit.
#
# Usage: ./test-targets-golden.sh
#        UPDATE_GOLDEN=1 ./test-targets-golden.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

GEN_JS="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/gen.js"
FIXTURES_DIR="${SCRIPT_DIR}/fixtures/targets"
EXPECTED_DIR="${FIXTURES_DIR}/expected"
CORE_SRC="${FIXTURES_DIR}/core"
PERSONAL_SRC="${FIXTURES_DIR}/personal"
DOTFILES_STUB="${FIXTURES_DIR}/dotfiles-stub"

# Fixed, deliberately fake — codex.js only ever embeds these as literal TOML
# strings (notify path, shell_environment_policy.set), it never reads either
# path from disk, so they need not exist. Fixed means the golden config.toml
# never depends on where this checkout happens to live.
FIXED_YOKI_ROOT="/opt/yoki-golden-fixture/yoki-root"
FIXED_PLUGIN_ROOT="/opt/yoki-golden-fixture/plugin-root"

FAILED=0
PASSED=0
TOTAL=0

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

# Literal (non-regex) two-pair substitution over stdin -> stdout.
normalize_text() {
    local find1="$1" repl1="$2" find2="$3" repl2="$4"
    python3 -c '
import sys
find1, repl1, find2, repl2 = sys.argv[1:5]
data = sys.stdin.read()
data = data.replace(find1, repl1).replace(find2, repl2)
sys.stdout.write(data)
' "$find1" "$repl1" "$find2" "$repl2"
}

# Copies every regular file/symlink under $src_root into $dest_root, with
# FIXTURES_DIR and RUN_HOME substituted for stable placeholders in file
# content AND (separately, via readlink/ln -s, never sed) in symlink
# targets — see the file header for why a symlink can't just be piped
# through normalize_text like a regular file.
materialize_normalized_tree() {
    local src_root="$1" dest_root="$2" run_home="$3"
    rm -rf "$dest_root"
    mkdir -p "$dest_root"
    [[ -d "$src_root" ]] || return 0

    local rel srcf destf target norm_target
    while IFS= read -r rel; do
        rel="${rel#./}"
        srcf="$src_root/$rel"
        destf="$dest_root/$rel"
        mkdir -p "$(dirname "$destf")"
        if [[ -L "$srcf" ]]; then
            target="$(readlink "$srcf")"
            norm_target="$(normalize_text "$FIXTURES_DIR" '__FIXTURES_ROOT__' "$run_home" '__RUN_HOME__' <<< "$target")"
            ln -s "$norm_target" "$destf"
        else
            normalize_text "$FIXTURES_DIR" '__FIXTURES_ROOT__' "$run_home" '__RUN_HOME__' < "$srcf" > "$destf"
        fi
    done < <(cd "$src_root" && find . -mindepth 1 \( -type f -o -type l \) | LC_ALL=C sort)
}

# Content-addressed manifest of a tree already fully normalized (both the
# freshly-materialized actual tree and the checked-in expected/ tree are, by
# construction) — relative path + (sha256 of content | symlink target), one
# per line, sorted. Never dereferences a symlink, unlike plain `diff -r`.
build_manifest() {
    local dir="$1"
    [[ -d "$dir" ]] || return 0
    ( cd "$dir" && find . -mindepth 1 \( -type f -o -type l \) | LC_ALL=C sort | while IFS= read -r f; do
        f="${f#./}"
        if [[ -L "$f" ]]; then
            printf '%s\tSYMLINK:%s\n' "$f" "$(readlink "$f")"
        else
            printf '%s\tFILE:%s\n' "$f" "$(shasum -a 256 "$f" | awk '{print $1}')"
        fi
    done )
}

assert_eq_text() {
    local description="$1" expected="$2" actual="$3"
    TOTAL=$((TOTAL + 1))
    if [[ "$expected" == "$actual" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | sed 's/^/       /' | head -60
        FAILED=$((FAILED + 1))
    fi
}

assert_true() {
    local description="$1"; shift
    TOTAL=$((TOTAL + 1))
    if "$@" >/dev/null 2>&1; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        FAILED=$((FAILED + 1))
    fi
}

assert_lacks() {
    local description="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$needle" <<< "$haystack"; then
        log_error "FAIL: $description"
        log_error "  unwanted: $needle"
        FAILED=$((FAILED + 1))
    else
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    fi
}

assert_contains() {
    local description="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$needle" <<< "$haystack"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        log_error "  wanted: $needle"
        FAILED=$((FAILED + 1))
    fi
}

# Runs gen.js for one target against the fixture sources, into a freshly
# materialized $home. Always exits 0 (or 1) itself; STATUS/OUTPUT are set as
# globals so `set -e` can't eat a non-zero exit before the caller sees it.
run_gen() {
    local target="$1" home="$2" out="$3"; shift 3
    mkdir -p "$home"
    STATUS=0
    OUTPUT="$(YOKI_ROOT="$FIXED_YOKI_ROOT" CLAUDE_PLUGIN_ROOT="$FIXED_PLUGIN_ROOT" YOKI_HOOK_PROFILE=standard \
        node "$GEN_JS" --target "$target" \
            --sources "${CORE_SRC},${PERSONAL_SRC}" \
            --out "$out" --home "$home" \
            --dotfiles-root "$DOTFILES_STUB" "$@" 2>&1)" || STATUS=$?
}

# -----------------------------------------------------------------------------
# One target's golden run: apply, then either regenerate expected/<target>
# (UPDATE_GOLDEN=1) or diff the normalized actual tree against it.
# -----------------------------------------------------------------------------
run_one_target_golden() {
    local target="$1" home="$2" out="$3" work="$4"

    run_gen "$target" "$home" "$out"
    TOTAL=$((TOTAL + 1))
    if [[ "$STATUS" -eq 0 ]]; then
        log_success "PASS: ${target} gen.js run exits 0"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: ${target} gen.js run exits 0 (exit $STATUS)"
        echo "$OUTPUT" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
        return 0
    fi

    local normalized="${work}/normalized-${target}"
    materialize_normalized_tree "$home" "$normalized" "$home"

    if [[ "${UPDATE_GOLDEN:-}" == "1" ]]; then
        rm -rf "${EXPECTED_DIR}/${target}"
        mkdir -p "$EXPECTED_DIR"
        cp -a "$normalized" "${EXPECTED_DIR}/${target}"
        log_info "UPDATE_GOLDEN=1: wrote ${EXPECTED_DIR}/${target}"
        return 0
    fi

    TOTAL=$((TOTAL + 1))
    if [[ -d "${EXPECTED_DIR}/${target}" ]]; then
        log_success "PASS: ${target}: expected/${target} exists (run UPDATE_GOLDEN=1 first if missing)"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: ${target}: expected/${target} is missing — run UPDATE_GOLDEN=1 ./test-targets-golden.sh once, inspect it, then commit it"
        FAILED=$((FAILED + 1))
        return 0
    fi

    assert_eq_text "${target}: produced home tree matches fixtures/targets/expected/${target}" \
        "$(build_manifest "${EXPECTED_DIR}/${target}")" \
        "$(build_manifest "$normalized")"
}

# -----------------------------------------------------------------------------
# Test suite
# -----------------------------------------------------------------------------
run_targets_golden_checks() {
    log_info "=== Install-Target Golden Suite (codex/omp) ==="
    echo ""

    if ! command -v node >/dev/null 2>&1; then
        log_error "targets-golden requires node (for lib/targets/gen.js) — none found on PATH."
        return 1
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        log_error "targets-golden requires python3 (for literal path substitution) — none found on PATH."
        return 1
    fi

    local WORK
    WORK="$(mktemp -d)"
    trap "/bin/rm -rf '$WORK'" RETURN

    # --- codex: full ~/-shaped home (~/.codex plus the ~/.agents/skills
    # fallback for the port-less skill) ---------------------------------
    run_one_target_golden codex "${WORK}/codex-home" "${WORK}/codex-home/.codex" "$WORK"

    # --- omp: everything lands under ~/.omp/agent -----------------------
    run_one_target_golden omp "${WORK}/omp-home" "${WORK}/omp-home/.omp/agent" "$WORK"

    # -------------------------------------------------------------------
    # T15 item (1): sbx writes ~/.codex/config.toml at sandbox create time
    # with `sandbox_mode = "danger-full-access"` (see
    # sbx/kits/agents/codex/spec.yaml.in's comment) — a top-level key
    # outside any managed block. codex-config-toml.js's conflict rule must
    # see it and suppress `default_permissions` entirely rather than writing
    # a config Codex would silently misinterpret (spike S3 §1: "Don't
    # combine with sandbox_mode"). Verified directly against that exact
    # fixture value, independent of the golden diff above.
    # -------------------------------------------------------------------
    local sandbox_home="${WORK}/sandbox-mode-home"
    local sandbox_out="${sandbox_home}/.codex"
    mkdir -p "$sandbox_out"
    cat > "${sandbox_out}/config.toml" <<'TOML'
sandbox_mode = "danger-full-access"
approval_policy = "never"
TOML

    run_gen codex "$sandbox_home" "$sandbox_out"
    TOTAL=$((TOTAL + 1))
    if [[ "$STATUS" -eq 0 ]]; then
        log_success "PASS: sandbox_mode fixture: gen.js run exits 0"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: sandbox_mode fixture: gen.js run exits 0 (exit $STATUS)"
        echo "$OUTPUT" | sed 's/^/       /'
        FAILED=$((FAILED + 1))
    fi

    assert_contains "sandbox_mode fixture: warns about the default_permissions/sandbox_mode conflict" \
        "default_permissions/sandbox_mode" "$OUTPUT"

    local sandbox_config
    sandbox_config="$(cat "${sandbox_out}/config.toml" 2>/dev/null || true)"
    assert_contains "sandbox_mode fixture: sbx's own sandbox_mode line survives untouched" \
        'sandbox_mode = "danger-full-access"' "$sandbox_config"
    assert_contains "sandbox_mode fixture: sbx's own approval_policy line survives untouched" \
        'approval_policy = "never"' "$sandbox_config"
    assert_lacks "sandbox_mode fixture: default_permissions is NOT written alongside sandbox_mode" \
        'default_permissions = "yoki"' "$sandbox_config"
    assert_lacks "sandbox_mode fixture: no yoki managed block is written at all" \
        '# yoki:begin' "$sandbox_config"

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
    run_targets_golden_checks
fi
