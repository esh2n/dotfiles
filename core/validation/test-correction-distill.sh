#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Correction Distill Regression Test (test-correction-distill.sh)
# -----------------------------------------------------------------------------
# Verifies domains/dev/config/claude-profiles/personal/scripts/
# correction-distill.sh with a stubbed `claude` binary and a throwaway $HOME,
# so no real agent is ever launched.
#
# Usage: ./test-correction-distill.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

DISTILL="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/personal/scripts/correction-distill.sh"

FAILED=0
PASSED=0
TOTAL=0

check() {
    local description="$1" ok="$2"
    TOTAL=$((TOTAL + 1))
    if [[ "$ok" == "0" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        FAILED=$((FAILED + 1))
    fi
}

run_correction_distill_checks() {
    log_info "=== Correction Distill Test Suite ==="
    echo ""

    local work fake_home stub_dir transcript
    work="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "/bin/rm -rf '$work'" RETURN

    fake_home="$work/home"
    stub_dir="$work/bin"
    mkdir -p "$fake_home/.claude/sessions" "$stub_dir"

    transcript="$fake_home/.claude/sessions/t.jsonl"
    printf '%s\n' \
        '{"type":"assistant","message":{"content":[{"type":"text","text":"I renamed the file"}]}}' \
        '{"type":"user","message":{"content":[{"type":"text","text":"違う、リネームしないで"}]}}' \
        > "$transcript"

    # Stub: records its argv, echoes a canned draft
    cat > "$stub_dir/claude" <<'EOF'
#!/usr/bin/env bash
echo "$@" > "${CLAUDE_STUB_ARGS:-/dev/null}"
cat > /dev/null
echo "## What happened"
echo "stub analysis"
EOF
    chmod +x "$stub_dir/claude"

    run_distill() { # env-mode transcript
        local mode="$1"
        case "$mode" in
            on)      HOME="$fake_home" PATH="$stub_dir:$PATH" CORRECTION_DISTILL=1 YOKI_SKIP_DISTILL= \
                         CLAUDE_STUB_ARGS="$work/args" bash "$DISTILL" "$2" "session12345" "違う、リネームしないで" ;;
            off)     HOME="$fake_home" PATH="$stub_dir:$PATH" CORRECTION_DISTILL= \
                         bash "$DISTILL" "$2" "session12345" "違う、リネームしないで" ;;
            recurse) HOME="$fake_home" PATH="$stub_dir:$PATH" CORRECTION_DISTILL=1 YOKI_SKIP_DISTILL=1 \
                         bash "$DISTILL" "$2" "session12345" "違う、リネームしないで" ;;
        esac
    }

    drafts() { find "$fake_home/.claude/homunculus/drafts" -name '*.md' 2>/dev/null | wc -l | tr -d ' '; }

    # 1. opt-out (default): no draft
    run_distill off "$transcript"
    check "case1: no draft without CORRECTION_DISTILL=1" "$([ "$(drafts)" = "0" ]; echo $?)"

    # 2. recursion guard: no draft
    run_distill recurse "$transcript"
    check "case2: no draft when YOKI_SKIP_DISTILL is set" "$([ "$(drafts)" = "0" ]; echo $?)"

    # 3. transcript outside ~/.claude: rejected
    printf '{}\n' > "$work/outside.jsonl"
    run_distill on "$work/outside.jsonl"
    check "case3: transcript outside ~/.claude rejected" "$([ "$(drafts)" = "0" ]; echo $?)"

    # 4. happy path: draft created with frontmatter + stub content
    run_distill on "$transcript"
    local draft_file
    draft_file=$(find "$fake_home/.claude/homunculus/drafts" -name '*.md' 2>/dev/null | head -1)
    check "case4a: draft file created" "$([ -n "$draft_file" ]; echo $?)"
    check "case4b: draft carries never-auto-applied status" \
        "$(grep -q 'never auto-applied' "${draft_file:-/dev/null}"; echo $?)"
    check "case4c: draft contains agent output" \
        "$(grep -q 'stub analysis' "${draft_file:-/dev/null}"; echo $?)"

    # 5. child env: recursion guard + read-only tools passed to the agent
    check "case5a: child launched with Read-only tools" \
        "$(grep -q -- '--allowedTools Read' "$work/args" 2>/dev/null; echo $?)"
    check "case5b: write/exec tools explicitly disallowed for the child" \
        "$(grep -q -- '--disallowedTools' "$work/args" 2>/dev/null; echo $?)"

    # 6. NOT_A_CORRECTION: no draft
    cat > "$stub_dir/claude" <<'EOF'
#!/usr/bin/env bash
cat > /dev/null
echo "NOT_A_CORRECTION"
EOF
    chmod +x "$stub_dir/claude"
    /bin/rm -f "$fake_home/.claude/homunculus/drafts/"*.md
    run_distill on "$transcript"
    check "case6: NOT_A_CORRECTION produces no draft" "$([ "$(drafts)" = "0" ]; echo $?)"

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

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_correction_distill_checks
fi
