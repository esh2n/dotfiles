#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Themes: home-manager declares one palette per theme
# (~/.config/theme/palettes/<name>/<file> -> the checkout's theme file);
# dotctl moves ~/.config/theme/current between them. A theme without a file
# for some app borrows its family's (catppuccin-latte -> catppuccin), so an
# app never reads a missing file.

load '../lib/nix.bash'

links() {
	nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}?dir=next\"; kind = \"darwin\"; config = \"mac\"; user = \"${USER}\"; }"
}

target() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "<missing>"))' "$2"; }

@test "theme: every theme gets a palette with each app's file" {
	run --separate-stderr links
	[ "$status" -eq 0 ]
	json="$output"
	for f in "${REPO_ROOT}"/next/home/shared/theme/themes/*.lua; do
		t="$(basename "$f" .lua)"
		for file in colors.lua ghostty tmux.conf sketchybar.lua borders.sh; do
			[ "$(target "$json" ".config/theme/palettes/${t}/${file}")" != "<missing>" ] || { echo "${t}/${file} missing"; false; }
		done
	done
}

@test "theme: a palette points at the theme's own files, or its family's when it has none" {
	run --separate-stderr links
	json="$output"
	[ "$(target "$json" .config/theme/palettes/nord/ghostty)" = "${REPO_ROOT}/next/home/darwin/ghostty/config/themes/nord" ]
	[ "$(target "$json" .config/theme/palettes/nord/colors.lua)" = "${REPO_ROOT}/next/home/shared/theme/themes/nord.lua" ]
	[ "$(target "$json" .config/theme/palettes/catppuccin-latte/colors.lua)" = "${REPO_ROOT}/next/home/shared/theme/themes/catppuccin-latte.lua" ]
	[ "$(target "$json" .config/theme/palettes/catppuccin-latte/ghostty)" = "${REPO_ROOT}/next/home/darwin/ghostty/config/themes/catppuccin" ]
	[ "$(target "$json" .config/theme/palettes/tokyonight-day/tmux.conf)" = "${REPO_ROOT}/next/home/darwin/tmux/config/themes/tokyonight.conf" ]
}

@test "theme: activation points the apps through the current theme" {
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.config.home-manager.users.\"${USER}\".dotfiles.setup.theme-init.command"
	[ "$status" -eq 0 ]
	[[ "$output" == *"dotctl theme --repo ${REPO_ROOT} init\"" ]]
}
