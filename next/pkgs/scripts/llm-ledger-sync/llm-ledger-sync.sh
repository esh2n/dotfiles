# llm-ledger-sync once|loop: ship this machine's LiteLLM spend rows to the
# one cost ledger (rules/decisions/2026-09-25-llm-cost-ledger-local-first.md).
#
# Reads LiteLLM_SpendLogs from this machine's Postgres and inserts them into
# the ledger's, ON CONFLICT (request_id) DO NOTHING — request_id is the
# table's primary key, so sending a row twice leaves one row. Each run sends
# everything from an hour before the last shipped row (the watermark, taken
# before copying), so rows written during a run are sent by the next one.
# While the ledger is unreachable nothing is lost: the rows stay in the local
# DB and the watermark does not move.
#
# Both DBs are created by the same pinned LiteLLM image, so the tables have
# the same columns in the same order.
#
#   LEDGER_PASSWORD  both DBs' password (required)
#   LEDGER_HOST      the observer machine's tailnet name (unset: nothing to do)
#   LEDGER_MACHINE   this machine's name in the ledger (default: hostname -s)
#   LEDGER_SQL       the ledger's own tables (next/home/shared/llm-ledger/ledger.sql)
#   LEDGER_LOCAL     host:port/db of this machine's DB (default 127.0.0.1:5432/litellm)
#   LEDGER_CENTRAL   host:port/db of the ledger (default $LEDGER_HOST:5432/litellm)
#   LEDGER_STATE_DIR where the watermark lives (default ~/.local/state/llm-ledger)
#   LEDGER_INTERVAL  seconds between runs in loop mode (default 300)

MODE="${1:?usage: llm-ledger-sync once|loop}"
: "${LEDGER_PASSWORD:?the ledger DB password is required}"
: "${LEDGER_SQL:?the ledger tables (next/home/shared/llm-ledger/ledger.sql) are required}"
export PGPASSWORD="${LEDGER_PASSWORD}" PGCONNECT_TIMEOUT=10
LOCAL="postgresql://litellm@${LEDGER_LOCAL:-127.0.0.1:5432/litellm}"
MACHINE="${LEDGER_MACHINE:-$(hostname -s)}"
STATE="${LEDGER_STATE_DIR:-${HOME}/.local/state/llm-ledger}"

log() { printf 'llm-ledger-sync: %s\n' "$*" >&2; }

sync_once() {
	if [[ -z "${LEDGER_HOST:-}" && -z "${LEDGER_CENTRAL:-}" ]]; then
		log "no ledger host (the observer machine's tailnet name) — nothing to ship to"
		return 0
	fi
	local central="postgresql://litellm@${LEDGER_CENTRAL:-${LEDGER_HOST}:5432/litellm}"
	local since newest rows
	mkdir -p "${STATE}"
	since="$(cat "${STATE}/shipped" 2>/dev/null || echo '1970-01-01 00:00:00')"
	# the watermark goes into SQL: only a plain timestamp gets there
	if [[ ! "${since}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?$ ]]; then
		log "the watermark is not a timestamp; sending everything again (duplicates are dropped)"
		since='1970-01-01 00:00:00'
	fi
	# Every step is checked by hand: in loop mode this runs under `||`, where
	# set -e is off, and a failure must never move the watermark.
	# the newest row now, before copying: rows written meanwhile go next time
	if ! newest="$(psql "${LOCAL}" -v ON_ERROR_STOP=1 -At -c \
		"SELECT COALESCE(max(\"startTime\"), timestamp '${since}') FROM \"LiteLLM_SpendLogs\"")"; then
		log "this machine's DB did not answer"
		return 1
	fi
	rows="$(mktemp "${STATE}/rows.XXXXXX")" || return 1
	# shellcheck disable=SC2064 # expand now
	trap "rm -f '${rows}'" RETURN
	if ! psql "${LOCAL}" -v ON_ERROR_STOP=1 -c \
		"\\copy (SELECT * FROM \"LiteLLM_SpendLogs\" WHERE \"startTime\" >= timestamp '${since}' - interval '1 hour' ORDER BY \"startTime\") TO '${rows}' WITH (FORMAT csv)"; then
		log "could not read this machine's rows"
		return 1
	fi
	if [[ ! -s "${rows}" ]]; then
		return 0
	fi
	if ! psql "${central}" -v ON_ERROR_STOP=1 -v machine="${MACHINE}" -q <<SQL
\\i ${LEDGER_SQL}
BEGIN;
CREATE TEMP TABLE incoming (LIKE "LiteLLM_SpendLogs") ON COMMIT DROP;
\\copy incoming FROM '${rows}' WITH (FORMAT csv)
INSERT INTO "LiteLLM_SpendLogs" SELECT * FROM incoming ON CONFLICT (request_id) DO NOTHING;
INSERT INTO ledger_origin SELECT request_id, :'machine' FROM incoming ON CONFLICT (request_id) DO NOTHING;
COMMIT;
SQL
	then
		log "the ledger did not take the rows (unreachable, or refused); they are sent next time"
		return 1
	fi
	printf '%s\n' "${newest}" >"${STATE}/shipped" || return 1
	log "shipped rows up to ${newest}"
}

case "${MODE}" in
once) sync_once ;;
loop)
	while true; do
		sync_once || log "the ledger is unreachable; the rows wait here for the next run"
		sleep "${LEDGER_INTERVAL:-300}"
	done
	;;
*)
	log "unknown mode ${MODE} (once, loop)"
	exit 2
	;;
esac
