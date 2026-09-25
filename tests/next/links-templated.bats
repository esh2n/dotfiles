#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Apps whose files are rendered from *.template: the directory (or file) is a
# link into the checkout, and activation renders the templates in the checkout
# first — the rendered files are working copies theme-switch and the tools
# write to, so they are not store files.

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

activation() { # activation <darwin|linux>
	if [ "$1" = darwin ]; then
		nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").darwinConfigurations.mac.config.home-manager.users.\"${USER}\".home.activation.renderTemplates.data"
	else
		nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\").homeConfigurations.linux.config.home.activation.renderTemplates.data"
	fi
}

@test "templated: mise, starship, zellij and ~/.gitconfig link into the checkout on both platforms" {
	for kind in darwin linux; do
		run --separate-stderr links "$kind"
		[ "$status" -eq 0 ]
		json="$output"
		for name in mise starship zellij; do
			got="$(target "$json" ".config/${name}")"
			[ "$got" = "${REPO_ROOT}/next/home/shared/${name}/config" ] || { echo "${kind} .config/${name}: ${got}"; false; }
		done
		got="$(target "$json" ".gitconfig")"
		[ "$got" = "${REPO_ROOT}/next/home/shared/git/gitconfig" ] || { echo "${kind} .gitconfig: ${got}"; false; }
	done
}

@test "templated: activation renders the templates in the checkout on both platforms" {
	for kind in darwin linux; do
		run --separate-stderr activation "$kind"
		[ "$status" -eq 0 ]
		[[ "$output" == *"/bin/dotctl templates render --repo"* ]] || { echo "${kind}: ${output}"; false; }
		[[ "$output" == *"${REPO_ROOT}"* ]] || { echo "${kind}: no checkout in ${output}"; false; }
	done
}
