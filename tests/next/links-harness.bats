#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The coding-agent harness: what jig and the harnesses read, linked into the
# checkout on both platforms (runtime state next to them stays untouched —
# pi and omp get their files one by one), and harness-apply on activation.

load '../lib/nix.bash'

links() { # links <darwin|linux>
	if [ "$1" = darwin ]; then
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}\"; kind = \"darwin\"; config = \"mac\"; user = \"${USER}\"; }"
	else
		nix_eval_expr_json "import ${REPO_ROOT}/tests/lib/links.nix { flake = \"git+file://${REPO_ROOT}\"; kind = \"linux\"; config = \"linux\"; }"
	fi
}

target() {
	printf '%s' "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], "<missing>"))' "$2"
}

@test "harness links: claude, codex, jig policy, pi, omp and dsh files point into the checkout" {
	C="${REPO_ROOT}/home/shared/harness"
	for kind in darwin linux; do
		run --separate-stderr links "$kind"
		[ "$status" -eq 0 ]
		json="$output"
		check() { [ "$(target "$json" "$1")" = "$2" ] || { echo "${kind} $1: $(target "$json" "$1")"; false; }; }
		check .claude "${C}/claude"
		check .config/codex "${C}/codex"
		check .config/jig/policy "${REPO_ROOT}/harness/policy"
		check .pi/agent/settings.json "${C}/pi/settings.json"
		check .pi/agent/models.json "${C}/pi/models.json"
		for ext in "${C}"/pi/extensions/*.ts; do check ".pi/agent/extensions/$(basename "$ext")" "$ext"; done
		check .pi/agent/themes/unkai.json "${C}/pi/themes/unkai.json"
		for f in config.yml models.yml lsp.yml; do check ".omp/agent/${f}" "${C}/omp/${f}"; done
		check .dsh/settings.yaml "${C}/dsh/settings.yaml"
		[ "$(target "$json" ".pi/agent/extensions/__tests__")" = "<missing>" ]
	done
}

@test "harness links: activation runs harness-apply on the checkout after the links are written" {
	run --separate-stderr nix_eval_expr_json "let a = (builtins.getFlake \"git+file://${REPO_ROOT}\").homeConfigurations.linux.config.home.activation.harnessApply; in { inherit (a) data after; }"
	[ "$status" -eq 0 ]
	[[ "$output" == *"/bin/harness-apply"* ]]
	[[ "$output" == *"${REPO_ROOT}"* ]]
	[[ "$output" == *'"linkGeneration"'* ]]
}
