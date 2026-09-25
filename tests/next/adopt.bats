#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# next/adopt-mac.sh: the owner's one line to move this Mac to next — the roles
# file, the ledger DB password in 1Password, main fast-forwarded to the work
# branch, then make up. Every outside command is a recording stand-in.

SCRIPT="${BATS_TEST_DIRNAME}/../../next/adopt-mac.sh"

setup() {
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	CHECKOUT="${BATS_TEST_TMPDIR}/dotfiles"
	mkdir -p "$BIN" "$CHECKOUT"
	export HOME="${BATS_TEST_TMPDIR}/home" LOG
	mkdir -p "$HOME"
	fake uname 'echo Darwin'
	fake op 'case "$1 $2" in "item get") exit "${OP_MISSING:-0}" ;; esac'
	fake git 'case "$*" in *"merge-base --is-ancestor"*) exit "${IN_MAIN:-1}" ;; *"rev-parse --abbrev-ref HEAD"*) echo main ;; esac'
	fake make
}

fake() {
	printf '#!/usr/bin/env bash\necho "%s $*" >>"$LOG"\n%s\n' "$1" "${2:-}" >"${BIN}/$1"
	chmod +x "${BIN}/$1"
}

adopt() { PATH="${BIN}:/usr/bin:/bin" DOTFILES_CHECKOUT="$CHECKOUT" bash "$SCRIPT" "$@"; }

@test "adopt: writes the Mac's roles file when there is none, and leaves one that exists" {
	run adopt
	[ "$status" -eq 0 ]
	[ "$(cat "$HOME/.config/dotfiles/roles.json")" = '{"roles": ["developer", "desk-user", "model-provider", "observer"]}' ]
	echo '{"roles": ["developer"]}' >"$HOME/.config/dotfiles/roles.json"
	run adopt
	[ "$(cat "$HOME/.config/dotfiles/roles.json")" = '{"roles": ["developer"]}' ]
}

@test "adopt: a roles file with the retired names is renamed in place" {
	mkdir -p "$HOME/.config/dotfiles"
	echo '{"roles": ["base", "dev", "desktop", "lmstudio", "llm-console"], "consoleHost": "m"}' >"$HOME/.config/dotfiles/roles.json"
	run adopt
	[ "$status" -eq 0 ]
	[ "$(cat "$HOME/.config/dotfiles/roles.json")" = '{"roles":["developer","desk-user","model-provider","observer"],"observerHost":"m"}' ]
	echo '{"roles": ["dev", "lmstudio", "gpu", "base"]}' >"$HOME/.config/dotfiles/roles.json"
	run adopt
	[ "$(cat "$HOME/.config/dotfiles/roles.json")" = '{"roles":["developer","model-provider"]}' ]
	echo '{"roles": ["base"]}' >"$HOME/.config/dotfiles/roles.json"
	run adopt
	[ "$(cat "$HOME/.config/dotfiles/roles.json")" = '{"roles":[]}' ]
	cp "$HOME/.config/dotfiles/roles.json" "${BATS_TEST_TMPDIR}/before"
	run adopt
	cmp "$HOME/.config/dotfiles/roles.json" "${BATS_TEST_TMPDIR}/before"
}

@test "adopt: creates the ledger password in 1Password only when missing, letters and digits" {
	export OP_MISSING=1
	run adopt
	grep -q "^op item create --vault llm-automation --category password --title litellm-db --generate-password=letters,digits,32" "$LOG"
	: >"$LOG"
	export OP_MISSING=0
	run adopt
	! grep -q "op item create" "$LOG"
}

@test "adopt: fast-forwards main to the work branch in the checkout, then runs make up there" {
	run adopt
	[ "$status" -eq 0 ]
	grep -q "^git -C ${CHECKOUT} merge --ff-only work-2026-09-23" "$LOG"
	grep -qx "make -C ${CHECKOUT} up" "$LOG"
	[ "$(grep -n 'merge --ff-only' "$LOG" | cut -d: -f1)" -lt "$(grep -n '^make' "$LOG" | cut -d: -f1)" ]
}

@test "adopt: a main that already has the work branch is not merged again" {
	export IN_MAIN=0
	run adopt
	! grep -q "merge --ff-only" "$LOG"
	grep -qx "make -C ${CHECKOUT} up" "$LOG"
}

@test "adopt: refuses to run anywhere but macOS" {
	fake uname 'echo Linux'
	run adopt
	[ "$status" -ne 0 ]
	! grep -q "^make\|^git" "$LOG"
}
