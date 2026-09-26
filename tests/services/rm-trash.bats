#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# rm, as the shell defines it (home/shared/zsh/rc/aliases.sh): rm's options
# are taken and dropped, the rest goes to the trash. A stand-in trash records
# what it was given.

ALIASES="${BATS_TEST_DIRNAME}/../../home/shared/zsh/rc/aliases.sh"

setup() {
	export DOTFILES_TRASH="${BATS_TEST_TMPDIR}/trash" LOG="${BATS_TEST_TMPDIR}/trash.log"
	printf '#!/usr/bin/env bash\nprintf "%%s|" "$@" >>"%s"\n' "${LOG}" >"${DOTFILES_TRASH}"
	chmod +x "${DOTFILES_TRASH}"
	cd "${BATS_TEST_TMPDIR}"
	mkdir dir && touch file "-name"
}

in_shell() { # in_shell <bash|zsh> <rm arguments...>
	local sh="$1"
	shift
	command -v "$sh" >/dev/null || skip "$sh is not installed"
	"$sh" -c 'source "$0"; rm "$@"' "${ALIASES}" "$@"
}

@test "rm: -rf and friends are dropped, the paths go to the trash" {
	for sh in bash zsh; do
		: >"${LOG}"
		run in_shell "$sh" -rf dir file
		[ "$status" -eq 0 ]
		[ "$(cat "${LOG}")" = "dir|file|" ]
		: >"${LOG}"
		run in_shell "$sh" -r -v --force dir
		[ "$(cat "${LOG}")" = "dir|" ]
	done
}

@test "rm: after --, a name that looks like an option is a path" {
	run in_shell bash -- -name
	[ "$status" -eq 0 ]
	[ "$(cat "${LOG}")" = "-name|" ]
}

@test "rm -f skips what does not exist; plain rm passes it on for the trash to refuse" {
	run in_shell bash -f missing file
	[ "$(cat "${LOG}")" = "file|" ]
	run in_shell bash -f missing
	[ "$status" -eq 0 ]
	: >"${LOG}"
	run in_shell bash missing
	[ "$(cat "${LOG}")" = "missing|" ]
}

@test "rm with nothing to remove says so, as rm does" {
	run --separate-stderr in_shell bash -r
	[ "$status" -eq 1 ]
	[[ "$stderr" == *"missing operand"* ]]
}
