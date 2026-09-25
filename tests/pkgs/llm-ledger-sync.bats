#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# llm-ledger-sync: this machine's spend rows to the one ledger, idempotently.
# psql is a stand-in here; the SQL itself runs against a real Postgres in CI
# (the ledger job of .github/workflows/next.yaml).

SCRIPT="${BATS_TEST_DIRNAME}/../../next/pkgs/scripts/llm-ledger-sync/llm-ledger-sync.sh"

setup() {
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "$BIN"
	export LEDGER_PASSWORD=pw LEDGER_HOST=mac.example.ts.net LEDGER_MACHINE=omarchy \
		LEDGER_SQL=/repo/ledger.sql LEDGER_STATE_DIR="${BATS_TEST_TMPDIR}/state" ROWS="row1"
	# psql: the newest-row query answers a time; the \copy TO writes $ROWS to its
	# file; the ledger session records its SQL and fails when CENTRAL_FAIL is set.
	cat >"$BIN/psql" <<-'PSQL'
		#!/usr/bin/env bash
		echo "psql $*" >>"$LOG"
		case "$*" in
		*" -At "*) echo "2026-09-25 10:00:00" ;;
		*"copy (SELECT"*) f="$(printf '%s' "$*" | sed -n "s/.* TO '\([^']*\)'.*/\1/p")"; printf '%s' "$ROWS" >"$f" ;;
		*) cat >>"$LOG"; exit "${CENTRAL_FAIL:-0}" ;;
		esac
	PSQL
	chmod +x "$BIN/psql"
	export LOG
}

sync() { PATH="${BIN}:/usr/bin:/bin" bash -euo pipefail "${SCRIPT}" "$@"; }

@test "llm-ledger-sync: ships this machine's rows once, deduplicated by request_id, labelled with the machine" {
	run sync once
	[ "$status" -eq 0 ]
	grep -q "^psql postgresql://litellm@mac.example.ts.net:5432/litellm -v ON_ERROR_STOP=1 -v machine=omarchy" "$LOG"
	grep -q 'ON CONFLICT (request_id) DO NOTHING' "$LOG"
	grep -q "^INSERT INTO ledger_origin SELECT request_id, :'machine'" "$LOG"
	grep -qx '\\i /repo/ledger.sql' "$LOG"
	[ "$(cat "${LEDGER_STATE_DIR}/shipped")" = "2026-09-25 10:00:00" ]
}

@test "llm-ledger-sync: each run re-sends from an hour before the last shipped row" {
	mkdir -p "$LEDGER_STATE_DIR"
	echo "2026-09-25 09:00:00" >"${LEDGER_STATE_DIR}/shipped"
	run sync once
	grep -q "\"startTime\" >= timestamp '2026-09-25 09:00:00' - interval '1 hour'" "$LOG"
}

@test "llm-ledger-sync: an unreachable ledger keeps the rows and the watermark" {
	export CENTRAL_FAIL=2
	run sync once
	[ "$status" -ne 0 ]
	[ ! -e "${LEDGER_STATE_DIR}/shipped" ]
}

@test "llm-ledger-sync: in loop mode a failed run still never moves the watermark" {
	export CENTRAL_FAIL=2
	printf '#!/bin/sh\nexit 9\n' >"$BIN/sleep"
	chmod +x "$BIN/sleep"
	run sync loop
	[ ! -e "${LEDGER_STATE_DIR}/shipped" ]
	[[ "$output" == *"wait here for the next run"* ]]
}

@test "llm-ledger-sync: no new rows, no ledger session" {
	export ROWS=""
	run sync once
	[ "$status" -eq 0 ]
	! grep -q "mac.example.ts.net" "$LOG"
}

@test "llm-ledger-sync: without a ledger host there is nothing to do" {
	unset LEDGER_HOST
	run --separate-stderr sync once
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"no ledger host"* ]]
	[ ! -e "$LOG" ] || ! grep -q "^psql" "$LOG"
}

@test "llm-ledger-sync: a watermark that is not a timestamp never reaches the SQL" {
	mkdir -p "$LEDGER_STATE_DIR"
	printf "%s" "2026-01-01'); DROP TABLE x; --" >"${LEDGER_STATE_DIR}/shipped"
	run --separate-stderr sync once
	! grep -q "DROP TABLE" "$LOG"
	grep -q "timestamp '1970-01-01 00:00:00'" "$LOG"
}
