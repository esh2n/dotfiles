#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The next layout must configure the same Mac as the current one: the same
# packages, Homebrew lists, taps, App Store apps and system defaults.
# Compared as sets, so moving a module between files (and changing the order
# its packages are listed in) is allowed; changing what is installed is not.

load '../lib/nix.bash'

# The Mac takes base, dev, desktop and llm-hub; the current layout has no
# roles and installs everything.
setup() {
	printf '{"roles": ["base", "dev", "desktop", "llm-hub"]}\n' >"${BATS_TEST_TMPDIR}/roles.json"
	export DOTFILES_ROLES_FILE="${BATS_TEST_TMPDIR}/roles.json"
}

summary() { # summary <flake-dir> <config-name>
	nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/mac-summary.nix { flake = \"git+file://${REPO_ROOT}?dir=$1\"; config = \"$2\"; user = \"${USER}\"; }"
}

# What next installs on purpose beyond the current layout, one package-name
# prefix each (the entries are "<name>-<version>").
ADDED_IN_NEXT='"dotctl-'

@test "mac parity: next installs and sets exactly what the current layout does, plus its own additions" {
	run --separate-stderr summary core/nix "${USER}-mac"
	[ "$status" -eq 0 ]
	current="$output"
	run --separate-stderr summary next mac
	[ "$status" -eq 0 ]
	output="$(printf '%s' "$output" | python3 -c '
import json, sys
prefixes = sys.argv[1].split()
def strip(v):
    if isinstance(v, dict): return {k: strip(x) for k, x in v.items()}
    if isinstance(v, list): return [strip(x) for x in v if not (isinstance(x, str) and any(json.dumps(x).startswith(p) for p in prefixes))]
    return v
print(json.dumps(strip(json.load(sys.stdin)), separators=(",", ":")))' "${ADDED_IN_NEXT}")"
	current="$(printf '%s' "$current" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), separators=(",", ":")))')"
	if [ "$output" != "$current" ]; then
		printf '%s' "$current" | tr ',' '\n' >"${BATS_TEST_TMPDIR}/current"
		printf '%s' "$output" | tr ',' '\n' >"${BATS_TEST_TMPDIR}/next"
		diff "${BATS_TEST_TMPDIR}/current" "${BATS_TEST_TMPDIR}/next" || true
		false
	fi
}
