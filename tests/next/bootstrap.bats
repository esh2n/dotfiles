#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# next/bootstrap.sh — the one entry point, install and update alike. Every
# external command is a stand-in that records how it was called, so these
# tests never touch the machine.

load ../lib/nix

BOOT="${BATS_TEST_DIRNAME}/../../next/bootstrap.sh"
NEXT="$(cd "${BATS_TEST_DIRNAME}/../../next" && pwd)"

setup() {
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	mkdir -p "${BIN}"
	stub mise curl brew chsh
	# Keep the real profiles off the PATH bootstrap extends after a switch.
	export HOME="${BATS_TEST_TMPDIR}/home"
	mkdir -p "${HOME}"
	printf '#!/usr/bin/env bash\necho bootstrap-test-user\n' >"${BIN}/id"
	chmod +x "${BIN}/id"
	SYS="${BATS_TEST_TMPDIR}/system"
	mkdir -p "${SYS}/sw/bin"
	printf '#!/usr/bin/env bash\necho "nix $* [root=${DOTFILES_ROOT:-}] [home=${HOME}]" >>"%s"\n[[ " $* " == *" build "* ]] && echo "%s"\n[[ " $* " == *" eval "* ]] && echo "felixkratz/formulae can1357/tap"\nexit "${NIX_EXIT:-0}"\n' "${LOG}" "${SYS}" >"${BIN}/nix"
	chmod +x "${BIN}/nix"
	printf '#!/usr/bin/env bash\necho "nix-env $*" >>"%s"\n' "${LOG}" >"${SYS}/sw/bin/nix-env"
	printf '#!/usr/bin/env bash\necho "activate" >>"%s"\n' "${LOG}" >"${SYS}/activate"
	chmod +x "${SYS}/sw/bin/nix-env" "${SYS}/activate"
	# sudo records itself, drops its options and runs the rest.
	printf '#!/usr/bin/env bash\necho "sudo $*" >>"%s"\nwhile [[ "$1" == -* ]]; do shift; done\n"$@"\n' "${LOG}" >"${BIN}/sudo"
	chmod +x "${BIN}/sudo"
}

stub() { # stub <name>...: a command that records its arguments and DOTFILES_ROOT
	for name in "$@"; do
		printf '#!/usr/bin/env bash\necho "%s $* [root=${DOTFILES_ROOT:-}]" >>"%s"\n' "${name}" "${LOG}" >"${BIN}/${name}"
		chmod +x "${BIN}/${name}"
	done
}

os() { printf '#!/usr/bin/env bash\necho %s\n' "$1" >"${BIN}/uname"; chmod +x "${BIN}/uname"; }

boot() { PATH="${BIN}:/usr/bin:/bin" bash "${BOOT}" "$@"; }

@test "bootstrap: on macOS it builds as the user, then only sets the profile and activates as root" {
	os Darwin
	run boot
	[ "$status" -eq 0 ]
	grep -qF "nix --extra-experimental-features nix-command flakes build --no-link --print-out-paths --impure ${NEXT}#darwinConfigurations.mac.system [root=${REPO_ROOT}] [home=${HOME}]" "${LOG}"
	! grep -q "^sudo .*nix " "${LOG}"
	grep -qx "sudo -H ${SYS}/sw/bin/nix-env -p /nix/var/nix/profiles/system --set ${SYS}" "${LOG}"
	grep -qx "sudo -H ${SYS}/activate" "${LOG}"
	[ "$(grep -n '^nix-env' "${LOG}" | cut -d: -f1)" -lt "$(grep -n '^activate' "${LOG}" | cut -d: -f1)" ]
}

@test "bootstrap: a failed build stops before anything runs as root" {
	os Darwin
	export NIX_EXIT=1
	run boot
	[ "$status" -ne 0 ]
	! grep -q "^sudo" "${LOG}"
	! grep -q "^mise" "${LOG}"
}

@test "bootstrap: on Linux it switches home-manager to next#linux as the user, backing up files in the way" {
	os Linux
	run boot
	[ "$status" -eq 0 ]
	grep -qF "nix --extra-experimental-features nix-command flakes run ${NEXT}#home-manager -- switch --flake ${NEXT}#linux --impure -b pre-next [root=${REPO_ROOT}]" "${LOG}"
	! grep -q "^sudo" "${LOG}"
}

@test "bootstrap: runtimes come from mise after the switch" {
	os Linux
	run boot
	[ "$status" -eq 0 ]
	[ "$(grep -n '^mise install' "${LOG}" | cut -d: -f1)" -gt "$(grep -n '^nix ' "${LOG}" | cut -d: -f1)" ]
}

