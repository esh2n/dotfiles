#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# App config directories placed under ~/.config as links into the checkout.
# Oracle for the Mac: manager.sh's rule — every domains/*/config/<name> goes to
# ~/.config/<name> — minus what is handled elsewhere (jig-owned harness dirs,
# the retired claude-profiles, templated dirs, and dirs placed outside
# ~/.config). Linux gets the cross-platform ones only; Omarchy's own paths
# (ghostty, tmux, herdr, ~/.config/git/config) are left to Omarchy.

load '../lib/nix.bash'

HANDLED_ELSEWHERE=" claude codex pi omp dsh jig claude-profiles mise serena starship vscode zellij warp orca cursor "

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

@test "config links: every plain config dir is linked under ~/.config on the mac" {
	run --separate-stderr links darwin
	[ "$status" -eq 0 ]
	json="$output"
	for dir in "${REPO_ROOT}"/domains/*/config/*/; do
		name="$(basename "$dir")"
		[[ "$HANDLED_ELSEWHERE" == *" ${name} "* ]] && continue
		got="$(target "$json" ".config/${name}")"
		[ "$got" = "${dir%/}" ] || { echo ".config/${name}: ${got}"; false; }
	done
	for d in lazyvim nvchad astrovim custom; do
		[ "$(target "$json" ".config/nvim-${d}")" = "${REPO_ROOT}/next/home/shared/nvim/${d}" ] || { echo ".config/nvim-${d}"; false; }
	done
	# moved apps: next/home/<os>/<app>/config is ~/.config/<app>
	for dir in "${REPO_ROOT}"/next/home/*/*/config/; do
		[ -d "$dir" ] || continue
		name="$(basename "$(dirname "$dir")")"
		got="$(target "$json" ".config/${name}")"
		[ "$got" = "${dir%/}" ] || { echo ".config/${name}: ${got}"; false; }
	done
}

@test "config links: linux gets the cross-platform dirs and none of Omarchy's own" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	json="$output"
	for d in lazyvim nvchad astrovim custom; do
		[ "$(target "$json" ".config/nvim-${d}")" = "${REPO_ROOT}/next/home/shared/nvim/${d}" ] || { echo ".config/nvim-${d}"; false; }
	done
	for name in jj zed wezterm capsule themes litellm tailscale sbx; do
		got="$(target "$json" ".config/${name}")"
		[[ "$got" == "${REPO_ROOT}/domains/"*"/config/${name}" || "$got" == "${REPO_ROOT}/next/home/shared/${name}/config" ]] || { echo ".config/${name}: ${got}"; false; }
	done
	for name in ghostty tmux herdr git aerospace sketchybar borders hammerspoon mado omniwm paneru lmstudio browsers; do
		[ "$(target "$json" ".config/${name}")" = "<missing>" ] || { echo ".config/${name} placed on linux"; false; }
	done
}

@test "config links: on linux git gets every file but config, which Omarchy owns" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	json="$output"
	[ "$(target "$json" ".config/git/config")" = "<missing>" ]
	# Tracked files only: the checkout also holds machine-generated ones.
	for name in $(git -C "${REPO_ROOT}" ls-files domains/dev/config/git | xargs -n1 basename); do
		path="${REPO_ROOT}/domains/dev/config/git/${name}"
		[ "$name" = config ] && continue
		got="$(target "$json" ".config/git/${name}")"
		[ "$got" = "$path" ] || { echo ".config/git/${name}: ${got}"; false; }
	done
}
