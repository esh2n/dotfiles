# shellcheck shell=bash
# Helpers for tests that evaluate flakes. Evaluation only — nothing is built
# or activated, so a test can never change the machine it runs on.
#
# DOTFILES_NIX_STORE: when the Nix daemon is out of reach (an agent sandbox),
# point it at a writable directory and evaluation runs against a local store
# there. CI and a normal shell leave it unset and use the daemon.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Links point into the checkout under test (lib/facts.nix reads this) —
# always this checkout, whatever the calling shell exported.
export DOTFILES_ROOT="${REPO_ROOT}"
# No roles unless a test writes its own file: the machine's own roles file
# (~/.config/dotfiles/roles.json) must never decide what a test sees.
# A helper that re-sources this file in a child keeps the test's own setting
# with DOTFILES_TEST_KEEP_ROLES_FILE=1.
if [[ "${DOTFILES_TEST_KEEP_ROLES_FILE:-}" != 1 ]]; then
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR:-${BATS_RUN_TMPDIR:-/nonexistent}}/no-roles.json"
fi

nix_eval_expr_json() { # nix_eval_expr_json <nix expression>
	local -a store=()
	if [[ -n "${DOTFILES_NIX_STORE:-}" ]]; then
		store=(--store "${DOTFILES_NIX_STORE}")
	fi
	nix --extra-experimental-features 'nix-command flakes' eval \
		"${store[@]}" --impure --json --expr "$1"
}
