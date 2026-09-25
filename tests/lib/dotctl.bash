# shellcheck shell=bash
# dotctl built from this checkout, once per test file, for tests that drive
# its commands from the outside (as activation does). DOTCTL is its path.
# Go comes from PATH (with GOTOOLCHAIN, the go.mod's version is fetched when
# older); without Go, Nix builds the package.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

build_dotctl() { # build_dotctl <dir>: sets DOTCTL
	DOTCTL="$1/dotctl"
	if command -v go >/dev/null 2>&1; then
		(cd "${REPO_ROOT}/next/pkgs/dotctl" && go build -o "${DOTCTL}" ./cmd/dotctl)
	else
		local store=()
		[[ -n "${DOTFILES_NIX_STORE:-}" ]] && store=(--store "${DOTFILES_NIX_STORE}")
		ln -sf "$(nix --extra-experimental-features 'nix-command flakes' build "${store[@]}" --no-link --print-out-paths "path:${REPO_ROOT}/next#dotctl")/bin/dotctl" "${DOTCTL}"
	fi
	export DOTCTL
}
