#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Packages this repo builds (next/pkgs) or overrides (next/overlays).
# Every one must build exactly what the current layout builds — same
# derivation, not only the same name, so a lost patch or pin is caught.

load '../lib/nix.bash'

# cargo-compete is compared separately below: the old overlay took openssl
# from `prev` without callPackage and so linked a different openssl than the
# rest of the system; next/pkgs uses callPackage and the system's openssl.
OWN=(codebase-memory-mcp)
OVERRIDDEN=(gh gotools)

drv() { # drv <flake-dir> <config-name> <package>
	nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=$1\").darwinConfigurations.\"$2\".pkgs.\"$3\".drvPath"
}

@test "pkgs: every package built or overridden here builds the same derivation as before" {
	for name in "${OWN[@]}" "${OVERRIDDEN[@]}"; do
		run --separate-stderr drv core/nix "${USER}-mac" "$name"
		[ "$status" -eq 0 ]
		current="$output"
		run --separate-stderr drv next mac "$name"
		[ "$status" -eq 0 ]
		if [ "$output" != "$current" ]; then
			echo "${name}: ${output} != ${current}"
			false
		fi
	done
}

@test "pkgs: the flake exposes its own packages per platform" {
	run --separate-stderr nix_eval_expr_json "builtins.attrNames (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").packages.aarch64-darwin"
	[ "$status" -eq 0 ]
	[ "$output" = '["cargo-compete","codebase-memory-mcp","dotctl","harness-apply"]' ]
}

@test "pkgs: linux gets the same packages, codebase-memory-mcp from its static linux build" {
	run --separate-stderr nix_eval_expr_json "builtins.attrNames (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").packages.x86_64-linux"
	[ "$status" -eq 0 ]
	[ "$output" = '["cargo-compete","codebase-memory-mcp","dotctl","harness-apply"]' ]
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").packages.x86_64-linux.codebase-memory-mcp.src.url"
	[[ "$output" == *"codebase-memory-mcp-linux-amd64-portable.tar.gz\"" ]]
}

@test "pkgs: cargo-compete links the same openssl as the rest of the system" {
	run --separate-stderr nix_eval_expr_json "let p = (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.pkgs; in builtins.elem p.openssl.dev.drvPath (map (d: d.drvPath) p.cargo-compete.buildInputs)"
	[ "$status" -eq 0 ]
	[ "$output" = "true" ]
}


@test "pkgs: dotctl is installed on both platforms" {
	run --separate-stderr nix_eval_expr_json "let f = builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\"; has = ps: builtins.any (p: (p.pname or \"\") == \"dotctl\") ps; in [ (has f.darwinConfigurations.mac.config.home-manager.users.\"${USER}\".home.packages) (has f.homeConfigurations.linux.config.home.packages) ]"
	[ "$status" -eq 0 ]
	[ "$output" = "[true,true]" ]
}

@test "pkgs: dotctl answers to the old command names it replaced" {
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").packages.aarch64-darwin.dotctl.postInstall"
	[ "$status" -eq 0 ]
	[[ "$output" == *"code-graph-cache-gc"* ]]
	[[ "$output" == *"nvim-switch"* ]]
	[[ "$output" == *"theme-switch"* ]]
	[[ "$output" == *"mado"* ]]
	for name in gh-switch gh-pr-graph-update setup-neovim-distros install-extensions wallpaper; do
		[[ "$output" == *"bin/${name}"* ]] || { echo "no ${name}"; false; }
	done
}
