#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The flake's own checks and formatter: `nix flake check --impure` builds
# each platform's configuration and this repo's packages (nix flake check
# does not build darwinConfigurations by itself), and `nix fmt` formats.

load '../lib/nix.bash'

F() { printf 'builtins.getFlake "git+file://%s"' "${REPO_ROOT}"; }

@test "flake: checks build each platform's configuration and the repo's packages" {
	run --separate-stderr nix_eval_expr_json "builtins.mapAttrs (_: builtins.attrNames) ($(F)).checks"
	[ "$status" -eq 0 ]
	[[ "$output" == *'"aarch64-darwin":['*'"dotctl"'*'"mac"'* ]]
	[[ "$output" == *'"x86_64-linux":['*'"dotctl"'*'"linux"'* ]]
}

@test "flake: nix fmt is nixfmt over the tree" {
	run --separate-stderr nix_eval_expr_json "($(F)).formatter.aarch64-darwin.pname"
	[ "$status" -eq 0 ]
	[ "$output" = '"nixfmt-tree"' ]
}
