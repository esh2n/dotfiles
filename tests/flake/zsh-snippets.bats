#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# zsh fragments live beside the module they belong to and reach
# ~/.config/zsh/conf.d only on the platforms that import that module — no
# fragment asks which OS it is on (home/shared/zsh's snippets).

load '../lib/nix.bash'

links() { # links <darwin|linux>
	if [ "$1" = darwin ]; then
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}\"; kind = \"darwin\"; config = \"mac\"; user = \"${USER}\"; }"
	else
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}\"; kind = \"linux\"; config = \"linux\"; }"
	fi
}

snippets() { # snippets <json>: the conf.d file names, sorted
	printf '%s' "$1" | python3 -c 'import json,sys; print(" ".join(sorted(k.split("/")[-1] for k in json.load(sys.stdin) if "/zsh/conf.d/" in k)))'
}

@test "zsh snippets: the mac gets its own and the shared ones" {
	run --separate-stderr links darwin
	[ "$status" -eq 0 ]
	[ "$(snippets "$output")" = "borders.zsh cursor.zsh litellm.zsh macos.zsh mado.zsh sketchybar.zsh" ]
}

@test "zsh snippets: linux gets its own and the shared ones, nothing of the mac's" {
	run --separate-stderr links linux
	[ "$status" -eq 0 ]
	[ "$(snippets "$output")" = "linux.zsh litellm.zsh" ]
}

@test "zsh snippets: the shared rc asks no fragment about macOS-only commands" {
	# what moved out: brew services, open -a, arch -x86_64, launchctl
	run grep -nE 'brew services|open -a|arch -x86_64|launchctl kickstart' \
		"${REPO_ROOT}/home/shared/zsh/rc/aliases.sh" "${REPO_ROOT}/home/shared/zsh/rc/aliases.zsh" "${REPO_ROOT}/home/shared/zsh/rc/functions.zsh"
	[ "$status" -eq 1 ]
}
