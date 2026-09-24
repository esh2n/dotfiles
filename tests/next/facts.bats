#!/usr/bin/env bats
# next/lib/facts.nix is the only impure read of the configuration. It reads the
# machine-local roles file (never committed) and rejects anything it does not
# understand, so a typo in that file fails loudly instead of silently dropping
# a role.

load '../lib/nix.bash'

setup() {
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
}

facts_roles() {
	nix_eval_expr_json "(import ${REPO_ROOT}/next/lib/facts.nix).roles"
}

@test "facts: no roles file means no roles" {
	run facts_roles
	[ "$status" -eq 0 ]
	[ "$output" = "[]" ]
}

@test "facts: the roles written in the file are the roles" {
	printf '{"roles": ["dev", "llm-hub"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -eq 0 ]
	[ "$output" = '["dev","llm-hub"]' ]
}

@test "facts: an unknown role is rejected by name" {
	printf '{"roles": ["dev", "gpuu"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -ne 0 ]
	[[ "$output" == *'unknown role "gpuu"'* ]]
}

@test "facts: a file without a roles list is rejected" {
	printf '{"role": "dev"}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -ne 0 ]
	[[ "$output" == *'"roles"'* ]]
}
