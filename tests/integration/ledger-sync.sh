#!/usr/bin/env bash
# The cost-ledger sync against a real Postgres: two databases on one server
# stand in for this machine's DB and the ledger. Checks that rows arrive once
# (re-sending never duplicates), are labelled with the machine, and that an
# unreachable ledger leaves the watermark where it was.
#
#   PG_BIN=<dir with initdb/pg_ctl/psql> bash tests/integration/ledger-sync.sh
#     starts a throwaway server itself (local runs)
#   PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... bash tests/integration/ledger-sync.sh
#     uses a running server (CI's postgres service)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/ledger-it.XXXXXX")"
# dotctl from this checkout (tests/lib/dotctl.bash: go build, or nix)
# shellcheck source=tests/lib/dotctl.bash
source "${REPO}/tests/lib/dotctl.bash"
trap 'if [[ -n "${PG_BIN:-}" ]]; then "${PG_BIN}/pg_ctl" -D "${WORK}/data" stop -m immediate >/dev/null 2>&1 || true; fi; rm -rf "${WORK}"' EXIT

if [[ -n "${PG_BIN:-}" ]]; then
	export PATH="${PG_BIN}:${PATH}"
	export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres PGPASSWORD=postgres
	printf 'postgres\n' >"${WORK}/pw"
	initdb -D "${WORK}/data" -U postgres --pwfile="${WORK}/pw" -A scram-sha-256 >/dev/null
	pg_ctl -D "${WORK}/data" -o "-p ${PGPORT} -k ${WORK} -c listen_addresses=127.0.0.1" -l "${WORK}/log" -w start >/dev/null
fi

build_dotctl "${WORK}"

admin() { psql -v ON_ERROR_STOP=1 -qAt -d postgres "$@"; }
admin -c "DROP DATABASE IF EXISTS local" -c "DROP DATABASE IF EXISTS central" -c "DROP ROLE IF EXISTS litellm"
admin -c "CREATE ROLE litellm LOGIN PASSWORD 'pw'" -c "CREATE DATABASE local OWNER litellm" -c "CREATE DATABASE central OWNER litellm"
# the columns LiteLLM's table starts with, in LiteLLM's order (schema.prisma)
for db in local central; do
	PGPASSWORD=pw psql -v ON_ERROR_STOP=1 -q -U litellm -d "$db" -c \
		'CREATE TABLE "LiteLLM_SpendLogs" (request_id text PRIMARY KEY, call_type text, spend double precision, "startTime" timestamp(3), model text, request_tags jsonb)'
done
q() { PGPASSWORD=pw psql -v ON_ERROR_STOP=1 -qAt -U litellm -d "$1" -c "$2"; }
q local "INSERT INTO \"LiteLLM_SpendLogs\" VALUES ('r1','acompletion',0.5,'2026-09-25 10:00:00','main','[\"pi\"]'), ('r2','acompletion',1.25,'2026-09-25 10:05:00','main','[\"omp\"]')"
# the ledger machine's own row, written there directly
q central "INSERT INTO \"LiteLLM_SpendLogs\" VALUES ('m1','acompletion',2,'2026-09-25 09:00:00','main','[]')"

sync() {
	local here="${PGHOST}:${PGPORT}"
	env -u PGHOST -u PGPORT LEDGER_PASSWORD=pw LEDGER_LOCAL="${here}/local" LEDGER_CENTRAL="${1:-${here}/central}" \
		LEDGER_MACHINE=omarchy LEDGER_SQL="${REPO}/home/shared/llm-ledger/ledger.sql" \
		LEDGER_STATE_DIR="${WORK}/state" "${DOTCTL}" ledger sync once
}
fail() { echo "FAIL: $*" >&2; exit 1; }
expect() { [[ "$2" == "$3" ]] || fail "$1: got '$2', want '$3'"; }

sync
expect "rows after the first run" "$(q central 'SELECT count(*) FROM "LiteLLM_SpendLogs"')" 3
expect "total spend" "$(q central 'SELECT sum(spend) FROM "LiteLLM_SpendLogs"')" 3.75
expect "labelled rows" "$(q central "SELECT string_agg(request_id || '=' || machine, ',' ORDER BY request_id) FROM ledger_origin")" "r1=omarchy,r2=omarchy"
expect "watermark" "$(cat "${WORK}/state/shipped")" "2026-09-25 10:05:00"

q local "INSERT INTO \"LiteLLM_SpendLogs\" VALUES ('r3','acompletion',0.25,'2026-09-25 10:30:00','deterministic','[]')"
sync
sync # everything within the hour is sent again: nothing may double
expect "rows after re-sending" "$(q central 'SELECT count(*) FROM "LiteLLM_SpendLogs"')" 4
expect "total after re-sending" "$(q central 'SELECT sum(spend) FROM "LiteLLM_SpendLogs"')" 4

q local "INSERT INTO \"LiteLLM_SpendLogs\" VALUES ('r4','acompletion',1,'2026-09-25 11:00:00','main','[]')"
if sync "${PGHOST}:1/central" 2>/dev/null; then fail "an unreachable ledger reported success"; fi
expect "watermark kept while unreachable" "$(cat "${WORK}/state/shipped")" "2026-09-25 10:30:00"
sync
expect "the held row arrives later" "$(q central "SELECT count(*) FROM \"LiteLLM_SpendLogs\" WHERE request_id = 'r4'")" 1
echo "ledger-sync: OK"
