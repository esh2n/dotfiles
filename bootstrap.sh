#!/usr/bin/env bash
# The one entry point for install and update alike (`make up`). Safe to run
# again at any time.
#
# Runs before Nix exists, so it is shell, and does only what needs no Nix:
# install Nix when missing, then hand the machine to `dotctl up` (the
# checkout's own CLI, pinned and built by this flake), which does the rest —
# the roles file check, Homebrew, the switch, the GPU drivers, the login
# shell and mise (pkgs/dotctl/internal/up).
set -euo pipefail

# Links point into this checkout, whichever one the caller's shell knows.
DOTFILES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DOTFILES_ROOT

case "$(uname -s)" in
Darwin | Linux) ;;
*)
	printf 'bootstrap: unsupported platform: %s (macOS and Linux only)\n' "$(uname -s)" >&2
	exit 1
	;;
esac

# The official multi-user installer on both platforms. Not Determinate's:
# since 2026 it installs Determinate Nix only, which nix-darwin must leave
# alone (nix.enable = false), and this flake has nix-darwin manage Nix.
if ! command -v nix >/dev/null 2>&1; then
	curl --proto '=https' --tlsv1.2 -sSf -L https://nixos.org/nix/install | sh -s -- --daemon
	printf 'bootstrap: Nix is installed. Open a new shell (so nix is on PATH) and run make up again.\n'
	exit 2
fi

exec nix --extra-experimental-features 'nix-command flakes' run "${DOTFILES_ROOT}#dotctl" -- up --repo "${DOTFILES_ROOT}"
