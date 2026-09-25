#!/usr/bin/env bash
# Try the Linux side of next/ for real, in a throwaway Arch Linux container:
# install Nix, write a roles file, run home-manager switch the way
# next/bootstrap.sh does, then check that links point into the checkout.
# Only the committed HEAD is tested (the container clones a git bundle).
#
#   bash tests/container/linux-switch.sh [roles-json]
#
# Needs docker (OrbStack is enough). Nothing on the host changes except the
# bundle in a temp dir; the container is removed at the end. The Mac side
# (nix-darwin) cannot run in a container.
set -euo pipefail

DEFAULT_ROLES='{"roles":["base","dev"]}'
ROLES="${1:-${DEFAULT_ROLES}}"
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
git -C "${REPO}" bundle create "${WORK}/repo.bundle" HEAD >/dev/null 2>&1

cat >"${WORK}/inside.sh" <<'INSIDE'
set -euo pipefail
pacman -Syu --noconfirm --needed git sudo xz curl zsh >/dev/null
useradd -m -s /bin/bash tester
cp /work/repo.bundle /home/tester/ && chown tester /home/tester/repo.bundle
sudo -iu tester env ROLES="${ROLES}" bash -euo pipefail <<'USER'
curl -sSfL https://nixos.org/nix/install | sh -s -- --no-daemon >/dev/null
. "${HOME}/.nix-profile/etc/profile.d/nix.sh"
git clone -q "${HOME}/repo.bundle" "${HOME}/dotfiles"
mkdir -p "${HOME}/.config/dotfiles"
printf '%s\n' "${ROLES}" >"${HOME}/.config/dotfiles/roles.json"
export DOTFILES_ROOT="${HOME}/dotfiles"
cd "${DOTFILES_ROOT}"
nix --extra-experimental-features 'nix-command flakes' run ./next#home-manager -- \
	switch --flake ./next#linux --impure -b pre-next
fail=0
for f in .zshrc .claude .config/codex .config/jig/policy; do
	t="$(readlink -f "${HOME}/${f}" || true)"
	case "${t}" in
	"${DOTFILES_ROOT}"/*) echo "ok   ${f} -> ${t}" ;;
	*) echo "FAIL ${f} -> ${t:-missing}"; fail=1 ;;
	esac
done
exit "${fail}"
USER
INSIDE

docker run --rm --platform linux/amd64 -e ROLES="${ROLES}" -v "${WORK}:/work:ro" \
	archlinux:latest bash -euo pipefail /work/inside.sh
echo "linux-switch: home-manager switch and links OK"
