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

switch() { # switch <Darwin|Linux>
	local nix=(nix --extra-experimental-features 'nix-command flakes')
	case "$1" in
	Darwin)
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
	runtimes
}

main "$@"
