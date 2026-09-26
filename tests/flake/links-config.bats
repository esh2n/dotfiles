#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# App config directories placed under ~/.config as links into the checkout.
# Oracle for the Mac: every home/<os>/<app>/config is ~/.config/<app>, and
# every domains/*/config/<name> still in the old place goes to
# ~/.config/<name> — minus what is handled elsewhere (jig-owned harness dirs
# and dirs placed outside ~/.config). Linux gets the cross-platform ones only;
# ~/.config/git/config is left to Omarchy. Ghostty is linked file by file:
# the shared config, then each OS's platform part.

load '../lib/nix.bash'

HANDLED_ELSEWHERE=" claude codex pi omp dsh jig claude-profiles mise serena starship vscode zellij warp orca cursor "

links() { # links <darwin|linux>
	if [ "$1" = darwin ]; then
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}\"; kind = \"darwin\"; config = \"mac\"; user = \"${USER}\"; }"
	else
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}\"; kind = \"linux\"; config = \"linux\"; }"
	fi
}

target() { # target <json> <path under ~>
	printf '%s' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "<missing>"))' "$2"
}

@test "config links: every plain config dir is linked under ~/.config on the mac" {
	run --separate-stderr links darwin
	[ "$status" -eq 0 ]
	json="$output"
	for d in lazyvim nvchad astrovim custom; do
		[ "$(target "$json" ".config/nvim-${d}")" = "${REPO_ROOT}/home/shared/nvim/${d}" ] || { echo ".config/nvim-${d}"; false; }
	done
	# every app's home/<os>/<app>/config is ~/.config/<app>
	for dir in "${REPO_ROOT}"/home/*/*/config/; do
		[ -d "$dir" ] || continue
		name="$(basename "$(dirname "$dir")")"
		# placed in ~ itself, not ~/.config (links-special.bats)
		[[ " warp orca serena " == *" ${name} "* ]] && continue
		got="$(target "$json" ".config/${name}")"
		[ "$got" = "${dir%/}" ] || { echo ".config/${name}: ${got}"; false; }
	done
	[ "$(target "$json" .config/ghostty/config)" = "${REPO_ROOT}/home/shared/ghostty/config" ]
	[ "$(target "$json" .config/ghostty/shaders)" = "${REPO_ROOT}/home/shared/ghostty/shaders" ]
	[ "$(target "$json" .config/ghostty/platform)" = "${REPO_ROOT}/home/darwin/ghostty/platform" ]
	[ "$(target "$json" .config/ghostty/theme)" = "${REPO_ROOT}/home/darwin/ghostty/theme" ]
}

@test "config links: linux gets the cross-platform dirs and none of Omarchy's own" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	json="$output"
	for d in lazyvim nvchad astrovim custom; do
		[ "$(target "$json" ".config/nvim-${d}")" = "${REPO_ROOT}/home/shared/nvim/${d}" ] || { echo ".config/nvim-${d}"; false; }
	done
	for name in jj zed wezterm capsule themes litellm tailscale sbx herdr; do
		got="$(target "$json" ".config/${name}")"
		[[ "$got" == "${REPO_ROOT}/domains/"*"/config/${name}" || "$got" == "${REPO_ROOT}/home/shared/${name}/config" || "$got" == "${REPO_ROOT}/home/shared/theme/${name}" ]] || { echo ".config/${name}: ${got}"; false; }
	done
	[ "$(target "$json" .config/ghostty/config)" = "${REPO_ROOT}/home/shared/ghostty/config" ]
	[ "$(target "$json" .config/ghostty/platform)" = "${REPO_ROOT}/home/linux/ghostty/platform" ]
	# the colours are Omarchy's, included by the platform part
	[ "$(target "$json" .config/ghostty/theme)" = "<missing>" ]
	for name in ghostty git aerospace sketchybar borders hammerspoon mado omniwm paneru lmstudio browsers; do
		[ "$(target "$json" ".config/${name}")" = "<missing>" ] || { echo ".config/${name} placed on linux"; false; }
	done
}

@test "config links: on linux git gets every file but config, which Omarchy owns" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	json="$output"
	[ "$(target "$json" ".config/git/config")" = "<missing>" ]
	# Tracked files only: the checkout also holds machine-generated ones.
	for name in $(git -C "${REPO_ROOT}" ls-files home/shared/git/config | xargs -n1 basename); do
		path="${REPO_ROOT}/home/shared/git/config/${name}"
		[ "$name" = config ] && continue
		got="$(target "$json" ".config/git/${name}")"
		[ "$got" = "$path" ] || { echo ".config/git/${name}: ${got}"; false; }
	done
}
