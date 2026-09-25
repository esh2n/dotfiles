#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Config dirs placed outside ~/.config, as manager.sh places them.

load '../lib/nix.bash'

links() { # links <darwin|linux>
	if [ "$1" = darwin ]; then
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}?dir=next\"; kind = \"darwin\"; config = \"mac\"; user = \"${USER}\"; }"
	else
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}?dir=next\"; kind = \"linux\"; config = \"linux\"; }"
	fi
}

target() {
	printf '%s' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "<missing>"))' "$2"
}

@test "special: serena goes to ~/.serena on both platforms" {
	for kind in darwin linux; do
		run --separate-stderr links "$kind"
		[ "$status" -eq 0 ]
		[ "$(target "$output" ".serena")" = "${REPO_ROOT}/domains/dev/config/serena" ]
	done
}

@test "special: warp, orca, vscode and cursor are placed where the Mac apps read them" {
	run --separate-stderr links darwin
	[ "$status" -eq 0 ]
	json="$output"
	[ "$(target "$json" ".warp")" = "${REPO_ROOT}/next/home/darwin/warp/config" ]
	[ "$(target "$json" ".orca")" = "${REPO_ROOT}/next/home/darwin/orca/config" ]
	[ "$(target "$json" ".config/vscode")" = "${REPO_ROOT}/next/home/darwin/vscode/config" ]
	[ "$(target "$json" ".config/cursor")" = "${REPO_ROOT}/next/home/darwin/cursor/config" ]
	[ "$(target "$json" "Library/Application Support/Code/User/settings.json")" = "${REPO_ROOT}/next/home/darwin/vscode/config/settings.json" ]
}

@test "special: none of the Mac apps' dirs are placed on linux" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	for path in .warp .orca .config/vscode .config/cursor; do
		[ "$(target "$output" "$path")" = "<missing>" ] || { echo "${path} placed on linux"; false; }
	done
}
