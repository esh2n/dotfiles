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
	run --separate-stderr linux "config.home.packages"
	[ "$status" -eq 0 ]
	run --separate-stderr nix_eval_expr_json "map (p: p.name) (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").homeConfigurations.linux.config.home.packages"
	[ "$status" -eq 0 ]
	for name in mas nowplaying-cli cocoapods codebase-memory-mcp mise; do
		if [[ "$output" == *"\"${name}-"* ]]; then
			echo "found macOS-only or Omarchy-owned package: ${name}"
			false
		fi
	done
}
