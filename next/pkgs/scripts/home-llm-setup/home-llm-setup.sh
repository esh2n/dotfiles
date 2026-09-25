# home-llm-setup <checkout> [--lmstudio] [--console] [--gpu]: bring this
# machine to the home-LLM rulings
# (rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md,
# 2026-09-24-home-llm-second-host-omarchy-llama-server.md). Ported from the
# old domains/dev/install.sh. Machines use each other's models — there is no
# hub; what runs follows this machine's roles, never whether an app exists:
#
#   --lmstudio: LM Studio's server, tailscale serve 1234
#   --gpu     : tailscale serve 8080 (llama-server, Linux)
#   --console : Prometheus + Grafana + Open WebUI, the cost ledger's table,
#               tailscale serve https 3001 and tcp 5432 (the ledger);
#               without it, tailscale serve 4001 so the console can scrape
#               this machine's LiteLLM metrics
#   always    : LiteLLM restarted onto the current config, then litellm/check.sh
#
# The service definitions themselves are declared (next/roles, mk-service);
# this runs only the steps that are commands. Nothing here fails the switch:
# what cannot be done now is listed at the end, with what to do.

ROOT="${1:?usage: home-llm-setup <checkout> [--lmstudio] [--console] [--gpu]}"
shift
LMSTUDIO=0 CONSOLE=0 GPU=0
for flag in "$@"; do
	case "${flag}" in
	--lmstudio) LMSTUDIO=1 ;;
	--console) CONSOLE=1 ;;
	--gpu) GPU=1 ;;
	*)
		echo "home-llm-setup: unknown flag ${flag} (--lmstudio, --console, --gpu)" >&2
		exit 2
		;;
	esac
done

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
		[[ "${LMSTUDIO}" == 0 && -n "${LM_STUDIO_REMOTE_HOST:-}" ]] && launchctl setenv LM_STUDIO_REMOTE_HOST "${LM_STUDIO_REMOTE_HOST}"
		local domain job=com.esh2n.litellm-proxy
		domain="gui/$(id -u)"
		# Reload from the current plist: a job loaded by an earlier layout (or
		# an older plist) is booted out first. bootout returns before the job
		# is gone, and bootstrapping then fails with "Input/output error"
		# (code 5), so wait until launchd no longer has it.
		if launchctl print "${domain}/${job}" >/dev/null 2>&1; then
			launchctl bootout "${domain}/${job}" >/dev/null 2>&1 || true
			local _
			for _ in $(seq 1 40); do
				launchctl print "${domain}/${job}" >/dev/null 2>&1 || break
				sleep 0.5
			done
		fi
		launchctl bootstrap "${domain}" "${HOME}/Library/LaunchAgents/${job}.plist" || todo "LiteLLM: launchctl bootstrap failed"
		;;
	*)
		[[ "${LMSTUDIO}" == 0 && -n "${LM_STUDIO_REMOTE_HOST:-}" ]] && systemctl --user set-environment "LM_STUDIO_REMOTE_HOST=${LM_STUDIO_REMOTE_HOST}"
		systemctl --user restart litellm-proxy.service || todo "LiteLLM: systemctl --user restart litellm-proxy failed"
		;;
	esac
	if [[ "${LMSTUDIO}" == 0 && -z "${LM_STUDIO_REMOTE_HOST:-}" ]]; then
		todo "LiteLLM: name the machine serving LM Studio once — LM_STUDIO_REMOTE_HOST=<mac.tailnet.ts.net> make up"
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

console_stacks() {
	if ! docker info >/dev/null 2>&1; then
		todo "docker is not answering (start OrbStack), then make up for Prometheus / Grafana / Open WebUI"
		return 0
	fi
	bash "${LITELLM}/observability/start.sh" --ui >/dev/null || todo "observability/start.sh --ui failed"
	# the ledger's own table beside LiteLLM's (idempotent)
	if docker inspect litellm-db >/dev/null 2>&1; then
		docker exec -i litellm-db psql -q -U litellm -d litellm -v ON_ERROR_STOP=1 <"${ROOT}/next/home/shared/llm-ledger/ledger.sql" ||
			todo "cost ledger: could not create its table (docker exec litellm-db psql)"
	else
		todo "cost ledger: no litellm-db container yet (store op://llm-automation/litellm-db/password, then make up)"
	fi
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
else
	[[ "${LMSTUDIO}" == 1 ]] && serve --tcp 1234 tcp://127.0.0.1:1234
	[[ "${GPU}" == 1 ]] && serve --tcp 8080 tcp://127.0.0.1:8080
	if [[ "${CONSOLE}" == 1 ]]; then
		serve --https=3001 127.0.0.1:3001
		serve --tcp 5432 tcp://127.0.0.1:5432 # the cost ledger, for the other machines' sync
	else
		serve --tcp 4001 tcp://127.0.0.1:4001
	fi
fi

[[ "${LMSTUDIO}" == 1 ]] && lm_studio
restart_litellm
[[ "${CONSOLE}" == 1 ]] && console_stacks
CHECK=()
[[ "${LMSTUDIO}" == 1 ]] && CHECK+=(--lmstudio)
[[ "${CONSOLE}" == 1 ]] && CHECK+=(--console)
bash "${LITELLM}/check.sh" ${CHECK[@]+"${CHECK[@]}"} || todo "litellm/check.sh reported failing lines above"

if ((${#TODO[@]})); then
	echo "home-llm: left to do:"
	printf '  - %s\n' "${TODO[@]}"
fi
if [[ "${CONSOLE}" == 1 ]]; then
	echo "home-llm: once, by hand: the tailnet policy (make tailscale-acl, paste, Save); the phone joins the tailnet and pairs Orca's companion over LAN"
fi
exit 0
