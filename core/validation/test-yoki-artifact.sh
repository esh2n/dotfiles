#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# yoki-artifact End-to-End Contract Test (test-yoki-artifact.sh)
# -----------------------------------------------------------------------------
# Exercises the CLI the way a caller actually reaches it: through the
# domains/dev/bin/yoki-artifact symlink the dotfiles linker installs into
# ~/bin, against the skill's own fake Worker
# (skills/yoki-artifact/test/fixtures/api-server.mjs) on 127.0.0.1.
#
# What this covers that the unit suites do not:
#   - the bin symlink exists, points where it should, and still finds
#     yoki-artifact.mjs after the linker's second hop into ~/bin
#   - publish -> versions -> comments --to-agent -> watch --once -> revoke as
#     one sequence against one server, asserting exit codes and JSON shapes
#   - the secret-scan fixture is refused and nothing reaches the API
# It then runs the two unit suites (worker/ and test/) so the validator has a
# single entry point for the whole skill.
#
# Nothing here touches the network, the user's ~/.config or ~/.local/state, or
# a real Cloudflare deployment: the CLI runs with a scrubbed environment
# pointed at a throwaway HOME.
#
# Usage: ./test-yoki-artifact.sh
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

SKILL="${DOTFILES_ROOT}/domains/dev/config/claude-profiles/core/skills/yoki-artifact"
BIN_LINK="${DOTFILES_ROOT}/domains/dev/bin/yoki-artifact"
BIN_LINK_TARGET="../config/claude-profiles/core/skills/yoki-artifact/bin/yoki-artifact"

NODE_MAJOR_FLOOR=22
SERVER_READY_TIMEOUT=15
CHANNEL="e2e"
SECRET_CHANNEL="e2e-secret"

FAILED=0
PASSED=0
TOTAL=0

# Set by start_fake_api / cli.
FIXTURE=""
FAKE_HOME=""
API_PID=""
API_URL=""
API_CLIENT_ID=""
API_CLIENT_SECRET=""
CLI_STDOUT=""
CLI_STDERR=""
CLI_STATUS=0

# -----------------------------------------------------------------------------
# Assertions
# -----------------------------------------------------------------------------

pass() {
    TOTAL=$((TOTAL + 1))
    PASSED=$((PASSED + 1))
    log_success "PASS: $1"
}

fail() {
    TOTAL=$((TOTAL + 1))
    FAILED=$((FAILED + 1))
    log_error "FAIL: $1"
}

assert_eq() {
    local description="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        pass "$description"
    else
        fail "$description"
        log_error "  wanted: $expected"
        log_error "  got:    $actual"
    fi
}

assert_contains() {
    local description="$1" needle="$2" haystack="$3"
    if grep -qF -- "$needle" <<< "$haystack"; then
        pass "$description"
    else
        fail "$description"
        log_error "  wanted: $needle"
        log_error "  got:    $(head -3 <<< "$haystack")"
    fi
}

assert_lacks() {
    local description="$1" needle="$2" haystack="$3"
    if grep -qF -- "$needle" <<< "$haystack"; then
        fail "$description"
        log_error "  unwanted: $needle"
    else
        pass "$description"
    fi
}

# Asserts on the last `cli` invocation: exit code, then a jq filter over stdout.
assert_exit() {
    assert_eq "$1" "$2" "$CLI_STATUS"
    [[ "$CLI_STATUS" == "$2" ]] || log_error "  stderr: $(head -3 "$CLI_STDERR")"
}

assert_json() {
    local description="$1" filter="$2" expected="$3" actual
    actual="$(jq -r "$filter" < "$CLI_STDOUT" 2>/dev/null)" || actual="<not JSON>"
    assert_eq "$description" "$expected" "$actual"
}

# -----------------------------------------------------------------------------
# Prerequisites
# -----------------------------------------------------------------------------

# The CLI refuses below Node 22 and every assertion here needs jq, so on a
# machine without them every case would fail for the same unrelated reason.
# Say so and skip instead.
prerequisites_ok() {
    local major
    if ! has_command node; then
        log_warn "SKIP: node is not installed — nothing to assert against"
        return 1
    fi
    major="$(node --version | sed 's/^v//' | cut -d. -f1)"
    if [[ "$major" -lt "$NODE_MAJOR_FLOOR" ]]; then
        log_warn "SKIP: node $major is below the CLI's floor of ${NODE_MAJOR_FLOOR}"
        return 1
    fi
    if ! has_command jq; then
        log_warn "SKIP: jq is not installed — nothing to assert JSON with"
        return 1
    fi
    return 0
}

