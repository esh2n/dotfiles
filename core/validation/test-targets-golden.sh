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
# The personal layer additionally ships the bash-wrapper guards the real
# personal/settings.personal.json uses (`bash -c 'h=~/.claude/hooks/<g>.sh;
# … exec bash "$h" [args]'`), one of them with argv, plus ONE deliberately
# untranslatable hook (an osascript notification). Those pin the two halves of
# the guard-distribution contract: every wrapper guard must REACH codex and
# omp (via run-bash-hook.js), and anything that cannot be translated must show
# up as a `skipped` line in the plan output rather than vanishing.
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
# discipline core/utils/common.sh's tree_manifest() implements. What
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

# Literal (non-regex) two-pair substitution over stdin -> stdout, plus one
# regex pass over config.toml's `trusted_hash = "sha256:<64hex>"` values.
#
# The hash pass is needed because a hook trust hash is computed over the hook
# command TEXT, and a translated personal bash guard's command now embeds the
# absolute path of the run's ephemeral home
# (".../run-home/.claude/hooks/git-guard.sh"). Substituting __RUN_HOME__ into
# the file content cannot reach a hash that was computed before the
# substitution, so the digest would differ on every run and the golden could
# never match. hooks.json itself IS still compared byte-for-byte (after
# normalization), so what the hash is derived FROM stays pinned here; that the
# derivation is correct is covered by lib/targets/test/codex-trust.test.js and
# doctor.js's detectTrustDrift tests.
normalize_text() {
    local find1="$1" repl1="$2" find2="$3" repl2="$4"
    python3 -c '
import re, sys
find1, repl1, find2, repl2 = sys.argv[1:5]
data = sys.stdin.read()
data = data.replace(find1, repl1).replace(find2, repl2)
data = re.sub(r"(trusted_hash = \"sha256:)[0-9a-f]{64}(\")", r"\1__TRUSTED_HASH__\2", data)
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

# tree_manifest / assert_eq_text / assert_true / assert_lacks / assert_contains
# all live in core/utils/common.sh (sourced above) and are shared with
# test-yoki-switch-targets.sh — tree_manifest() is the symlink-safe tree
# snapshot both suites compare with.

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
        "$(tree_manifest "${EXPECTED_DIR}/${target}")" \
        "$(tree_manifest "$normalized")"
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
    # Personal bash guards must REACH both foreign harnesses. The fixture's
    # personal layer ships the same `bash -c 'h=~/.claude/hooks/<g>.sh; …
    # exec bash "$h"'` wrapper personal/settings.personal.json uses. Before
    # bash-wrapper-hook.js these were dropped with a warning, which silently
    # removed git-guard.sh / unattended-guard.sh from codex and omp — a
    # protection downgrade relative to Claude Code, so it is asserted
    # explicitly here and not left to the tree diff alone.
    #
    # The fixture also ships ONE deliberately untranslatable hook (an
    # osascript notification): it must show up as a `skipped` line in the
    # plan output on both targets, never disappear quietly.
    # -------------------------------------------------------------------
    local codex_hooks_json omp_hooks_json
    codex_hooks_json="$(cat "${WORK}/codex-home/.codex/hooks.json" 2>/dev/null || true)"
    omp_hooks_json="$(cat "${WORK}/omp-home/.omp/agent/yoki-hooks.json" 2>/dev/null || true)"

    assert_contains "codex: git-guard.sh is dispatched through run-bash-hook.js --harness codex" \
        'run-bash-hook.js\" --harness codex \"'"${WORK}/codex-home/.claude/hooks/git-guard.sh" "$codex_hooks_json"
    assert_contains "codex: unattended-guard.sh reaches the target too" \
        "${WORK}/codex-home/.claude/hooks/unattended-guard.sh" "$codex_hooks_json"
    assert_contains "codex: a wrapper hook's own argv survives translation" \
        'herdr-agent-state.sh\" \"session\"' "$codex_hooks_json"

    assert_contains "omp: git-guard.sh becomes a kind:bash spec" '"kind": "bash"' "$omp_hooks_json"
    assert_contains "omp: git-guard.sh script path is absolute" \
        "${WORK}/omp-home/.claude/hooks/git-guard.sh" "$omp_hooks_json"
    assert_contains "omp: unattended-guard.sh reaches the target too" \
        "unattended-guard.sh" "$omp_hooks_json"
    assert_contains "omp: a wrapper hook's own argv survives translation" '"session"' "$omp_hooks_json"

    run_gen codex "${WORK}/skip-codex-home" "${WORK}/skip-codex-home/.codex"
    assert_contains "codex: the untranslatable osascript hook is listed as skipped, not dropped" \
        "skipped" "$OUTPUT"
    assert_contains "codex: the skipped line names the command" "osascript" "$OUTPUT"

    run_gen omp "${WORK}/skip-omp-home" "${WORK}/skip-omp-home/.omp/agent"
    assert_contains "omp: the untranslatable osascript hook is listed as skipped, not dropped" \
        "skipped" "$OUTPUT"
    assert_contains "omp: the skipped line names the command" "osascript" "$OUTPUT"

    # -------------------------------------------------------------------
    # omp manifest/prune parity with codex: agents/<name>.md is tracked in
    # .yoki/omp-manifest.json, and --prune removes an agent whose source is
    # gone. A manifest entry pointing OUTSIDE --out is refused outright
    # (nothing deleted), since --prune is a recursive delete driven by a
    # file any process with a shell can rewrite.
    # -------------------------------------------------------------------
    local prune_home="${WORK}/prune-home"
    local prune_out="${prune_home}/.omp/agent"
    run_gen omp "$prune_home" "$prune_out"
    assert_true "omp: .yoki/omp-manifest.json is written (codex parity)" \
        test -f "${prune_out}/.yoki/omp-manifest.json"

    printf 'stale\n' > "${prune_out}/agents/orphan.md"
    python3 - "$prune_out" <<'PY'
import json, sys, os
out = sys.argv[1]
manifest_path = os.path.join(out, '.yoki', 'omp-manifest.json')
with open(manifest_path) as fh:
    entries = json.load(fh)
entries.append(os.path.join(out, 'agents', 'orphan.md'))
with open(manifest_path, 'w') as fh:
    json.dump(entries, fh)
PY
    run_gen omp "$prune_home" "$prune_out" --prune
    assert_true "omp: --prune removes an agent the sources no longer provide" \
        test ! -e "${prune_out}/agents/orphan.md"
    assert_true "omp: --prune leaves the generated singletons alone" \
        test -f "${prune_out}/config.yml"

    local hostile_home="${WORK}/hostile-home"
    local hostile_out="${hostile_home}/.omp/agent"
    run_gen omp "$hostile_home" "$hostile_out"
    mkdir -p "${hostile_home}/Documents"
    printf 'important\n' > "${hostile_home}/Documents/thesis.txt"
    python3 - "$hostile_out" "${hostile_home}/Documents" <<'PY'
import json, sys, os
out, victim = sys.argv[1], sys.argv[2]
manifest_path = os.path.join(out, '.yoki', 'omp-manifest.json')
with open(manifest_path) as fh:
    entries = json.load(fh)
entries.append(victim)
with open(manifest_path, 'w') as fh:
    json.dump(entries, fh)
PY
    run_gen omp "$hostile_home" "$hostile_out" --prune
    TOTAL=$((TOTAL + 1))
    if [[ "$STATUS" -ne 0 ]]; then
        log_success "PASS: omp: a manifest entry outside --out makes --prune fail closed"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: omp: a manifest entry outside --out makes --prune fail closed (exit 0)"
        FAILED=$((FAILED + 1))
    fi
    assert_contains "omp: the refusal names the offending entry" "Refusing to prune" "$OUTPUT"
    assert_true "omp: nothing outside --out was deleted" \
        test -f "${hostile_home}/Documents/thesis.txt"

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
