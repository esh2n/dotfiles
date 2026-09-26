#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Resident services: declared once (dotfiles.services.<name>), rendered as
# launchd agents on the Mac and systemd user services on Linux, switched on by
# roles. The Mac agents must match the plists they replace.

load '../lib/nix.bash'

roles() { printf '{"roles": [%s]}\n' "$1" >"${BATS_TEST_TMPDIR}/roles.json"; export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"; }

agents() {
	nix_eval_expr_json "let a = (builtins.getFlake \"git+file://${REPO_ROOT}\").darwinConfigurations.mac.config.home-manager.users.\"${USER}\".launchd.agents; in builtins.mapAttrs (_: v: v.config) (builtins.removeAttrs a (builtins.filter (n: !a.\${n}.enable) (builtins.attrNames a)))"
}

units() {
	nix_eval_expr_json "builtins.attrNames (builtins.getFlake \"git+file://${REPO_ROOT}\").homeConfigurations.linux.config.systemd.user.services"
}

field() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1:]: v=v.get(k) if isinstance(v, dict) else None
print(json.dumps(v))' "${@:2}"; }

@test "services: no roles, no services" {
	roles ''
	run --separate-stderr agents
	[ "$status" -eq 0 ]
	[ "$output" = "{}" ]
}

@test "services: developer and model-provider on the mac give the three agents the plists defined" {
	roles '"developer", "model-provider"'
	run --separate-stderr agents
	[ "$status" -eq 0 ]
	a="$output"
	C="${REPO_ROOT}/home/shared"
	[ "$(field "$a" litellm-proxy Label)" = '"com.esh2n.litellm-proxy"' ]
	[ "$(field "$a" litellm-proxy ProgramArguments)" = "[\"/bin/bash\", \"${C}/litellm/config/litellm-up.sh\"]" ]
	[ "$(field "$a" litellm-proxy ThrottleInterval)" = "120" ]
	[ "$(field "$a" litellm-proxy KeepAlive)" = "true" ]
	[ "$(field "$a" litellm-proxy RunAtLoad)" = "true" ]
	[ "$(field "$a" litellm-proxy ProcessType)" = '"Background"' ]
	[ "$(field "$a" litellm-proxy StandardOutPath)" = "\"${HOME}/Library/Logs/litellm-proxy.log\"" ]
	[ "$(field "$a" jig-decision ProgramArguments)" = "[\"/bin/bash\", \"${C}/services/jig-decision-up.sh\"]" ]
	[ "$(field "$a" jig-decision EnvironmentVariables JIG_DIR)" = "\"${REPO_ROOT}/harness/jig\"" ]
	[ "$(field "$a" jig-decision EnvironmentVariables JIG_DECISION_PORT)" = '"4100"' ]
	[ "$(field "$a" lmstudio-awake ProgramArguments)" = "[\"/bin/bash\", \"${REPO_ROOT}/home/darwin/lmstudio/config/awake.sh\"]" ]
	[ "$(field "$a" lmstudio-awake ThrottleInterval)" = "30" ]
}

@test "services: dev alone on the mac has no LM Studio guard" {
	roles '"developer"'
	run --separate-stderr agents
	[ "$status" -eq 0 ]
	[ "$(field "$output" lmstudio-awake)" = "null" ]
	[ "$(field "$output" litellm-proxy Label)" = '"com.esh2n.litellm-proxy"' ]
}

@test "services: linux renders the same services as systemd user units; model-provider there is llama-server, never the LM Studio guard" {
	roles '"developer"'
	run --separate-stderr units
	[ "$status" -eq 0 ]
	[ "$output" = '["jig-decision","litellm-proxy","llm-ledger-sync"]' ]
	printf '{"roles": ["developer", "model-provider"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAA=", "acceptLicense": true}}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr units
	[ "$status" -eq 0 ]
	[ "$output" = '["jig-decision","litellm-proxy","llama-server","llm-ledger-sync"]' ]
}

setup_cmd() { # setup_cmd <darwin|linux>: the home-llm step's command, or null
	local cfg
	if [ "$1" = darwin ]; then cfg="darwinConfigurations.mac.config.home-manager.users.\"${USER}\""; else cfg="homeConfigurations.linux.config"; fi
	nix_eval_expr_json "let s = (builtins.getFlake \"git+file://${REPO_ROOT}\").${cfg}.dotfiles.setup.home-llm; in if s.enable then s.command else null"
}

