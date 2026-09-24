#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# home-llm-setup <checkout> <hub|node>: the home-LLM steps that are commands.
# Every outside tool is a recording stand-in; the script never fails the
# switch and lists what is left to do instead.

SCRIPT="${BATS_TEST_DIRNAME}/../../next/pkgs/scripts/home-llm-setup/home-llm-setup.sh"

setup() {
	ROOT="${BATS_TEST_TMPDIR}/repo"
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	L="${ROOT}/domains/dev/config/litellm"
	mkdir -p "${L}/observability" "${BIN}"
	touch "${LOG}"
	for f in check.sh observability/start.sh; do
		printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\n' "$f" "${LOG}" >"${L}/$f"
	done
	printf '#!/usr/bin/env bash\necho the-key\n' >"${L}/proxy-key.sh"
	chmod +x "${L}/proxy-key.sh"
	fake uname 'echo Darwin'
	fake tailscale 'if [ "$1" = status ]; then echo "{\"BackendState\": \"Running\"}"; fi'
	for t in open security secret-tool launchctl systemctl curl docker lms sleep; do fake "$t"; done
	fake timeout 'shift; exec "$@"'
}

fake() { # fake <name> [body]
	printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\n%s\n' "$1" "${LOG}" "${2:-}" >"${BIN}/$1"
	chmod +x "${BIN}/$1"
}

hl() { PATH="${BIN}:/usr/bin:/bin" bash -euo pipefail "${SCRIPT}" "${ROOT}" "$@"; }

@test "home-llm: a role other than hub or node is refused" {
	run hl gpu
	[ "$status" -eq 2 ]
}

@test "home-llm hub: serves LM Studio and Open WebUI on the tailnet, never the metrics port" {
	run hl hub
	[ "$status" -eq 0 ]
	grep -qx "tailscale serve --bg --tcp 1234 tcp://127.0.0.1:1234" "${LOG}"
	grep -qx "tailscale serve --bg --https=3001 127.0.0.1:3001" "${LOG}"
	! grep -q "serve --bg --tcp 4001" "${LOG}"
}

@test "home-llm node: serves the metrics port only" {
	run hl node
	[ "$status" -eq 0 ]
	grep -qx "tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001" "${LOG}"
	[ "$(grep -c '^tailscale serve' "${LOG}")" -eq 1 ]
}

@test "home-llm: logged out of tailscale serves nothing and says to log in" {
	fake tailscale 'if [ "$1" = status ]; then echo "{\"BackendState\": \"NeedsLogin\"}"; fi'
	run hl hub
	[ "$status" -eq 0 ]
	! grep -q "tailscale serve" "${LOG}"
	[[ "$output" == *"Tailscale: log in"* ]]
}

@test "home-llm hub: starts Prometheus + Grafana, and Open WebUI with the LiteLLM key in its environment" {
	fake docker 'if [ "$1" = compose ]; then echo "compose key=${LITELLM_API_KEY:-}" >>"'"${LOG}"'"; fi'
	run hl hub
	[ "$status" -eq 0 ]
	grep -qx "observability/start.sh --ui" "${LOG}"
	grep -q "^docker compose -f ${L}/observability/docker-compose.yml --profile webui up -d open-webui" "${LOG}"
	grep -qx "compose key=the-key" "${LOG}"
}

@test "home-llm node: no stacks, no LM Studio" {
	run hl node
	! grep -q "observability/start.sh" "${LOG}"
	! grep -q "^lms" "${LOG}"
	! grep -q "^docker compose" "${LOG}"
}

@test "home-llm: LiteLLM restarts onto the current config on macOS and Linux" {
	run hl node
	grep -q "^launchctl kickstart -k gui/.*/com.esh2n.litellm-proxy" "${LOG}"
	: >"${LOG}"
	fake uname 'echo Linux'
	run hl node
	grep -qx "systemctl --user restart litellm-proxy.service" "${LOG}"
}

@test "home-llm: without the op token LiteLLM is left alone and the reason is listed" {
	fake security 'exit 44'
	run hl node
	[ "$status" -eq 0 ]
	! grep -q "kickstart" "${LOG}"
	[[ "$output" == *"service-account token"* ]]
}

@test "home-llm node: the hub's name reaches the service when given" {
	LM_STUDIO_REMOTE_HOST=hub.example.ts.net run hl node
	grep -qx "launchctl setenv LM_STUDIO_REMOTE_HOST hub.example.ts.net" "${LOG}"
}

@test "home-llm: the tier check runs last, and its failure is listed, not fatal" {
	printf '#!/usr/bin/env bash\necho "check.sh" >>"%s"\nexit 3\n' "${LOG}" >"${L}/check.sh"
	run hl hub
	[ "$status" -eq 0 ]
	[ "$(tail -1 "${LOG}")" = "check.sh" ]
	[[ "$output" == *"check.sh reported failing"* ]]
}

@test "home-llm hub: finds lms where LM Studio puts it, off the activation PATH" {
	export HOME="${BATS_TEST_TMPDIR}/home"
	mkdir -p "${HOME}/.lmstudio/bin"
	printf '#!/usr/bin/env bash\necho "lms $*" >>"%s"\n' "${LOG}" >"${HOME}/.lmstudio/bin/lms"
	chmod +x "${HOME}/.lmstudio/bin/lms"
	rm "${BIN}/lms"
	fake curl 'case "$*" in *1234*) exit 7 ;; esac'
	run hl hub
	grep -q "^lms server start --port 1234" "${LOG}"
}

@test "home-llm: a LiteLLM job launchd does not have loaded yet is bootstrapped, a loaded one kickstarted" {
	fake launchctl 'if [ "$1" = print ]; then exit 113; fi'
	run hl node
	grep -q "^launchctl bootstrap gui/[0-9]* .*/Library/LaunchAgents/com.esh2n.litellm-proxy.plist" "${LOG}"
	! grep -q "kickstart" "${LOG}"
	: >"${LOG}"
	fake launchctl
	run hl node
	grep -q "^launchctl kickstart -k gui/.*/com.esh2n.litellm-proxy" "${LOG}"
	! grep -q "^launchctl bootstrap" "${LOG}"
}