# -----------------------------------------------------------------------------
# Fake API harness
# -----------------------------------------------------------------------------

write_driver() {
    cat > "${FIXTURE}/driver.mjs" <<'DRIVER'
// Runs the CLI's own fake Worker in its own process so a shell test can talk
// to it, prints one JSON line of connection details, then waits for SIGTERM.
import { pathToFileURL } from "node:url";

const fixture = await import(pathToFileURL(process.env.YOKI_ARTIFACT_FIXTURE).href);
const channel = process.env.YOKI_ARTIFACT_CHANNEL;

// One unseen agent comment, one already picked up, one written to a human —
// enough to tell `comments --to-agent` and `watch --once` apart.
const server = await fixture.startApiServer({
  comments: [
    fixture.makeComment({ id: "w-new", channel, body: "the legend overlaps" }),
    fixture.makeComment({ id: "w-seen", channel, agent_seen_at: "2026-08-30T11:00:00.000Z" }),
    fixture.makeComment({ id: "w-human", channel, to_agent: false }),
  ],
});

process.stdout.write(
  `${JSON.stringify({
    baseUrl: server.baseUrl,
    clientId: fixture.CLIENT_ID,
    clientSecret: fixture.CLIENT_SECRET,
  })}\n`,
);

const shutdown = () => server.close().then(() => process.exit(0), () => process.exit(1));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
DRIVER
}

start_fake_api() {
    FIXTURE="$(mktemp -d)"
    FAKE_HOME="${FIXTURE}/home"
    CLI_STDOUT="${FIXTURE}/stdout"
    CLI_STDERR="${FIXTURE}/stderr"
    mkdir -p "$FAKE_HOME" "${FIXTURE}/bin"
    write_driver
    mkfifo "${FIXTURE}/handshake"

    YOKI_ARTIFACT_FIXTURE="${SKILL}/test/fixtures/api-server.mjs" \
    YOKI_ARTIFACT_CHANNEL="$CHANNEL" \
        node "${FIXTURE}/driver.mjs" > "${FIXTURE}/handshake" 2> "${FIXTURE}/driver.log" &
    API_PID=$!

    # Hold the read end open for the process's lifetime: closing it would send
    # the driver SIGPIPE on any later write.
    exec 3< "${FIXTURE}/handshake"
    local line=""
    if ! IFS= read -r -t "$SERVER_READY_TIMEOUT" line <&3 || [[ -z "$line" ]]; then
        fail "the fake API server starts"
        log_error "  driver log: $(head -3 "${FIXTURE}/driver.log")"
        return 1
    fi

    API_URL="$(jq -r '.baseUrl' <<< "$line")"
    API_CLIENT_ID="$(jq -r '.clientId' <<< "$line")"
    API_CLIENT_SECRET="$(jq -r '.clientSecret' <<< "$line")"
    pass "the fake API server starts and reports its address"
    return 0
}

