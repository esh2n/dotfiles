#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# homeConfigurations.linux is standalone home-manager for the Omarchy machine.
# It must evaluate for x86_64-linux, take its home from facts (never a
# hard-coded /Users or /home path), and carry nothing that only makes sense on
# macOS or that Omarchy owns itself (mise is installed and updated by Omarchy).

load '../lib/nix.bash'

linux() { # linux <attribute path under the configuration>
	nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").homeConfigurations.linux.$1"
}

@test "linux: the configuration evaluates for x86_64-linux" {
	run --separate-stderr linux "activationPackage.system"
	[ "$status" -eq 0 ]
	[ "$output" = '"x86_64-linux"' ]
}

@test "linux: home comes from facts, not a hard-coded path" {
	run --separate-stderr linux "config.home.homeDirectory"
	[ "$status" -eq 0 ]
	[ "$output" = "\"${HOME}\"" ]
}

@test "linux: nothing macOS-only or Omarchy-owned is installed" {
	run --separate-stderr nix_eval_expr_json "let names = map (p: p.pname or (builtins.parseDrvName p.name).name) (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").homeConfigurations.linux.config.home.packages; in builtins.filter (n: builtins.elem n names) [ \"mas\" \"nowplaying-cli\" \"cocoapods\" \"mise\" ]"
	[ "$status" -eq 0 ]
	[ "$output" = "[]" ]
}

@test "linux: codebase-memory-mcp is installed with dev, since every harness is given it as an MCP server" {
	printf '{"roles": ["dev"]}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	run --separate-stderr nix_eval_expr_json "builtins.any (p: (p.pname or \"\") == \"codebase-memory-mcp\") (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").homeConfigurations.linux.config.home.packages"
	[ "$output" = true ]
}

@test "linux and mac: dev installs uv, which serena's MCP entry runs (uvx)" {
	printf '{"roles": ["dev"]}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	F="builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\""
	run --separate-stderr nix_eval_expr_json "let has = ps: builtins.any (p: (p.pname or \"\") == \"uv\") ps; in [ (has (${F}).homeConfigurations.linux.config.home.packages) (has (${F}).darwinConfigurations.mac.config.home-manager.users.\"${USER}\".home.packages) ]"
	[ "$output" = "[true,true]" ]
}
