#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Files placed directly under ~ and commands placed in ~/bin: each is a
# symlink into the checkout (editable in place), exactly as manager.sh does,
# minus what only works on macOS on the Linux side.

load '../lib/nix.bash'

setup() {
	export DOTFILES_ROOT="${REPO_ROOT}"
}

links() { # links <darwin|linux>
	if [ "$1" = darwin ]; then
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}?dir=next\"; kind = \"darwin\"; config = \"mac\"; user = \"${USER}\"; }"
	else
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}?dir=next\"; kind = \"linux\"; config = \"linux\"; }"
	fi
}

target() { # target <json> <path under ~>
	printf '%s' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "<missing>"))' "$2"
}

@test "facts: the checkout is DOTFILES_ROOT" {
	run --separate-stderr nix_eval_expr_json "(import ${REPO_ROOT}/next/lib/facts.nix).repo"
	[ "$status" -eq 0 ]
	[ "$output" = "\"${REPO_ROOT}\"" ]
}

@test "links: shell and tool dotfiles under ~ point into the checkout on both platforms" {
	for kind in darwin linux; do
		run --separate-stderr links "$kind"
		[ "$status" -eq 0 ]
		json="$output"
		for f in .zshenv .zshrc .zprofile .tigrc .crit.config.json; do
			got="$(target "$json" "$f")"
			[ "$got" = "${REPO_ROOT}/domains/dev/home/${f}" ] || { echo "${kind} ${f}: ${got}"; false; }
		done
	done
}

# dotctl answers to these names now (next/pkgs/dotctl postInstall).
TAKEN_BY_DOTCTL=" code-graph-cache-gc nvim-switch theme-switch mado "

@test "links: every command in domains/*/bin is in ~/bin on the mac, unless dotctl took it over" {
	run --separate-stderr links darwin
	[ "$status" -eq 0 ]
	json="$output"
	for path in "${REPO_ROOT}"/domains/*/bin/*; do
		name="$(basename "$path")"
		[[ "${TAKEN_BY_DOTCTL}" == *" ${name} "* ]] && continue
		got="$(target "$json" "bin/${name}")"
		want="${path}"
		[ "$got" = "$want" ] || { echo "bin/${name}: ${got}"; false; }
	done
}

@test "links: macOS-only commands stay off ~/bin on linux, the rest are there" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	json="$output"
	for name in install-extensions theme-switch orca-theme-apply.py mado wallpaper; do
		[ "$(target "$json" "bin/${name}")" = "<missing>" ] || { echo "bin/${name} present on linux"; false; }
	done
	for name in artifact codebase-memory-mcp-managed gh-pr-graph-update git-credential-gh-owner jig setup-neovim-distros gh-switch; do
		[ "$(target "$json" "bin/${name}")" != "<missing>" ] || { echo "bin/${name} missing on linux"; false; }
	done
}

@test "links: commands dotctl took over are not linked from the old scripts" {
	for kind in darwin linux; do
		run --separate-stderr links "$kind"
		[ "$status" -eq 0 ]
		for name in code-graph-cache-gc nvim-switch theme-switch mado; do
			[ "$(target "$output" "bin/${name}")" = "<missing>" ] || { echo "${kind} bin/${name} still linked"; false; }
		done
	done
}