@test "services: the home-LLM steps follow the roles: model-provider, observer; not at all without one" {
	roles '"developer", "model-provider", "observer"'
	run --separate-stderr setup_cmd darwin
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT} --lmstudio --console\"" ]]
	roles '"developer"'
	run --separate-stderr setup_cmd darwin
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT}\"" ]]
	roles '"developer", "model-provider"'
	run --separate-stderr setup_cmd linux
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT}\"" ]]
	roles ''
	run --separate-stderr setup_cmd darwin
	[ "$output" = null ]
}

gpu_linux() { # gpu_linux <attr under config>
	nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}\").homeConfigurations.linux.config.$1"
}

@test "services: model-provider runs llama-server on linux, bound to loopback, with the host's driver" {
	printf '{"roles": ["developer", "model-provider"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAA=", "acceptLicense": true}}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr gpu_linux 'systemd.user.services.llama-server.Service.ExecStart'
	[ "$status" -eq 0 ]
	[[ "$output" == *"${REPO_ROOT}/home/linux/llama-server/llama-server-up.sh"* ]]
	run --separate-stderr gpu_linux 'systemd.user.services.llama-server.Service.Environment'
	[[ "$output" == *"LLAMA_SERVER_BIN="*"llama-server"* ]]
	[[ "$output" == *"LLAMA_PORT=8080"* ]]
	run --separate-stderr gpu_linux 'targets.genericLinux.gpu.nvidia'
	[[ "$output" == *'"version":"580.82.09"'* ]]
	run --separate-stderr gpu_linux 'dotfiles.setup.home-llm.command'
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT} --gpu\"" ]]
}

@test "services: model-provider on linux without the host's driver in the roles file is an error that says what to add" {
	roles '"developer", "model-provider"'
	run --separate-stderr gpu_linux 'systemd.user.services.llama-server.Service.ExecStart'
	[ "$status" -ne 0 ]
	[[ "$stderr" == *"nvidia"* ]]
}

@test "services: model-provider on linux stops until the owner has accepted NVIDIA's license in the roles file" {
	printf '{"roles": ["developer", "model-provider"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAA="}}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr gpu_linux 'systemd.user.services.llama-server.Service.ExecStart'
	[ "$status" -ne 0 ]
	[[ "$stderr" == *"acceptLicense"* ]]
}

@test "services: no llama-server without model-provider, and never on the mac" {
	roles '"developer"'
	run --separate-stderr units
	[[ "$output" != *"llama-server"* ]]
	roles '"developer", "model-provider"'
	run --separate-stderr agents
	[ "$(field "$output" llama-server)" = "null" ]
}

@test "services: a developer machine that is not the observer ships its spend to the ledger; the ledger machine does not" {
	printf '{"roles": ["developer"], "observerHost": "mac.example.ts.net"}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr units
	[[ "$output" == *'"llm-ledger-sync"'* ]]
	run --separate-stderr gpu_linux 'systemd.user.services.llm-ledger-sync.Service.Environment'
	[[ "$output" == *"LEDGER_HOST=mac.example.ts.net"* ]]
	[[ "$output" == *"LEDGER_SQL=${REPO_ROOT}/home/shared/llm-ledger/ledger.sql"* ]]
	roles '"developer", "observer"'
	run --separate-stderr agents
	[ "$(field "$output" llm-ledger-sync)" = "null" ]
}

@test "services: LiteLLM is told where deterministic's llama-server and its Mac fallback are" {
	printf '{"roles": ["developer"], "llamaServerHost": "desktop.example.ts.net", "lmStudioHost": "mac.example.ts.net"}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr gpu_linux 'systemd.user.services.litellm-proxy.Service.Environment'
	[[ "$output" == *"LLAMA_SERVER_HOST=desktop.example.ts.net"* ]]
	[[ "$output" == *"LM_STUDIO_HOST=mac.example.ts.net"* ]]
	printf '{"roles": ["developer"]}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr gpu_linux 'systemd.user.services.litellm-proxy.Service.Environment'
	[[ "$output" != *"LLAMA_SERVER_HOST"* ]]
}
