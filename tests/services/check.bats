#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# litellm/check.sh probes the home-LLM stack. Which half it probes is the
# machine's role when the caller knows it (next: home-llm-setup passes it),
# and only falls back to guessing from LM Studio.app. Run from a copy with
# every outside tool stubbed, so no request leaves the machine.

setup() {
	D="${BATS_TEST_TMPDIR}/litellm"
	BIN="${BATS_TEST_TMPDIR}/bin"
	mkdir -p "$D" "$BIN"
	cp "${BATS_TEST_DIRNAME}/../../domains/dev/config/litellm/check.sh" "$D/"
	printf '#!/bin/sh\n' >"$D/proxy-key.sh"
	chmod +x "$D/proxy-key.sh"
	for t in curl tailscale omp timeout sleep; do printf '#!/bin/sh\nexit 1\n' >"$BIN/$t"; chmod +x "$BIN/$t"; done
	export XDG_STATE_HOME="${BATS_TEST_TMPDIR}/state"
}

check() { PATH="${BIN}:/usr/bin:/bin" bash "$D/check.sh" "$@"; }

@test "check: --role names the half to probe, whatever is installed" {
	run check --role hub
	[[ "${lines[0]}" == "home-llm check (hub)" ]]
	run check --role node
	[[ "${lines[0]}" == "home-llm check (node)" ]]
}

@test "check: --complex still works beside --role" {
	run check --complex --role node
	[[ "${lines[0]}" == "home-llm check (node)" ]]
}

@test "check: an unknown role is refused" {
	run check --role gpu
	[ "$status" -eq 2 ]
}

@test "check: --lmstudio and --console name what this machine offers" {
	run check --lmstudio
	[[ "${lines[0]}" == "home-llm check (lmstudio)" ]]
	run check --lmstudio --console
	[[ "${lines[0]}" == "home-llm check (lmstudio console)" ]]
	run check --console
	[[ "${lines[0]}" == "home-llm check (console)" ]]
}
