# home-llm-setup <checkout> <hub|node>: bring this machine to the home-LLM
# rulings (rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md,
# 2026-09-24-home-llm-second-host-omarchy-llama-server.md). Ported from the
# old domains/dev/install.sh; which half runs is the machine's role now
# (llm-hub = hub, any other dev machine = node), not whether an app exists.
#
#   hub : LM Studio's server, tailscale serve 1234 (LM Studio) + https 3001
#         (Open WebUI), Prometheus + Grafana + Open WebUI
#   node: LiteLLM pointed at the hub, tailscale serve 4001 (metrics only)
#   --gpu: tailscale serve 8080 (llama-server, the gpu role on Linux)
#   both: LiteLLM restarted onto the current config, then litellm/check.sh
#
# The service definitions themselves are declared (next/roles, mk-service);
# this runs only the steps that are commands. Nothing here fails the switch:
# what cannot be done now is listed at the end, with what to do.

ROOT="${1:?usage: home-llm-setup <checkout> <hub|node> [--gpu]}"
ROLE="${2:?usage: home-llm-setup <checkout> <hub|node> [--gpu]}"
GPU=0
[[ "${3:-}" == --gpu ]] && GPU=1
case "${ROLE}" in hub | node) ;; *)
	echo "home-llm-setup: role must be hub or node, not ${ROLE}" >&2
	exit 2
	;;
esac

OS="$(uname -s)"
# LM Studio installs its CLI here; activation does not read the shell's rc.
PATH="${HOME}/.lmstudio/bin:${PATH}"
LITELLM="${ROOT}/domains/dev/config/litellm"
TODO=()
todo() { TODO+=("$*"); }
note() { echo "home-llm: $*"; }
answers() { curl -sf --max-time 2 "$1" >/dev/null 2>&1; }
wait_for() { # wait_for <url>: up to two minutes
	local _
	for _ in $(seq 1 60); do
		answers "$1" && return 0
		sleep 2
	done
	return 1
}

has_op_token() {
	case "${OS}" in
	Darwin) security find-generic-password -s litellm-op-token >/dev/null 2>&1 ;;
	*) secret-tool lookup service litellm-op-token >/dev/null 2>&1 ;;
	esac
}

find_tailscale() { # prints the CLI's path, nothing when it is not installed
	if command -v tailscale >/dev/null 2>&1; then
		command -v tailscale
	elif [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then
		echo /Applications/Tailscale.app/Contents/MacOS/Tailscale
	fi
}

tailscale_state() { # prints the backend state (Running when logged in)
	# On a fresh Mac the CLI waits for a backend the app has not started yet.
	[[ "${OS}" == Darwin ]] && { open -a Tailscale 2>/dev/null || true; }
	timeout 10 "${TS}" status --json 2>/dev/null | sed -n 's/.*"BackendState": *"\([A-Za-z]*\)".*/\1/p' | head -1
}

serve() { # serve <tailscale serve args...>: persistent (--bg), idempotent
	timeout 20 "${TS}" serve --bg "$@" >/dev/null || todo "tailscale serve $* failed"
}

restart_litellm() {
	if ! has_op_token; then
		todo "LiteLLM: store the 1Password service-account token once (domains/dev/config/litellm/secrets.sh names the command for this OS), then make up"
		return 0
	fi
	case "${OS}" in
	Darwin)
		[[ "${ROLE}" == node && -n "${LM_STUDIO_REMOTE_HOST:-}" ]] && launchctl setenv LM_STUDIO_REMOTE_HOST "${LM_STUDIO_REMOTE_HOST}"
		local domain job=com.esh2n.litellm-proxy
		domain="gui/$(id -u)"
		# A loaded job is restarted in place; bootout-then-bootstrap races
		# ("Input/output error"). One launchd has not loaded yet is loaded.
		if launchctl print "${domain}/${job}" >/dev/null 2>&1; then
			launchctl kickstart -k "${domain}/${job}" || todo "LiteLLM: launchctl kickstart failed"
		else
			launchctl bootstrap "${domain}" "${HOME}/Library/LaunchAgents/${job}.plist" || todo "LiteLLM: launchctl bootstrap failed"
		fi
		;;
	*)
		[[ "${ROLE}" == node && -n "${LM_STUDIO_REMOTE_HOST:-}" ]] && systemctl --user set-environment "LM_STUDIO_REMOTE_HOST=${LM_STUDIO_REMOTE_HOST}"
		systemctl --user restart litellm-proxy.service || todo "LiteLLM: systemctl --user restart litellm-proxy failed"
		;;
	esac
	if [[ "${ROLE}" == node && -z "${LM_STUDIO_REMOTE_HOST:-}" ]]; then
		todo "LiteLLM (node): name the hub once — LM_STUDIO_REMOTE_HOST=<hub.tailnet.ts.net> make up"
	fi
	local url
	for url in http://127.0.0.1:4000/health/liveliness http://127.0.0.1:4001/metrics; do
		if wait_for "${url}"; then
			note "LiteLLM answers on ${url}"
		else
			todo "LiteLLM: ${url} not answering after two minutes (see its log)"
		fi
	done
}

