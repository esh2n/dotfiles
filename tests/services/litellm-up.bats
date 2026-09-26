#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# litellm-up.sh with its ledger DB (rules/decisions/2026-09-25-llm-cost-ledger-local-first.md):
# LiteLLM writes spend to its own Postgres on the same docker network; with no
# DB secret it serves as before. Every outside command is a recording stand-in.

setup() {
	D="${BATS_TEST_TMPDIR}/litellm"
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "$D" "$BIN"
	C="${BATS_TEST_DIRNAME}/../../home/shared/litellm/config"
	sed "s|^use_service_path\$|PATH=\"${BIN}:/usr/bin:/bin\"|" "$C/litellm-up.sh" >"$D/litellm-up.sh"
	cp "$C/secrets.sh" "$D/secrets.sh"
	export HOME="${BATS_TEST_TMPDIR}/home" DB_SECRET=the-db-pw
	unset XDG_RUNTIME_DIR
	mkdir -p "$HOME"
	fake uname 'echo Darwin'
	fake security 'echo token'
	fake op 'case "$*" in *litellm-db*) printf "%s" "$DB_SECRET" ;; *) echo secret ;; esac'
	fake timeout 'shift; exec "$@"'
	fake sleep ':'
	fake curl 'exit 7'
	# docker: the network and DB do not exist yet; everything else succeeds.
	# The final `run --rm` records whether DATABASE_URL reached its environment.
	fake docker 'case "$1 $2" in
		"network inspect") exit 1 ;;
		"inspect -f") echo false ;;
		"run --rm") echo "db-url=${DATABASE_URL:-none}" >>"'"${LOG}"'" ;;
	esac'
}

fake() {
	printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\n%s\n' "$1" "${LOG}" "${2:-}" >"${BIN}/$1"
	chmod +x "${BIN}/$1"
}

up() { PATH="${BIN}:/usr/bin:/bin" bash "$D/litellm-up.sh"; }

@test "litellm-up: with the DB secret, LiteLLM joins its own Postgres on one docker network" {
	run up
	[ "$status" -eq 0 ]
	grep -qx "docker network create litellm" "$LOG"
	grep -q "^docker run -d --name litellm-db --restart unless-stopped --network litellm -p 127.0.0.1:5432:5432 " "$LOG"
	grep -q "^docker run --rm --name litellm-proxy --network litellm -e DATABASE_URL " "$LOG"
	grep -qx "db-url=postgresql://litellm:the-db-pw@litellm-db:5432/litellm" "$LOG"
}

@test "litellm-up: the DB password never appears on a command line, and the DB reads it from a private file" {
	run up
	! grep -q "^docker .*the-db-pw" "$LOG"
	grep -q "^docker run -d .*-e POSTGRES_PASSWORD_FILE=/run/secrets/db_password " "$LOG"
	! grep -q "^docker run -d .*-e POSTGRES_PASSWORD " "$LOG"
	f="${HOME}/.local/state/litellm-secrets/db_password"
	[ "$(cat "$f")" = the-db-pw ]
	[ "$(stat -f %Lp "$f" 2>/dev/null || stat -c %a "$f")" = 600 ]
}

@test "litellm-up: a running DB is reused, not recreated" {
	fake docker 'case "$1 $2" in "inspect -f") echo true ;; esac'
	run up
	[ "$status" -eq 0 ]
	! grep -q "^docker run -d" "$LOG"
	! grep -q "^docker rm -f litellm-db" "$LOG"
}

@test "litellm-up: without the DB secret it serves as before, unrecorded" {
	export DB_SECRET=""
	run --separate-stderr up
	[ "$status" -eq 0 ]
	! grep -q "litellm-db\|network" "$LOG"
	grep -qx "db-url=none" "$LOG"
	[[ "$stderr" == *"without spend records"* ]]
}

@test "litellm-up: a stopped engine is waited for, and said once in the log" {
	# `docker info` fails twice, then answers
	fake docker 'case "$1" in
		info) n=$(cat "'"${BATS_TEST_TMPDIR}"'/n" 2>/dev/null || echo 0); echo $((n + 1)) >"'"${BATS_TEST_TMPDIR}"'/n"; [ "$n" -ge 2 ] || { echo "Cannot connect to the Docker daemon" >&2; exit 1; } ;;
		network) [ "$2" = inspect ] && exit 1 ;;
	esac
	case "$1 $2" in "inspect -f") echo false ;; esac'
	run --separate-stderr up
	[ "$status" -eq 0 ]
	[ "$(grep -c 'waiting for the Docker engine' <<<"$output")" -eq 1 ]
	[[ "$output" == *"the Docker engine answers"* ]]
}

@test "litellm-up: an engine that refuses this user stops it with the reason" {
	fake docker 'case "$1" in info) echo "permission denied while trying to connect to the docker API" >&2; exit 1 ;; esac'
	run --separate-stderr up
	[ "$status" -eq 1 ]
	[[ "$stderr" == *"not in the docker group"* ]]
	! grep -q "^docker run" "$LOG"
}

@test "litellm-up: deterministic goes to the desktop's llama-server, its key passed by name only" {
	export LLAMA_SERVER_HOST=desktop.example.ts.net
	run up
	[ "$status" -eq 0 ]
	grep -q "^docker run --rm .*-e LLAMA_SERVER_API_BASE=http://desktop.example.ts.net:8080/v1 -e LLAMA_SERVER_API_KEY " "$LOG"
	! grep -q "^docker run --rm .*LLAMA_SERVER_API_KEY=" "$LOG"
}

@test "litellm-up: on linux the desktop's tailnet name is resolved on the host and handed to the container" {
	export LLAMA_SERVER_HOST=desktop.example.ts.net
	fake uname 'echo Linux'
	fake secret-tool 'echo token'
	fake getent 'echo "100.64.0.7      STREAM desktop.example.ts.net"'
	run up
	[ "$status" -eq 0 ]
	grep -q "^docker run --rm .*--add-host desktop.example.ts.net:100.64.0.7 " "$LOG"
}

@test "litellm-up: without the desktop's name it still serves, and says deterministic will fail" {
	unset LLAMA_SERVER_HOST
	run --separate-stderr up
	[ "$status" -eq 0 ]
	grep -q "^docker run --rm --name litellm-proxy" "$LOG"
	[[ "$stderr" == *'"llamaServerHost" is not in the roles file'* ]]
}
