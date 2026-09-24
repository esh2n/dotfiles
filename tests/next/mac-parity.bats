#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The next layout must configure the same Mac as the current one: the same
# packages, Homebrew lists, taps, App Store apps and system defaults.
# Compared as sets, so moving a module between files (and changing the order
# its packages are listed in) is allowed; changing what is installed is not.

load '../lib/nix.bash'

summary() { # summary <flake-dir> <config-name>
	nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/mac-summary.nix { flake = \"git+file://${REPO_ROOT}?dir=$1\"; config = \"$2\"; user = \"${USER}\"; }"
}

@test "mac parity: next installs and sets exactly what the current layout does" {
	run --separate-stderr summary core/nix "${USER}-mac"
	[ "$status" -eq 0 ]
	current="$output"
	run --separate-stderr summary next mac
	[ "$status" -eq 0 ]
	if [ "$output" != "$current" ]; then
		diff <(printf '%s' "$current" | tr ',' '\n') <(printf '%s' "$output" | tr ',' '\n') || true
		false
	fi
}