stop_fake_api() {
    [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null
    exec 3<&- 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
    [[ -n "$FIXTURE" ]] && /bin/rm -rf "$FIXTURE"
    return 0
}

# Run the CLI through the bin symlink with a scrubbed environment: a throwaway
# HOME, XDG dirs under it, and a self-check hook pointed at a path that does
# not exist so a real writeup-kit installation cannot influence the result.
cli() {
    CLI_STATUS=0
    env -i \
        PATH="$PATH" \
        HOME="$FAKE_HOME" \
        XDG_CONFIG_HOME="${FAKE_HOME}/.config" \
        XDG_STATE_HOME="${FAKE_HOME}/.local/state" \
        YOKI_ARTIFACT_SELF_CHECK="${FAKE_HOME}/no-such-self-check.mjs" \
        YOKI_ARTIFACT_URL="$API_URL" \
        YOKI_ARTIFACT_CLIENT_ID="$API_CLIENT_ID" \
        YOKI_ARTIFACT_CLIENT_SECRET="$API_CLIENT_SECRET" \
        "$BIN_LINK" "$@" > "$CLI_STDOUT" 2> "$CLI_STDERR" || CLI_STATUS=$?
    return 0
}

write_page() {
    local file="${FAKE_HOME}/$1" body="$2"
    cat > "$file" <<PAGE
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>e2e</title></head>
<body>${body}</body></html>
PAGE
    printf '%s' "$file"
}

# -----------------------------------------------------------------------------
# Checks
# -----------------------------------------------------------------------------

check_bin_symlink() {
    if [[ -L "$BIN_LINK" ]]; then
        pass "case1: domains/dev/bin/yoki-artifact is a symlink"
    else
        fail "case1: domains/dev/bin/yoki-artifact is a symlink"
        return 1
    fi
    assert_eq "case2: it points at the skill launcher, relatively" \
        "$BIN_LINK_TARGET" "$(readlink "$BIN_LINK")"
    if [[ -e "$BIN_LINK" ]]; then
        pass "case3: the relative target resolves from the repo"
    else
        fail "case3: the relative target resolves from the repo"
    fi

    # The dotfiles linker links the symlink itself into ~/bin, so the installed
    # launcher is reached through two hops. That is the shape that breaks a
    # launcher resolving only `dirname "$0"`, so assert on it rather than on a
    # direct call.
    ln -sf "$BIN_LINK" "${FIXTURE}/bin/yoki-artifact"
    local out=""
    out="$("${FIXTURE}/bin/yoki-artifact" --help 2>&1)" || true
    assert_contains "case4: the installed double link still finds the CLI" \
        "yoki-artifact — publish and manage yoki artifacts." "$out"
}

check_publish() {
    local page
    page="$(write_page page.html '<h1>hello</h1>')"

    cli publish "$page" --channel "$CHANNEL" --title "E2E" --json
    assert_exit  "case5: publish exits 0" 0
    assert_json  "case6: publish reports ok"        '.ok'        "true"
    assert_json  "case7: publish reports the channel" '.channel' "$CHANNEL"
    assert_json  "case8: publish is version 1"      '.version'   "1"
    assert_json  "case9: publish is not a dedupe"   '.unchanged' "false"
    assert_json  "case10: publish returns the viewer URL" '.url' "${API_URL}/a/${CHANNEL}"

    cli publish "$page" --channel "$CHANNEL" --json
    assert_exit "case11: republishing identical bytes exits 0" 0
    assert_json "case12: republishing identical bytes is a dedupe" '.unchanged' "true"
    assert_json "case13: the deduped version is still 1" '.version' "1"
}

check_versions_and_comments() {
    cli versions "$CHANNEL" --json
    assert_exit "case14: versions exits 0" 0
    assert_json "case15: versions lists one version" '.versions | length' "1"
    assert_json "case16: versions echoes the channel" '.channel' "$CHANNEL"

    cli comments "$CHANNEL" --to-agent --json
    assert_exit "case17: comments --to-agent exits 0" 0
    assert_json "case18: only to_agent comments come back" \
        '[.comments[].id] | sort | join(" ")' "w-new w-seen"
    assert_json "case19: no comment written to a human leaks in" \
        '[.comments[] | select(.to_agent != true)] | length' "0"
}

check_watch() {
    local inbox="${FAKE_HOME}/.local/state/yoki/artifact/inbox.jsonl"

    cli watch "$CHANNEL" --once --json
    assert_exit "case20: watch --once exits 0" 0
    assert_json "case21: watch reports one new entry" '.entries | length' "1"
    assert_json "case22: watch names the inbox it wrote" '.inbox' "$inbox"

    if [[ -f "$inbox" ]]; then
        assert_eq "case23: the inbox holds only the unseen agent comment" \
            "1" "$(wc -l < "$inbox" | tr -d ' ')"
        assert_eq "case24: the inbox entry is the unseen comment" \
            "w-new" "$(jq -r '.comment.id' < "$inbox")"
    else
        fail "case23: watch --once writes the inbox"
    fi

    # Idempotence is the whole point of the inbox: a second poll must not
    # re-deliver a comment the agent has already been handed.
    local before=""
    before="$(cat "$inbox" 2>/dev/null || true)"
    cli watch "$CHANNEL" --once
    assert_exit "case25: a second poll exits 0" 0
    assert_eq "case26: a second poll does not duplicate the entry" \
        "$before" "$(cat "$inbox" 2>/dev/null || true)"
}

check_revoke() {
    cli revoke "$CHANNEL" --json
    assert_exit "case27: revoke exits 0" 0
    assert_json "case28: revoke reports the channel" '.channel' "$CHANNEL"
    if [[ -n "$(jq -r '.revoked_at // ""' < "$CLI_STDOUT" 2>/dev/null)" ]]; then
        pass "case29: revoke stamps revoked_at"
    else
        fail "case29: revoke stamps revoked_at"
    fi
}

check_secret_gate() {
    # Assembled from harmless fragments so this repository never contains a
    # string shaped like a real key — including in the file that tests the
    # scanner. Matches the CLI's sk-[A-Za-z0-9]{20,} rule.
    local fake_key="sk-" i page
    for i in 1 2 3 4 5 6 7 8; do fake_key="${fake_key}FAKE"; done
    page="$(write_page leaky.html "<code>${fake_key}</code>")"

    cli publish "$page" --channel "$SECRET_CHANNEL"
    assert_exit "case30: a credential-looking page exits 4" 4
    assert_contains "case31: the refusal says why" \
        "looks like it contains a credential" "$(cat "$CLI_STDERR")"
    assert_lacks "case32: the refusal never echoes the secret" \
        "$fake_key" "$(cat "$CLI_STDERR")"

    # Proves the refusal happened before the upload, not after it.
    cli versions "$SECRET_CHANNEL"
    assert_exit "case33: nothing was uploaded for the refused page" 2
    assert_contains "case34: the channel does not exist server-side" \
        "no such artifact" "$(cat "$CLI_STDERR")"
}

check_unit_suites() {
    if ! has_command npm; then
        log_warn "SKIP: npm is not installed — the worker suite cannot run"
    elif (cd "${SKILL}/worker" && npm test) > "${FIXTURE}/worker-test.log" 2>&1; then
        pass "case35: worker/ npm test passes"
    else
        fail "case35: worker/ npm test passes"
        log_error "  $(tail -5 "${FIXTURE}/worker-test.log")"
    fi

    if (cd "$SKILL" && node --test test/cli.test.mjs) > "${FIXTURE}/cli-test.log" 2>&1; then
        pass "case36: test/ node --test passes"
    else
        fail "case36: test/ node --test passes"
        log_error "  $(tail -5 "${FIXTURE}/cli-test.log")"
    fi
}

# This file is the only thing that runs the worker/ and test/ suites, so it is
# worthless unless the runner actually calls it. Asserted statically rather
# than by invoking validator.sh, which would re-enter this very suite.
check_validator_wiring() {
    local validator="${SCRIPT_DIR}/validator.sh"

    if grep -qE '^\s+yoki-artifact\s*$' "$validator"; then
        pass "case37: validator.sh runs yoki-artifact in its default (no-args) pass"
    else
        fail "case37: validator.sh runs yoki-artifact in its default (no-args) pass"
    fi

    if grep -qF '"yoki-artifact")' "$validator"; then
        pass "case38: validator.sh accepts \`validator.sh yoki-artifact\`"
    else
        fail "case38: validator.sh accepts \`validator.sh yoki-artifact\`"
    fi

    if grep -q 'Usage: \$0 .*|yoki-artifact|' "$validator"; then
        pass "case39: validator.sh usage line lists yoki-artifact"
    else
        fail "case39: validator.sh usage line lists yoki-artifact"
    fi
}

run_e2e_checks() {
    check_bin_symlink
    check_publish
    check_versions_and_comments
    check_watch
    check_revoke
    check_secret_gate
    check_unit_suites
    check_validator_wiring
}

run_yoki_artifact_checks() {
    log_info "=== yoki-artifact End-to-End Test Suite ==="
    echo ""

    prerequisites_ok || return 0

    if start_fake_api; then
        # `|| true` disarms errexit for the whole subtree, so an unexpected
        # failure inside a check still reaches stop_fake_api instead of
        # leaving the fake server running.
        run_e2e_checks || true
    fi
    stop_fake_api

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
    run_yoki_artifact_checks
fi
