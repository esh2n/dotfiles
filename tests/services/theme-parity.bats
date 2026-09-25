#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# `dotctl theme set` writes the same generated files the old theme-switch
# does: the shell environment (fzf/bat/ripgrep/statusline colours), delta's
# include, tmux-pane-border's colours and the four Neovim colorscheme files.
# Each runs in its own copy of the checkout and its own HOME; every app it
# would reload is a stand-in that does nothing.

REPO="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

setup_file() {
	command -v go >/dev/null 2>&1 || skip "go is not installed"
	export DOTCTL="${BATS_FILE_TMPDIR}/dotctl"
	(cd "${REPO}/next/pkgs/dotctl" && GOCACHE="${GOCACHE:-${BATS_FILE_TMPDIR}/gocache}" go build -o "${DOTCTL}" ./cmd/dotctl)
}

# world <dir>: a checkout copy with what theme switching reads, and a HOME
world() {
	local w="$1"
	mkdir -p "$w/repo/domains/dev/config" "$w/repo/domains/workspace/config" "$w/repo/core" "$w/home/.config/git" "$w/home/.config/tmux-pane-border" "$w/bin"
	cp -R "${REPO}/core/utils" "$w/repo/core/"
	cp -R "${REPO}/domains/system" "$w/repo/domains/"
	for d in nvim-lazyvim nvim-nvchad nvim-astrovim nvim-custom; do cp -R "${REPO}/domains/dev/config/$d" "$w/repo/domains/dev/config/"; done
	# apps already beside their modules: dotctl reads them there, the old
	# theme-switch at their old domains/ place, so both get a copy
	local app old
	for app in darwin/tmux:dev/config/tmux darwin/ghostty:dev/config/ghostty \
		darwin/sketchybar:workspace/config/sketchybar darwin/borders:workspace/config/borders; do
		old="${app#*:}" app="${app%%:*}"
		mkdir -p "$w/repo/next/home/${app}" "$w/repo/domains/${old}"
		cp -R "${REPO}/next/home/${app}/config" "$w/repo/next/home/${app}/"
		cp -R "${REPO}/next/home/${app}/config/." "$w/repo/domains/${old}/"
	done
	ln -s "$w/repo/next/home/darwin/tmux/config" "$w/home/.config/tmux"
	for t in tmux sketchybar borders pkill desktoppr pgrep; do printf '#!/bin/sh\nexit 1\n' >"$w/bin/$t"; chmod +x "$w/bin/$t"; done
}

old() { # old <world> <theme>
	HOME="$1/home" DOTFILES_ROOT="$1/repo" PATH="$1/bin:/usr/bin:/bin" bash "$1/repo/domains/system/bin/theme-switch" "$2" >/dev/null 2>&1
}

new() { # new <world> <theme>
	local w="$1" t
	for t in "$2" catppuccin; do
		mkdir -p "$w/home/.config/theme/palettes/$t"
	done
	HOME="$w/home" PATH="$w/bin:/usr/bin:/bin" "${DOTCTL}" theme --repo "$w/repo" init >/dev/null
	HOME="$w/home" PATH="$w/bin:/usr/bin:/bin" "${DOTCTL}" theme --repo "$w/repo" set "$2" >/dev/null
}

compare() { # compare <theme>
	local a="${BATS_TEST_TMPDIR}/old" b="${BATS_TEST_TMPDIR}/new" f
	world "$a"
	world "$b"
	old "$a" "$1" || true
	new "$b" "$1"
	for f in \
		repo/domains/system/config/theme-env/current.sh \
		repo/domains/system/config/theme-env/current.fish \
		repo/domains/system/config/theme-env/ripgreprc \
		home/.config/git/delta-theme.gitconfig \
		home/.config/tmux-pane-border/config.toml \
		repo/domains/dev/config/nvim-lazyvim/lua/plugins/colorscheme.lua \
		repo/domains/dev/config/nvim-nvchad/lua/chadrc.lua \
		repo/domains/dev/config/nvim-astrovim/lua/plugins/colorscheme.lua \
		repo/domains/dev/config/nvim-custom/lua/custom/colorscheme.lua; do
		[ -e "$a/$f" ] || { echo "old wrote no $f"; false; }
		diff -u "$a/$f" "$b/$f" || { echo "differs: $f"; false; }
	done
}

@test "theme parity: a dark theme" {
	compare nord
}

@test "theme parity: a light theme" {
	compare catppuccin-latte
}