@test "bootstrap: a missing mise is a warning, not a failure" {
	os Linux
	rm "${BIN}/mise"
	run --separate-stderr boot
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"mise"* ]]
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

@test "bootstrap: mise installed by the first switch is found without a new shell" {
	os Linux
	rm "${BIN}/mise"
	mkdir -p "${HOME}/.nix-profile/bin"
	printf '#!/usr/bin/env bash\necho "mise $*" >>"%s"\n' "${LOG}" >"${HOME}/.nix-profile/bin/mise"
	chmod +x "${HOME}/.nix-profile/bin/mise"
	run boot
	[ "$status" -eq 0 ]
	grep -q "^mise install" "${LOG}"
}

@test "bootstrap: files git does not track under next/ are named, since the flake cannot see them" {
	os Linux
	f="${NEXT}/untracked-bootstrap-probe.nix"
	touch "$f"
	run --separate-stderr boot
	rm -f "$f"
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"untracked-bootstrap-probe.nix"* ]]
}

@test "bootstrap: on macOS Homebrew is installed first when missing, never on Linux" {
	os Darwin
	rm "${BIN}/brew"
	# the "installer" the stub curl hands to bash puts a brew on PATH
	cat >"${BATS_TEST_TMPDIR}/brew-installer" <<-INSTALLER
		cp "${BIN}/chsh" "${BIN}/brew"
	INSTALLER
	printf '#!/usr/bin/env bash\necho "curl $*" >>"%s"\ncat "%s"\n' "${LOG}" "${BATS_TEST_TMPDIR}/brew-installer" >"${BIN}/curl"
	run boot
	[ "$status" -eq 0 ]
	grep -q "^curl .*Homebrew/install/HEAD/install.sh" "${LOG}"
	[ "$(grep -n '^curl .*Homebrew' "${LOG}" | cut -d: -f1)" -lt "$(grep -n '^nix .* build ' "${LOG}" | cut -d: -f1)" ]
	os Linux
	: >"${LOG}"
	run boot
	! grep -q "Homebrew" "${LOG}"
}

@test "bootstrap: third-party taps the flake names are trusted before activation, in both brew config homes" {
	os Darwin
	run boot
	[ "$status" -eq 0 ]
	grep -q "^nix .* eval .*${NEXT}#darwinConfigurations.mac.config.homebrew" "${LOG}"
	[ "$(grep -c '^brew trust --tap felixkratz/formulae can1357/tap' "${LOG}")" -eq 2 ]
	[ "$(grep -n '^brew trust --tap' "${LOG}" | head -1 | cut -d: -f1)" -lt "$(grep -n '^activate' "${LOG}" | cut -d: -f1)" ]
}

@test "bootstrap: the login shell becomes zsh when zsh is a listed shell" {
	os Darwin
	SHELL=/bin/bash run boot
	[ "$status" -eq 0 ]
	grep -q "^chsh -s /bin/zsh " "${LOG}"
	: >"${LOG}"
	SHELL=/bin/zsh run boot
	! grep -q "^chsh" "${LOG}"
}

@test "bootstrap: a zsh missing from /etc/shells is reported, not forced" {
	os Linux
	printf '#!/bin/sh\n' >"${BIN}/zsh"
	chmod +x "${BIN}/zsh"
	SHELL=/bin/bash run --separate-stderr boot
	[ "$status" -eq 0 ]
	! grep -q "^chsh" "${LOG}"
	[[ "$stderr" == *"/etc/shells"* ]]
}

@test "bootstrap: an unknown platform is refused by name" {
	os FreeBSD
	run boot
	[ "$status" -eq 1 ]
	[[ "$output" == *"FreeBSD"* ]]
	[ ! -s "${LOG}" ]
}

@test "bootstrap: the flake pins the home-manager it runs on Linux" {
	run --separate-stderr nix_eval_expr_json "let a = (builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").apps; in [ (builtins.attrNames a) a.x86_64-linux.home-manager.type (builtins.baseNameOf (builtins.unsafeDiscardStringContext a.x86_64-linux.home-manager.program)) ]"
	[ "$status" -eq 0 ]
	[ "$output" = '[["x86_64-linux"],"app","home-manager"]' ]
}

@test "bootstrap: nix-darwin backs up files in the way with the same extension" {
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.config.home-manager.backupFileExtension"
	[ "$status" -eq 0 ]
	[ "$output" = '"pre-next"' ]
}