lm_studio() {
	answers http://127.0.0.1:1234/v1/models && return 0
	if command -v lms >/dev/null 2>&1; then
		timeout 30 lms server start --port 1234 >/dev/null 2>&1 || true
		sleep 3
		answers http://127.0.0.1:1234/v1/models && return 0
	fi
	todo "LM Studio: open the app once, Settings → 'run the LLM server on login', network 'localhost only'; then make up"
}

hub_stacks() {
	if ! docker info >/dev/null 2>&1; then
		todo "docker is not answering (start OrbStack), then make up for Prometheus / Grafana / Open WebUI"
		return 0
	fi
	bash "${LITELLM}/observability/start.sh" --ui >/dev/null || todo "observability/start.sh --ui failed"
	local key
	key="$("${LITELLM}/proxy-key.sh" 2>/dev/null || true)"
	if [[ -z "${key}" ]]; then
		todo "Open WebUI: the LiteLLM key did not resolve (litellm/proxy-key.sh); not started"
		return 0
	fi
	LITELLM_API_KEY="${key}" docker compose -f "${LITELLM}/observability/docker-compose.yml" --profile webui up -d open-webui >/dev/null 2>&1 ||
		todo "Open WebUI: docker compose --profile webui up -d open-webui failed"
}

TS="$(find_tailscale)"
if [[ -z "${TS}" ]]; then
	todo "Tailscale is not installed (macOS: the tailscale-app cask; Linux: https://tailscale.com/download/linux)"
elif [[ "$(tailscale_state)" != Running ]]; then
	todo "Tailscale: log in (macOS: the menu-bar app; Linux: sudo tailscale up), then make up for the serve steps"
elif [[ "${ROLE}" == hub ]]; then
	serve --tcp 1234 tcp://127.0.0.1:1234
	serve --https=3001 127.0.0.1:3001
else
	serve --tcp 4001 tcp://127.0.0.1:4001
fi
# gpu: llama-server, the one model server this machine puts on the tailnet
if [[ -n "${TS}" && "${GPU}" == 1 && "$(tailscale_state)" == Running ]]; then
	serve --tcp 8080 tcp://127.0.0.1:8080
fi

[[ "${ROLE}" == hub ]] && lm_studio
restart_litellm
[[ "${ROLE}" == hub ]] && hub_stacks
bash "${LITELLM}/check.sh" --role "${ROLE}" || todo "litellm/check.sh reported failing lines above"

if ((${#TODO[@]})); then
	echo "home-llm: left to do:"
	printf '  - %s\n' "${TODO[@]}"
fi
if [[ "${ROLE}" == hub ]]; then
	echo "home-llm: once, by hand: the tailnet policy (make tailscale-acl, paste, Save); the phone joins the tailnet and pairs Orca's companion over LAN"
fi
exit 0
