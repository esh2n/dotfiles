#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# home-llm-setup <checkout> [--lmstudio] [--console] [--gpu]: the home-LLM
# steps that are commands, chosen by what this machine offers.
# Every outside tool is a recording stand-in; the script never fails the
# switch and lists what is left to do instead.

SCRIPT="${BATS_TEST_DIRNAME}/../../next/pkgs/scripts/home-llm-setup/home-llm-setup.sh"

setup() {
	ROOT="${BATS_TEST_TMPDIR}/repo"
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	L="${ROOT}/domains/dev/config/litellm"
	mkdir -p "${L}/observability" "${BIN}" "${ROOT}/next/home/shared/llm-ledger"
	touch "${ROOT}/next/home/shared/llm-ledger/ledger.sql"
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

@test "home-llm: an unknown flag is refused" {
	run hl --hub
	[ "$status" -eq 2 ]
}

@test "home-llm lmstudio + console: serves LM Studio and Open WebUI on the tailnet, never the metrics port" {
	run hl --lmstudio --console
	[ "$status" -eq 0 ]
	grep -qx "tailscale serve --bg --tcp 1234 tcp://127.0.0.1:1234" "${LOG}"
	grep -qx "tailscale serve --bg --https=3001 127.0.0.1:3001" "${LOG}"
	! grep -q "serve --bg --tcp 4001" "${LOG}"
}

@test "home-llm without a role: serves the metrics port only" {
	run hl
	[ "$status" -eq 0 ]
	grep -qx "tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001" "${LOG}"
	[ "$(grep -c '^tailscale serve' "${LOG}")" -eq 1 ]
}

@test "home-llm: logged out of tailscale serves nothing and says to log in" {
	fake tailscale 'if [ "$1" = status ]; then echo "{\"BackendState\": \"NeedsLogin\"}"; fi'
	run hl --lmstudio --console
	[ "$status" -eq 0 ]
	! grep -q "tailscale serve" "${LOG}"
	[[ "$output" == *"Tailscale: log in"* ]]
}

@test "home-llm console: starts Prometheus + Grafana, and Open WebUI with the LiteLLM key in its environment" {
	fake docker 'if [ "$1" = compose ]; then echo "compose key=${LITELLM_API_KEY:-}" >>"'"${LOG}"'"; fi'
	run hl --console
	[ "$status" -eq 0 ]
	grep -qx "observability/start.sh --ui" "${LOG}"
	grep -q "^docker compose -f ${L}/observability/docker-compose.yml --profile webui up -d open-webui" "${LOG}"
	grep -qx "compose key=the-key" "${LOG}"
}

@test "home-llm without lmstudio or console: no stacks, no LM Studio" {
	run hl
	! grep -q "observability/start.sh" "${LOG}"
	! grep -q "^lms" "${LOG}"
	! grep -q "^docker compose" "${LOG}"
}

@test "home-llm: LiteLLM restarts onto the current config on macOS and Linux" {
	run hl
	grep -q "^launchctl kickstart -k gui/.*/com.esh2n.litellm-proxy" "${LOG}"
	: >"${LOG}"
	fake uname 'echo Linux'
	run hl
	grep -qx "systemctl --user restart litellm-proxy.service" "${LOG}"
}

@test "home-llm: without the op token LiteLLM is left alone and the reason is listed" {
	fake security 'exit 44'
	run hl
	[ "$status" -eq 0 ]
	! grep -q "kickstart" "${LOG}"
	[[ "$output" == *"service-account token"* ]]
}

@test "home-llm without lmstudio: the LM Studio machine's name reaches the service when given" {
	LM_STUDIO_REMOTE_HOST=mac.example.ts.net run hl
	grep -qx "launchctl setenv LM_STUDIO_REMOTE_HOST mac.example.ts.net" "${LOG}"
}

@test "home-llm: the tier check runs last, and its failure is listed, not fatal" {
	printf '#!/usr/bin/env bash\necho "check.sh" >>"%s"\nexit 3\n' "${LOG}" >"${L}/check.sh"
	run hl --lmstudio --console
	[ "$status" -eq 0 ]
	[ "$(tail -1 "${LOG}")" = "check.sh" ]
	[[ "$output" == *"check.sh reported failing"* ]]
	: >"${LOG}"
	printf '#!/usr/bin/env bash\necho "check.sh $*" >>"%s"\n' "${LOG}" >"${L}/check.sh"
	run hl --lmstudio
	grep -qx "check.sh --lmstudio" "${LOG}"
	: >"${LOG}"
	run hl
	grep -Eqx "check.sh ?" "${LOG}"
}

@test "home-llm lmstudio: finds lms where LM Studio puts it, off the activation PATH" {
	export HOME="${BATS_TEST_TMPDIR}/home"
	mkdir -p "${HOME}/.lmstudio/bin"
	printf '#!/usr/bin/env bash\necho "lms $*" >>"%s"\n' "${LOG}" >"${HOME}/.lmstudio/bin/lms"
	chmod +x "${HOME}/.lmstudio/bin/lms"
	rm "${BIN}/lms"
	fake curl 'case "$*" in *1234*) exit 7 ;; esac'
	run hl --lmstudio
	grep -q "^lms server start --port 1234" "${LOG}"
}

@test "home-llm: a LiteLLM job launchd does not have loaded yet is bootstrapped, a loaded one kickstarted" {
	fake launchctl 'if [ "$1" = print ]; then exit 113; fi'
	run hl
	grep -q "^launchctl bootstrap gui/[0-9]* .*/Library/LaunchAgents/com.esh2n.litellm-proxy.plist" "${LOG}"
	! grep -q "kickstart" "${LOG}"
	: >"${LOG}"
	fake launchctl
	run hl
	grep -q "^launchctl kickstart -k gui/.*/com.esh2n.litellm-proxy" "${LOG}"
	! grep -q "^launchctl bootstrap" "${LOG}"
}

@test "home-llm --gpu: also serves llama-server's port, nothing else extra" {
	run hl --gpu
	[ "$status" -eq 0 ]
	grep -qx "tailscale serve --bg --tcp 8080 tcp://127.0.0.1:8080" "${LOG}"
	grep -qx "tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001" "${LOG}"
	[ "$(grep -c '^tailscale serve' "${LOG}")" -eq 2 ]
}

@test "home-llm --console: serves the cost ledger's port and creates its table in the local DB" {
	run hl --console
	[ "$status" -eq 0 ]
	grep -qx "tailscale serve --bg --tcp 5432 tcp://127.0.0.1:5432" "${LOG}"
	grep -q "^docker exec -i litellm-db psql -q -U litellm -d litellm -v ON_ERROR_STOP=1" "${LOG}"
}

@test "home-llm without --console: the ledger port stays closed" {
	run hl --lmstudio
	! grep -q "5432" "${LOG}"
}
