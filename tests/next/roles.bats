#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Roles are an interface: options.dotfiles.roles.<name>.enable, one namespace.
# Which of them are on comes from the machine-local roles file (via facts),
# injected as a module argument — never read from the environment by a module.

load '../lib/nix.bash'

setup() {
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	printf '{"roles": ["developer", "model-provider"]}\n' >"${DOTFILES_ROLES_FILE}"
}

role_enabled() { # role_enabled <role>
	nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.config.dotfiles.roles.\"$1\".enable"
}

@test "roles: a role named in the roles file is enabled on the mac" {
	run --separate-stderr role_enabled model-provider
	[ "$status" -eq 0 ]
	[ "$output" = "true" ]
}

@test "roles: a role not named in the roles file stays off" {
	run --separate-stderr role_enabled observer
	[ "$status" -eq 0 ]
	[ "$output" = "false" ]
}

@test "roles: with every role on, both platforms' configurations evaluate to a build" {
	printf '{"roles": ["developer", "desk-user", "model-provider", "observer"], "nvidia": {"version": "580.82.09", "sha256": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "acceptLicense": true}}\n' >"${DOTFILES_ROLES_FILE}"
	F="builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\""
	run --separate-stderr nix_eval_expr_json "[ (${F}).darwinConfigurations.mac.system.drvPath (${F}).homeConfigurations.linux.activationPackage.drvPath ]"
	[ "$status" -eq 0 ]
	[[ "$output" == *"darwin-system"*"home-manager-generation"* ]]
}

pkgnames() { # pkgnames <darwin|linux>: the names of home.packages
	local cfg
	if [ "$1" = darwin ]; then cfg="darwinConfigurations.mac.config.home-manager.users.\"${USER}\""; else cfg="homeConfigurations.linux.config"; fi
	nix_eval_expr_json "map (p: p.pname or p.name) (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").${cfg}.home.packages"
}

has() { printf '%s' "$1" | python3 -c 'import json,sys; sys.exit(0 if sys.argv[1] in json.load(sys.stdin) else 1)' "$2"; }

@test "roles: base is installed with no roles file at all" {
	rm -f "${DOTFILES_ROLES_FILE}"
	run --separate-stderr pkgnames linux
	[ "$status" -eq 0 ]
	has "$output" ripgrep
	has "$output" neovim
	! has "$output" gopls
	! has "$output" ffmpeg
}

@test "roles: developer adds the language tooling, desk-user the media tools and GUI apps" {
	printf '{"roles": ["developer"]}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr pkgnames linux
	has "$output" gopls
	has "$output" kubectl
	! has "$output" ffmpeg
	printf '{"roles": ["desk-user"]}\n' >"${DOTFILES_ROLES_FILE}"
	run --separate-stderr pkgnames darwin
	has "$output" ffmpeg
	has "$output" mas
	! has "$output" gopls
}
