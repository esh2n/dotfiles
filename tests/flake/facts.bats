#!/usr/bin/env bats
# lib/facts.nix is the only impure read of the configuration. It reads the
# machine-local roles file (never committed) and rejects anything it does not
# understand, so a typo in that file fails loudly instead of silently dropping
# a role.

load '../lib/nix.bash'

setup() {
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
}

facts_roles() {
	nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).roles"
}

@test "facts: no roles file means no roles" {
	run facts_roles
	[ "$status" -eq 0 ]
	[ "$output" = "[]" ]
}

@test "facts: the roles written in the file are the roles" {
	printf '{"roles": ["developer", "model-provider"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -eq 0 ]
	[ "$output" = '["developer","model-provider"]' ]
}

@test "facts: an unknown role is rejected by name" {
	printf '{"roles": ["developer", "gpuu"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -ne 0 ]
	[[ "$output" == *'unknown role "gpuu"'* ]]
	printf '{"roles": ["llm-console"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -ne 0 ]
	[[ "$output" == *'the role "llm-console"'*'was renamed: use observer'* ]]
}

@test "facts: a file without a roles list is rejected" {
	printf '{"role": "developer"}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_roles
	[ "$status" -ne 0 ]
	[[ "$output" == *'"roles"'* ]]
}

facts_attr_without_home() { # facts_attr_without_home <attr>
	env -u HOME XDG_CACHE_HOME="${XDG_CACHE_HOME:-}" DOTFILES_NIX_STORE="${DOTFILES_NIX_STORE:-}" DOTFILES_TEST_KEEP_ROLES_FILE=1 \
		bash -c 'source "$1"; nix_eval_expr_json "(import $2/lib/facts.nix).$3"' _ \
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
	printf '{"roles": ["model-provider"]}\n' >"${DOTFILES_ROLES_FILE}"
	run facts_attr_without_home roles
	[ "$status" -eq 0 ]
	[ "$output" = '["model-provider"]' ]
}

facts_nvidia() { nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).nvidia"; }

@test "facts: the host's NVIDIA driver is read from the roles file, null when absent" {
	printf '{"roles": ["model-provider"]}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr facts_nvidia
	[ "$output" = null ]
	printf '{"roles": ["model-provider"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAA="}}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr facts_nvidia
	[ "$status" -eq 0 ]
	[ "$output" = '{"acceptLicense":false,"sha256":"sha256-AAAA=","version":"580.82.09"}' ]
}

@test "facts: an nvidia entry without both version and sha256 is rejected" {
	printf '{"roles": ["model-provider"], "nvidia": {"version": "580.82.09"}}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr facts_nvidia
	[ "$status" -ne 0 ]
	[[ "$stderr" == *"nvidia"*"sha256"* ]]
}

@test "facts: observerHost, the ledger machine's tailnet name, is read from the roles file" {
	printf '{"roles": ["developer"], "observerHost": "mac.example.ts.net"}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).observerHost"
	[ "$output" = '"mac.example.ts.net"' ]
	printf '{"roles": ["developer"]}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).observerHost"
	[ "$output" = null ]
	printf '{"roles": ["developer"], "observerHost": 5}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).observerHost"
	[ "$status" -ne 0 ]
}

@test "facts: llamaServerHost, where the deterministic tier's llama-server is, is read from the roles file" {
	printf '{"roles": ["developer"], "llamaServerHost": "desktop.example.ts.net"}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).llamaServerHost"
	[ "$output" = '"desktop.example.ts.net"' ]
	printf '{"roles": ["developer"]}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).llamaServerHost"
	[ "$output" = null ]
	printf '{"roles": ["developer"], "llamaServerHost": 5}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/lib/facts.nix).llamaServerHost"
	[ "$status" -ne 0 ]
}
