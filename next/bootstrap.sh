#!/usr/bin/env bash
# The one entry point for install and update alike (`make up`). Safe to run
# again at any time: every step either converges or is a no-op.
#
# Runs before Nix exists, so it is shell. It only installs Nix when missing,
# then hands the machine to the flake: nix-darwin on macOS, home-manager on
# Linux, both pinned by next/flake.lock. The platform decides which one —
# never the hostname or user name. `--impure` exists only for lib/facts.nix,
# which must see the user's own HOME and USER: everything is evaluated and
# built as the user, and only the macOS system activation runs as root.
set -euo pipefail

NEXT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Links point into this checkout, whichever one the caller's shell knows.
DOTFILES_ROOT="$(dirname "${NEXT}")"
export DOTFILES_ROOT

log() { printf 'bootstrap: %s\n' "$*"; }
warn() { printf 'bootstrap: %s\n' "$*" >&2; }

# The official multi-user installer on both platforms. Not Determinate's:
# since 2026 it installs Determinate Nix only, which nix-darwin must leave
# alone (nix.enable = false), and this flake has nix-darwin manage Nix.
install_nix() {
	curl --proto '=https' --tlsv1.2 -sSf -L https://nixos.org/nix/install | sh -s -- --daemon
	log "Nix is installed. Open a new shell (so nix is on PATH) and run make up again."
	exit 2
}

# nix-darwin drives Homebrew for casks, App Store apps and a few formulae,
# but does not install it.
install_homebrew() {
	command -v brew >/dev/null 2>&1 && return 0
	log "installing Homebrew"
	/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
	command -v brew >/dev/null 2>&1 && return 0
	local b
	for b in /opt/homebrew/bin /usr/local/bin; do
		if [[ -x "${b}/brew" ]]; then
			PATH="${b}:${PATH}"
			return 0
		fi
	done
	warn "Homebrew was installed but brew is not found; open a new shell and run make up again"
	exit 2
}

# Homebrew refuses formulae from third-party taps it has not been told to
# trust, and nix-darwin runs `brew bundle` with a scrubbed environment, so both
# config homes (with and without XDG_CONFIG_HOME) must hold the trust. The
# taps are the ones the flake declares, not a list kept by hand.
trust_taps() {
	local nix=(nix --extra-experimental-features 'nix-command flakes') taps
	brew trust --help >/dev/null 2>&1 || return 0
	# shellcheck disable=SC2016 # a Nix expression, not shell
	taps="$("${nix[@]}" eval --impure --raw "${NEXT}#darwinConfigurations.mac.config.homebrew" --apply '
		h: let
			tapOf = n: let p = builtins.filter builtins.isString (builtins.split "/" n); in
				if builtins.length p >= 3 then "${builtins.elemAt p 0}/${builtins.elemAt p 1}" else null;
			names = map (t: t.name) h.taps ++ builtins.filter (x: x != null) (map (x: tapOf x.name) (h.brews ++ h.casks));
			third = builtins.filter (n: builtins.substring 0 9 n != "homebrew/") names;
		in builtins.concatStringsSep " " (builtins.attrNames (builtins.listToAttrs (map (n: { name = n; value = null; }) third)))')"
	[[ -n "${taps}" ]] || return 0
	# shellcheck disable=SC2086 # one word per tap
	brew trust --tap ${taps} || warn "brew trust failed"
	# shellcheck disable=SC2086
	env -u XDG_CONFIG_HOME brew trust --tap ${taps} || warn "brew trust (without XDG_CONFIG_HOME) failed"
}

# On a Mac nix-darwin has never managed, /etc/bashrc and /etc/zshrc are plain
# files and activation refuses to replace them. Move them aside once; the
# links nix-darwin puts there later are left alone.
set_aside_etc() {
	local f
	for f in /etc/bashrc /etc/zshrc; do
		if [[ -f "${f}" && ! -L "${f}" && ! -e "${f}.before-nix-darwin" ]]; then
			sudo mv "${f}" "${f}.before-nix-darwin"
		fi
	done
}

# The login shell is zsh. chsh accepts only shells listed in /etc/shells, which
# on Linux only root may edit: then it says what to do instead of failing.
login_shell() {
	[[ "${SHELL:-}" == */zsh ]] && return 0
	local zsh
	zsh="$(command -v zsh || true)"
	[[ -n "${zsh}" ]] || return 0
	if grep -qx "${zsh}" /etc/shells 2>/dev/null; then
		chsh -s "${zsh}" || warn "chsh -s ${zsh} failed; the login shell is unchanged"
	else
		warn "${zsh} is not in /etc/shells; add it (sudo) and run: chsh -s ${zsh}"
	fi
}

switch() { # switch <Darwin|Linux>
	local nix=(nix --extra-experimental-features 'nix-command flakes')
	case "$1" in
	Darwin)
		install_homebrew
		trust_taps
		set_aside_etc
		# What `darwin-rebuild switch` does, split so that only the last two
		# steps are root's: darwin-rebuild resets HOME to root's when run
		# under sudo, and facts.nix would then read the wrong home.
		local system
		system="$("${nix[@]}" build --no-link --print-out-paths --impure "${NEXT}#darwinConfigurations.mac.system")"
		sudo -H "${system}/sw/bin/nix-env" -p /nix/var/nix/profiles/system --set "${system}"
		sudo -H "${system}/activate"
		;;
	Linux)
		"${nix[@]}" run "${NEXT}#home-manager" -- switch --flake "${NEXT}#linux" --impure -b pre-next
		;;
	esac
	# A first switch installs tools into profiles this shell has not got on
	# its PATH yet (a new login shell would).
	PATH="/etc/profiles/per-user/$(id -un)/bin:${HOME}/.nix-profile/bin:${PATH}"
}

# The flake is read through git: files under next/ that git does not know
# are invisible to it. Say so instead of switching to an older tree silently.
warn_untracked() {
	local untracked
	untracked="$(git -C "${NEXT}" ls-files --others --exclude-standard -- . 2>/dev/null || true)"
	if [[ -n "${untracked}" ]]; then
		warn "files under next/ that git does not track are ignored by the flake (git add them):"
		printf '  %s\n' "${untracked//$'\n'/$'\n  '}" >&2
	fi
}

runtimes() {
	if command -v mise >/dev/null 2>&1; then
		mise install
	else
		warn "mise is not on PATH; language runtimes were not installed"
	fi
}

main() {
	local os
	os="$(uname -s)"
	case "${os}" in
	Darwin | Linux) ;;
	*)
		warn "unsupported platform: ${os} (macOS and Linux only)"
		exit 1
		;;
	esac
	command -v nix >/dev/null 2>&1 || install_nix
	warn_untracked
	switch "${os}"
	login_shell
	runtimes
}

main "$@"
