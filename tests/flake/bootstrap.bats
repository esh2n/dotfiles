#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# bootstrap.sh — the one entry point (`make up`): install Nix when
# missing, then hand over to `dotctl up` (whose steps are tested in Go,
# pkgs/dotctl/internal/up). External commands are recording stand-ins.

load ../lib/nix

BOOT="${BATS_TEST_DIRNAME}/../../bootstrap.sh"
NEXT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

setup() {
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "${BIN}"
	for name in nix curl; do
		printf '#!/usr/bin/env bash\necho "%s $* [root=${DOTFILES_ROOT:-}]" >>"%s"\n' "${name}" "${LOG}" >"${BIN}/${name}"
		chmod +x "${BIN}/${name}"
	done
}

os() { printf '#!/usr/bin/env bash\necho %s\n' "$1" >"${BIN}/uname"; chmod +x "${BIN}/uname"; }

boot() { PATH="${BIN}:/usr/bin:/bin" bash "${BOOT}" "$@"; }

@test "bootstrap: with nix, it hands this checkout to dotctl up" {
	for o in Darwin Linux; do
		os "$o"
		: >"${LOG}"
		run boot
		[ "$status" -eq 0 ]
		grep -qxF "nix --extra-experimental-features nix-command flakes run ${NEXT}#dotctl -- up --repo ${REPO_ROOT} [root=${REPO_ROOT}]" "${LOG}"
	done
}

@test "bootstrap: without nix it runs the official multi-user installer on either OS and asks for a new shell" {
	# Not Determinate's installer: since 2026 it installs Determinate Nix only,
	# which nix-darwin must not manage (nix.enable = false) — this flake does.
	for o in Darwin Linux; do
		os "$o"
		rm -f "${BIN}/nix" "${LOG}"
		run boot
		[ "$status" -eq 2 ]
		grep -q "^curl .*nixos.org/nix/install" "${LOG}"
		[[ "$output" == *"new shell"* ]]
	done
}

@test "bootstrap: an unknown platform is refused by name" {
	os FreeBSD
	run boot
	[ "$status" -eq 1 ]
	[[ "$output" == *"FreeBSD"* ]]
	[ ! -s "${LOG}" ]
}

@test "bootstrap: the flake pins dotctl and the home-manager dotctl runs on Linux" {
	run --separate-stderr nix_eval_expr_json "let f = builtins.getFlake \"git+file://${REPO_ROOT}\"; in [ f.packages.aarch64-darwin.dotctl.meta.mainProgram f.packages.x86_64-linux.dotctl.meta.mainProgram f.apps.x86_64-linux.home-manager.type ]"
	[ "$status" -eq 0 ]
	[ "$output" = '["dotctl","dotctl","app"]' ]
}

@test "bootstrap: nix-darwin backs up files in the way with the same extension" {
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}\").darwinConfigurations.mac.config.home-manager.backupFileExtension"
	[ "$status" -eq 0 ]
	[ "$output" = '"pre-dotfiles"' ]
}

@test "bootstrap: the taps dotctl up trusts, computed from the flake, are every tap the Mac uses" {
	# Homebrew follows the roles: with every role on, every tap is in use
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
	printf '{"roles": ["developer", "desk-user", "model-provider", "observer"]}\n' >"${DOTFILES_ROLES_FILE}"
	expr="$(python3 -c 'import re,sys; print(re.search(r"const tapsExpr = `(.*?)`", open(sys.argv[1]).read(), re.S).group(1))' "${REPO_ROOT}/pkgs/dotctl/internal/up/up.go")"
	local -a store=()
	[[ -n "${DOTFILES_NIX_STORE:-}" ]] && store=(--store "${DOTFILES_NIX_STORE}")
	run --separate-stderr nix --extra-experimental-features 'nix-command flakes' eval "${store[@]}" --impure --raw \
		"git+file://${REPO_ROOT}#darwinConfigurations.mac.config.homebrew" --apply "$expr"
	[ "$status" -eq 0 ]
	got="$(tr ' ' '\n' <<<"$output" | tr '[:upper:]' '[:lower:]' | sort | tr '\n' ' ')"
	# the list the old layout kept by hand (core/utils/homebrew.sh, removed)
	want="barutsrb/tap can1357/tap dlvhdr/formulae docker/tap fayazara/tap felixkratz/formulae k1low/tap karinushka/paneru nikitabobko/tap noborus/tap satococoa/tap stablyai/orca "
	[ "$got" = "$want" ] || { echo "got:  $got"; echo "want: $want"; false; }
}
