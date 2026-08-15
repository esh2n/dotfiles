#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Suggest-Compact Hook Regression Test (test-suggest-compact.sh)
# -----------------------------------------------------------------------------
# Verifies runtime/yoki/scripts/hooks/pre-edit-write-suggest-compact.js:
# the context-size signal (window scaling, bucket dedup, disable switch),
# the edit-count signal (threshold + threshold-relative reminders), and the
# per-session state TTL sweep. Uses a private TMPDIR so no real session state
# is touched.
#
# Usage: ./test-suggest-compact.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

HOOK="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/runtime/yoki/scripts/hooks/pre-edit-write-suggest-compact.js"

FAILED=0
PASSED=0
TOTAL=0

run_suggest_compact_checks() {
    log_info "=== Suggest-Compact Hook Test Suite ==="
    echo ""

    if ! command -v node >/dev/null 2>&1; then
        log_info "node not found - skipping"
        return 0
    fi

    local work transcript sid out
    work="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "/bin/rm -rf '$work'" RETURN
    export TMPDIR="$work"

    transcript="$work/transcript.jsonl"
    sid="testsession123"

    run_hook() {
        printf '{"session_id":"%s","transcript_path":"%s","tool_name":"Edit"}' "$sid" "$transcript" | node "$HOOK"
    }

    check() { # name, expected_grep (empty = expect no suggestion), output
        local name="$1" expect="$2" got="$3"
        TOTAL=$((TOTAL + 1))
        if [[ -z "$expect" ]]; then
            if echo "$got" | grep -q 'additionalContext'; then
                log_error "FAIL: $name (unexpected suggestion): $got"; FAILED=$((FAILED + 1))
            else
                log_success "PASS: $name"; PASSED=$((PASSED + 1))
            fi
        else
            if echo "$got" | grep -q "$expect"; then
                log_success "PASS: $name"; PASSED=$((PASSED + 1))
            else
                log_error "FAIL: $name (missing '$expect'): $got"; FAILED=$((FAILED + 1))
            fi
        fi
    }

    mk_transcript() { # tokens
        printf '{"type":"assistant","message":{"model":"claude-test","usage":{"input_tokens":%s,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n' "$1" > "$transcript"
    }

    # 1. below threshold -> silent
    mk_transcript 100000
    check "case1: below context threshold is silent" "" "$(run_hook)"

    # 2. above threshold (165k of 200k window) -> fires
    mk_transcript 165000
    check "case2: above context threshold fires" "165k tokens" "$(run_hook)"

    # 3. same size again -> silent (same bucket)
    check "case3: same bucket does not re-fire" "" "$(run_hook)"

    # 4. growth beyond the (overridden) interval -> fires again
    mk_transcript 199000
    check "case4: growth re-fires in the next bucket" "199k tokens" "$(COMPACT_CONTEXT_INTERVAL=30000 run_hook)"

    # 5. COMPACT_CONTEXT_THRESHOLD=0 disables the context signal
    sid="testsession456"
    mk_transcript 190000
    check "case5: context signal disabled via threshold=0" "" "$(COMPACT_CONTEXT_THRESHOLD=0 run_hook)"

    # 6. count signal fires at the threshold (no usable transcript)
    sid="testsession789"
    transcript="$work/none.jsonl"
    out=""
    for _ in 1 2 3; do out=$(COMPACT_THRESHOLD=3 run_hook); done
    check "case6: count threshold fires" "3 edit/write calls reached" "$out"

    # 7. reminder is threshold-relative (threshold 3 -> next at 28)
    for _ in $(seq 4 28); do out=$(COMPACT_THRESHOLD=3 run_hook); done
    check "case7: reminder at threshold+25" "28 edit/write calls" "$out"

    # 8. TTL sweep removes stale state, keeps fresh state
    touch "$work/claude-tool-count-oldsession"
    touch -t 202501010000 "$work/claude-tool-count-oldsession"
    touch "$work/claude-context-bucket-recentsession"
    run_hook > /dev/null
    TOTAL=$((TOTAL + 1))
    if [[ ! -f "$work/claude-tool-count-oldsession" && -f "$work/claude-context-bucket-recentsession" ]]; then
        log_success "PASS: case8: ttl sweep removes stale, keeps fresh"; PASSED=$((PASSED + 1))
    else
        log_error "FAIL: case8: ttl sweep"; FAILED=$((FAILED + 1))
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

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_suggest_compact_checks
fi
