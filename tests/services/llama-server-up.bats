#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# next/home/linux/llama-server/llama-server-up.sh: the systemd unit's
# foreground launcher. The API key comes from 1Password (the same headless
# path as LiteLLM) and reaches llama-server through a 0600 file, never argv.

SCRIPT="${BATS_TEST_DIRNAME}/../../next/home/linux/llama-server/llama-server-up.sh"

setup() {
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "$BIN"
	export HOME="${BATS_TEST_TMPDIR}/home" XDG_RUNTIME_DIR="${BATS_TEST_TMPDIR}/run"
	mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
	for t in uname secret-tool op timeout; do :; done
	printf '#!/bin/sh\necho Linux\n' >"$BIN/uname"
	printf '#!/bin/sh\necho token\n' >"$BIN/secret-tool"
	printf '#!/bin/sh\necho the-api-key\n' >"$BIN/op"
	printf '#!/bin/sh\nshift; exec "$@"\n' >"$BIN/timeout"
	cat >"$BIN/llama-server" <<-SERVER
		#!/usr/bin/env bash
		echo "llama-server \$*" >>"${LOG}"
		for ((i = 1; i <= \$#; i++)); do
			if [ "\${!i}" = --api-key-file ]; then j=\$((i + 1)); f="\${!j}"; stat -c %a "\$f" 2>/dev/null >>"${LOG}" || stat -f %Lp "\$f" >>"${LOG}"; cat "\$f" >>"${LOG}"; fi
		done
	SERVER
	chmod +x "$BIN"/*
	export LLAMA_SERVER_BIN="$BIN/llama-server" LLAMA_PORT=8080 LLAMA_MODELS_DIR="${HOME}/models"
}

up() {
	# the library's fixed service PATH is replaced by the stand-ins' dir for the test
	sed "s|^use_service_path\$|PATH=\"${BIN}:/usr/bin:/bin\"|" "$SCRIPT" >"${BATS_TEST_TMPDIR}/up.sh"
	cp "${BATS_TEST_DIRNAME}/../../domains/dev/config/litellm/secrets.sh" "${BATS_TEST_TMPDIR}/secrets.sh"
	sed -i.bak "s|^source .*secrets.sh\"\$|source \"${BATS_TEST_TMPDIR}/secrets.sh\"|" "${BATS_TEST_TMPDIR}/up.sh"
	PATH="${BIN}:/usr/bin:/bin" bash "${BATS_TEST_TMPDIR}/up.sh"
}

@test "llama-server-up: router mode on loopback, metrics on, models dir created" {
	run up
	[ "$status" -eq 0 ]
	line="$(grep '^llama-server' "$LOG")"
	[[ "$line" == *"--host 127.0.0.1 --port 8080"* ]]
	[[ "$line" == *"--models-dir ${HOME}/models"* ]]
	[[ "$line" == *"--metrics"* ]]
	[ -d "${HOME}/models" ]
}

@test "llama-server-up: the key is in a file only the user can read, never on the command line" {
	run up
	[ "$status" -eq 0 ]
	! grep -q "^llama-server .*the-api-key" "$LOG"
	grep -qx "600" "$LOG"
	grep -qx "the-api-key" "$LOG"
}
