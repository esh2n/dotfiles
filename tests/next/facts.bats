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

facts_attr_without_home() { # facts_attr_without_home <attr>
	env -u HOME XDG_CACHE_HOME="${XDG_CACHE_HOME:-}" DOTFILES_NIX_STORE="${DOTFILES_NIX_STORE:-}" DOTFILES_TEST_KEEP_ROLES_FILE=1 \
		bash -c 'source "$1"; nix_eval_expr_json "(import $2/next/lib/facts.nix).$3"' _ \
		"${BATS_TEST_DIRNAME}/../lib/nix.bash" "${REPO_ROOT}" "$1"
}

@test "facts: without HOME, home fails loudly instead of becoming null" {
	run facts_attr_without_home home
	[ "$status" -ne 0 ]
	[[ "$output" == *'HOME is not set'* ]]
}

@test "facts: without HOME and no DOTFILES_ROLES_FILE, roles fail loudly instead of silently being empty" {
	unset DOTFILES_ROLES_FILE
	run facts_attr_without_home roles
	[ "$status" -ne 0 ]
	[[ "$output" == *'HOME is not set'* ]]
}

@test "facts: without HOME, an explicit DOTFILES_ROLES_FILE still works" {
	printf '{"roles": ["gpu"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_attr_without_home roles
	[ "$status" -eq 0 ]
	[ "$output" = '["gpu"]' ]
}
