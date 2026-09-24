# shellcheck shell=bash
# Helpers for tests that evaluate flakes. Evaluation only — nothing is built
# or activated, so a test can never change the machine it runs on.
#
# DOTFILES_NIX_STORE: when the Nix daemon is out of reach (an agent sandbox),
# point it at a writable directory and evaluation runs against a local store
# there. CI and a normal shell leave it unset and use the daemon.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Links point into the checkout under test (next/lib/facts.nix reads this) —
# always this checkout, whatever the calling shell exported.
export DOTFILES_ROOT="${REPO_ROOT}"

nix_eval_expr_json() { # nix_eval_expr_json <nix expression>
	local -a store=()
	if [[ -n "${DOTFILES_NIX_STORE:-}" ]]; then
		store=(--store "${DOTFILES_NIX_STORE}")
	fi
	nix --extra-experimental-features 'nix-command flakes' eval \
		"${store[@]}" --impure --json --expr "$1"
}
