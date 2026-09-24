#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Roles are an interface: options.dotfiles.roles.<name>.enable, one namespace.
# Which of them are on comes from the machine-local roles file (via facts),
# injected as a module argument — never read from the environment by a module.

load '../lib/nix.bash'

setup() {
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	printf '{"roles": ["dev", "llm-hub"]}\n' >"${DOTFILES_ROLES_FILE}"
}

role_enabled() { # role_enabled <role>
	nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.config.dotfiles.roles.\"$1\".enable"
}

@test "roles: a role named in the roles file is enabled on the mac" {
	run --separate-stderr role_enabled llm-hub
	[ "$status" -eq 0 ]
	[ "$output" = "true" ]
}

@test "roles: a role not named in the roles file stays off" {
	run --separate-stderr role_enabled gpu
	[ "$status" -eq 0 ]
	[ "$output" = "false" ]
}
