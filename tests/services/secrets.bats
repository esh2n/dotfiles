#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# home/shared/litellm/config/secrets.sh: what every headless launcher (the
# LiteLLM proxy, jig-decision, proxy-key.sh) uses to reach 1Password without
# a prompt. The service-account token comes from the OS's own store — the
# login Keychain on macOS, the Secret Service (libsecret) on Linux.

LIB="${BATS_TEST_DIRNAME}/../../home/shared/litellm/config/secrets.sh"

setup() {
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "${BIN}"
	fake security 'echo keychain-token'
	fake secret-tool 'echo libsecret-token'
	fake timeout 'shift; exec "$@"'
	fake sleep ':'
}

fake() { # fake <name> <body>: a command that records its call, then runs body
	printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\n%s\n' "$1" "${LOG}" "$2" >"${BIN}/$1"
	chmod +x "${BIN}/$1"
}

os() { fake uname "echo $1"; }

in_lib() { PATH="${BIN}:/usr/bin:/bin" bash -c "set -euo pipefail; source '${LIB}'; $1"; }

@test "secrets: on macOS the op token comes from the login Keychain" {
	os Darwin
	run --separate-stderr in_lib 'export_op_token; echo "$OP_SERVICE_ACCOUNT_TOKEN"'
	[ "$status" -eq 0 ]
	[ "$output" = "keychain-token" ]
	grep -q "^security find-generic-password -s litellm-op-token -w" "${LOG}"
}

@test "secrets: on Linux the op token comes from the Secret Service" {
	os Linux
	run --separate-stderr in_lib 'export_op_token; echo "$OP_SERVICE_ACCOUNT_TOKEN"'
	[ "$status" -eq 0 ]
	[ "$output" = "libsecret-token" ]
	grep -q "^secret-tool lookup service litellm-op-token" "${LOG}"
}

@test "secrets: an empty store is a failure that says how to fill it" {
	os Linux
	fake secret-tool ':'
	run --separate-stderr in_lib 'export_op_token; echo reached'
	[ "$status" -ne 0 ]
	[[ "$output" != *reached* ]]
	[[ "$stderr" == *"secret-tool store"* ]]
}

@test "secrets: read_secret retries an empty first read once" {
	os Darwin
	fake op 'n=$(grep -c "^op " "'"${LOG}"'"); [ "$n" -ge 2 ] && echo value || true'
	run --separate-stderr in_lib 'read_secret op://v/i/f'
	[ "$status" -eq 0 ]
	[ "$output" = "value" ]
	[ "$(grep -c '^op read op://v/i/f' "${LOG}")" -eq 2 ]
}

@test "secrets: read_secret aborts when both reads are empty" {
	os Darwin
	fake op ':'
	run --separate-stderr in_lib 'x="$(read_secret op://v/i/f)"; echo reached'
	[ "$status" -ne 0 ]
	[[ "$output" != *reached* ]]
	[[ "$stderr" == *"op://v/i/f"* ]]
}

@test "secrets: the service PATH is fixed and names both Nix profiles, whatever was inherited" {
	os Linux
	run --separate-stderr in_lib 'PATH="/evil:$PATH"; use_service_path; echo "$PATH"'
	[[ "$output" == "/etc/profiles/per-user/"* ]]
	[[ "$output" == *"/.nix-profile/bin"* ]]
	[[ "$output" != *"/evil"* ]]
	[[ "$output" != *"${BIN}"* ]]
}

@test "secrets: the launchers read the token only through this library" {
	C="${BATS_TEST_DIRNAME}/../../home/shared"
	run grep -ln "security find-generic-password" "${C}/litellm/config/litellm-up.sh" "${C}/litellm/config/proxy-key.sh" "${C}/services/jig-decision-up.sh"
	[ "$status" -eq 1 ]
	for f in "${C}/litellm/config/litellm-up.sh" "${C}/litellm/config/proxy-key.sh" "${C}/services/jig-decision-up.sh"; do
		grep -qE '^source .*secrets\.sh"$' "$f"
		# the fixed PATH comes before any tool is looked up
		[ "$(grep -n '^use_service_path$' "$f" | cut -d: -f1)" -lt "$(grep -n '^export_op_token$' "$f" | cut -d: -f1)" ]
	done
}
