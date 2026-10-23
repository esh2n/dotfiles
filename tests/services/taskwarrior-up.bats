#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The tasks' launchers (rules/decisions/2026-10-23-personal-tasks-sync.md):
# sync-server-up.sh admits only the replicas' client id; task-sync-up.sh hands
# the shared secrets to `dotctl tasks sync loop`, or keeps the replica local
# without them. Every outside command is a recording stand-in.

setup() {
	D="${BATS_TEST_TMPDIR}/taskwarrior"
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "$D" "$BIN" "${BATS_TEST_TMPDIR}/litellm/config"
	R="${BATS_TEST_DIRNAME}/../../home/shared"
	for s in sync-server-up task-sync-up; do
		sed "s|^use_service_path\$|PATH=\"${BIN}:/usr/bin:/bin\"|" "$R/taskwarrior/$s.sh" >"$D/$s.sh"
	done
	cp "$R/litellm/config/secrets.sh" "${BATS_TEST_TMPDIR}/litellm/config/secrets.sh"
	export HOME="${BATS_TEST_TMPDIR}/home" CLIENT=the-id SECRET=the-secret
	mkdir -p "$HOME"
	fake uname 'echo Darwin'
	fake security 'echo token'
	fake op 'case "$*" in *client-id*) printf "%s" "$CLIENT" ;; *encryption-secret*) printf "%s" "$SECRET" ;; esac'
	fake timeout 'shift; exec "$@"'
	fake sleep ':'
	# the server and dotctl record what reached their environment
	fake server 'echo "env id=${CLIENT_ID:-none} op=${OP_SERVICE_ACCOUNT_TOKEN:-none}" >>"'"${LOG}"'"'
	fake dotctl 'echo "env url=${TASK_SYNC_URL:-none} id=${TASK_CLIENT_ID:-none} secret=${TASK_ENCRYPTION_SECRET:-none} op=${OP_SERVICE_ACCOUNT_TOKEN:-none}" >>"'"${LOG}"'"'
	export SYNC_SERVER="${BIN}/server" SYNC_LISTEN=127.0.0.1:10222 DOTCTL="${BIN}/dotctl"
}

fake() {
	printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\n%s\n' "$1" "${LOG}" "${2:-}" >"${BIN}/$1"
	chmod +x "${BIN}/$1"
}

launch() { PATH="${BIN}:/usr/bin:/bin" bash "$D/$1.sh"; }

@test "sync-server-up: listens on loopback, admits only the shared client id (from its environment, not argv, without the vault token), keeps its data private" {
	run launch sync-server-up
	[ "$status" -eq 0 ]
	grep -qx "server --listen 127.0.0.1:10222 --data-dir ${HOME}/.local/share/taskchampion-sync-server" "$LOG"
	grep -qx "env id=the-id op=none" "$LOG"
	f="${HOME}/.local/share/taskchampion-sync-server"
	[ "$(stat -c %a "$f" 2>/dev/null || stat -f %Lp "$f")" = 700 ]
}

@test "sync-server-up: without the client id it does not start an open server" {
	export CLIENT=""
	run --separate-stderr launch sync-server-up
	[ "$status" -ne 0 ]
	[[ "$stderr" == *"could not resolve"* ]]
	run ! grep -q "^server " "$LOG"
}

@test "task-sync-up: hands the shared secrets to the loop through its environment only" {
	export TASK_SYNC_URL=https://mac.example.ts.net:10222
	run launch task-sync-up
	[ "$status" -eq 0 ]
	grep -qx "dotctl tasks sync loop" "$LOG"
	grep -qx "env url=https://mac.example.ts.net:10222 id=the-id secret=the-secret op=none" "$LOG"
	run ! grep -q "^dotctl .*the-secret" "$LOG"
}

@test "task-sync-up: without the secrets it backs up once and exits, so the service manager tries again" {
	export TASK_SYNC_URL=https://mac.example.ts.net:10222 SECRET=""
	run --separate-stderr launch task-sync-up
	[ "$status" -eq 1 ]
	grep -qx "dotctl tasks sync once" "$LOG"
	grep -qx "env url=none id=none secret=none op=none" "$LOG"
	[[ "$stderr" == *"no sync secrets"* ]]
	run ! grep -q "^dotctl tasks sync loop" "$LOG"
}

@test "task-sync-up: with no server it needs no 1Password at all" {
	unset TASK_SYNC_URL
	fake security 'exit 1'
	fake secret-tool 'exit 1'
	run launch task-sync-up
	[ "$status" -eq 0 ]
	grep -qx "dotctl tasks sync loop" "$LOG"
	grep -qx "env url=none id=none secret=none op=none" "$LOG"
	run ! grep -q "^security\|^secret-tool\|^op " "$LOG"
}

@test "task-sync-up: without the 1Password token in the OS store it backs up once and exits" {
	export TASK_SYNC_URL=https://mac.example.ts.net:10222
	fake security 'exit 1'
	run --separate-stderr launch task-sync-up
	[ "$status" -eq 1 ]
	grep -qx "dotctl tasks sync once" "$LOG"
	[[ "$stderr" == *"no sync secrets"* ]]
	run ! grep -q "^op " "$LOG"
}
