#!/usr/bin/env bash
# Move this Mac to the next layout, in one line; safe to run again:
#   1. the roles file (~/.config/dotfiles/roles.json), if there is none
#   2. the cost ledger's DB password in 1Password (letters and digits: it goes
#      into a URL), if there is none
#   3. main fast-forwarded to the work branch in the checkout
#   4. make up there
# The old `make update` keeps working until the old layout is removed.
set -euo pipefail

CHECKOUT="${DOTFILES_CHECKOUT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --path-format=absolute --git-common-dir | xargs dirname)}"
BRANCH="work-2026-09-23"
ROLES="${HOME}/.config/dotfiles/roles.json"

say() { printf 'adopt: %s\n' "$*"; }

if [[ "$(uname -s)" != Darwin ]]; then
	say "this is for the Mac (Omarchy gets its own roles file and make up)" >&2
	exit 1
fi

if [[ ! -f "${ROLES}" ]]; then
	mkdir -p "$(dirname "${ROLES}")"
	echo '{"roles": ["base", "dev", "desktop", "lmstudio", "llm-console"]}' >"${ROLES}"
	say "wrote ${ROLES}"
fi

# a Password item: its value is the "password" field
# (op://llm-automation/litellm-db/password, read by litellm-up.sh and the sync)
if ! op item get litellm-db --vault llm-automation >/dev/null 2>&1; then
	op item create --vault llm-automation --category password --title litellm-db \
		--generate-password=letters,digits,32 >/dev/null
	say "created litellm-db in 1Password (llm-automation)"
fi

if ! git -C "${CHECKOUT}" merge-base --is-ancestor "${BRANCH}" main; then
	[[ "$(git -C "${CHECKOUT}" rev-parse --abbrev-ref HEAD)" == main ]] ||
		{ say "the checkout ${CHECKOUT} is not on main; switch it to main first" >&2; exit 1; }
	git -C "${CHECKOUT}" merge --ff-only "${BRANCH}"
fi

make -C "${CHECKOUT}" up
