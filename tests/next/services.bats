#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Resident services: declared once (dotfiles.services.<name>), rendered as
# launchd agents on the Mac and systemd user services on Linux, switched on by
# roles. The Mac agents must match the plists they replace.

load '../lib/nix.bash'

roles() { printf '{"roles": [%s]}\n' "$1" >"${BATS_TEST_TMPDIR}/roles.json"; export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"; }

agents() {
	nix_eval_expr_json "let a = (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.config.home-manager.users.\"${USER}\".launchd.agents; in builtins.mapAttrs (_: v: v.config) (builtins.removeAttrs a (builtins.filter (n: !a.\${n}.enable) (builtins.attrNames a)))"
}

units() {
	nix_eval_expr_json "builtins.attrNames (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").homeConfigurations.linux.config.systemd.user.services"
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

@test "services: dev and llm-hub on the mac give the three agents the plists defined" {
	roles '"dev", "llm-hub"'
	run --separate-stderr agents
	[ "$status" -eq 0 ]
	a="$output"
	C="${REPO_ROOT}/domains/dev/config"
	[ "$(field "$a" litellm-proxy Label)" = '"com.esh2n.litellm-proxy"' ]
	[ "$(field "$a" litellm-proxy ProgramArguments)" = "[\"/bin/bash\", \"${C}/litellm/litellm-up.sh\"]" ]
	[ "$(field "$a" litellm-proxy ThrottleInterval)" = "120" ]
	[ "$(field "$a" litellm-proxy KeepAlive)" = "true" ]
	[ "$(field "$a" litellm-proxy RunAtLoad)" = "true" ]
	[ "$(field "$a" litellm-proxy ProcessType)" = '"Background"' ]
	[ "$(field "$a" litellm-proxy StandardOutPath)" = "\"${HOME}/Library/Logs/litellm-proxy.log\"" ]
	[ "$(field "$a" jig-decision ProgramArguments)" = "[\"/bin/bash\", \"${C}/jig/jig-decision-up.sh\"]" ]
	[ "$(field "$a" jig-decision EnvironmentVariables JIG_DIR)" = "\"${REPO_ROOT}/domains/dev/llm/harness/jig\"" ]
	[ "$(field "$a" jig-decision EnvironmentVariables JIG_DECISION_PORT)" = '"4100"' ]
	[ "$(field "$a" lmstudio-awake ProgramArguments)" = "[\"/bin/bash\", \"${C}/lmstudio/awake.sh\"]" ]
	[ "$(field "$a" lmstudio-awake ThrottleInterval)" = "30" ]
}

@test "services: dev alone on the mac has no LM Studio guard" {
	roles '"dev"'
	run --separate-stderr agents
	[ "$status" -eq 0 ]
	[ "$(field "$output" lmstudio-awake)" = "null" ]
	[ "$(field "$output" litellm-proxy Label)" = '"com.esh2n.litellm-proxy"' ]
}

@test "services: linux renders the same services as systemd user units, never the LM Studio guard" {
	roles '"dev", "llm-hub"'
	run --separate-stderr units
	[ "$status" -eq 0 ]
	[ "$output" = '["jig-decision","litellm-proxy"]' ]
}
