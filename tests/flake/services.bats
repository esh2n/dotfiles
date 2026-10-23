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

@test "services: no roles, only the base role's task sync" {
	roles ''
	run --separate-stderr agents
	[ "$status" -eq 0 ]
	[ "$(printf '%s' "$output" | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')" = "task-sync" ]
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
	[ "$output" = '["jig-decision","litellm-proxy","llm-ledger-sync","task-sync"]' ]
	printf '{"roles": ["developer", "model-provider"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAA=", "acceptLicense": true}}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr units
	[ "$status" -eq 0 ]
	[ "$output" = '["jig-decision","litellm-proxy","llama-server","llm-ledger-sync","task-sync"]' ]
}

setup_cmd() { # setup_cmd <darwin|linux>: the home-llm step's command, or null
	local cfg
	if [ "$1" = darwin ]; then cfg="darwinConfigurations.mac.config.home-manager.users.\"${USER}\""; else cfg="homeConfigurations.linux.config"; fi
	nix_eval_expr_json "let s = (builtins.getFlake \"git+file://${REPO_ROOT}\").${cfg}.dotfiles.setup.home-llm; in if s.enable then s.command else null"
}

@test "services: the home-LLM steps follow the roles: model-provider, observer; not at all without one" {
	roles '"developer", "model-provider", "observer"'
	run --separate-stderr setup_cmd darwin
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT} --model-provider --observer\"" ]]
	roles '"developer"'
	run --separate-stderr setup_cmd darwin
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT}\"" ]]
	# on Linux model-provider also needs the host's driver (home/linux/llama-server)
	printf '{"roles": ["developer", "model-provider"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAA=", "acceptLicense": true}}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr setup_cmd linux
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT} --model-provider\"" ]]
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
	[[ "$output" == *"dotctl llm setup --repo ${REPO_ROOT} --model-provider\"" ]]
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

@test "services: LiteLLM is told where executor's llama-server and its Mac fallback are" {
	printf '{"roles": ["developer"], "linuxModelHost": "desktop.example.ts.net", "macModelHost": "mac.example.ts.net"}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr gpu_linux 'systemd.user.services.litellm-proxy.Service.Environment'
	[[ "$output" == *"LINUX_MODEL_HOST=desktop.example.ts.net"* ]]
	[[ "$output" == *"MAC_MODEL_HOST=mac.example.ts.net"* ]]
	printf '{"roles": ["developer"]}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr gpu_linux 'systemd.user.services.litellm-proxy.Service.Environment'
	[[ "$output" != *"LINUX_MODEL_HOST"* ]]
}

tasks_cfg() { # tasks_cfg: what the tasks module rendered on linux, as one JSON object
	nix_eval_expr_json "let c = (builtins.getFlake \"git+file://${REPO_ROOT}\").homeConfigurations.linux.config; u = c.systemd.user.services; in { taskrc = c.xdg.configFile.\"task/taskrc\".text; rc = c.xdg.configFile.\"task/machine.rc\".text; agent = c.xdg.configFile.\"task/agent-context\".text or null; sync = u.task-sync.Service.Environment; server = if u ? taskchampion-sync-server then u.taskchampion-sync-server.Service.Environment else null; }"
}

@test "services: the observer runs the tasks' sync server on loopback, syncs with it there, and alone makes recurring tasks" {
	printf '{"roles": ["developer", "observer"], "observerHost": "mac.example.ts.net"}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr tasks_cfg
	[ "$status" -eq 0 ]
	[ "$(field "$output" rc)" = '"recurrence=on\n"' ]
	[[ "$(field "$output" sync)" == *'"TASK_SYNC_URL=http://127.0.0.1:10222"'* ]]
	[[ "$(field "$output" server)" == *'"SYNC_LISTEN=127.0.0.1:10222"'* ]]
}

@test "services: another machine syncs its tasks with the observer over the tailnet, with recurrence off and no server" {
	printf '{"roles": ["developer"], "observerHost": "mac.example.ts.net"}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr tasks_cfg
	[ "$status" -eq 0 ]
	[ "$(field "$output" rc)" = '"recurrence=off\n"' ]
	# absolute includes: a relative one would resolve from the checkout, not ~/.config/task
	[ "$(field "$output" taskrc)" = "\"include ${REPO_ROOT}/home/shared/taskwarrior/taskrc\\ninclude ${HOME}/.config/task/machine.rc\\n\"" ]
	[[ "$(field "$output" sync)" == *'"TASK_SYNC_URL=https://mac.example.ts.net:10222"'* ]]
	[ "$(field "$output" server)" = null ]
	[ "$(field "$output" agent)" = null ]
	roles '"developer"'
	run --separate-stderr tasks_cfg
	[ "$status" -eq 0 ]
	[[ "$(field "$output" sync)" != *"TASK_SYNC_URL"* ]]
}

@test "services: a machine whose roles file names tasksAgentContext tells the agent that context alone" {
	printf '{"roles": ["developer"], "observerHost": "mac.example.ts.net", "tasksAgentContext": "work"}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr tasks_cfg
	[ "$status" -eq 0 ]
	[ "$(field "$output" agent)" = '"work\n"' ]
}
