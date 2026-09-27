#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Setup steps: what cannot be declared (a download into a mutable place, a
# tool's own registration command, a one-time seed). Each is declared once as
# dotfiles.setup.<name>, runs on activation after the links are in place, and
# a failing step warns without stopping the switch — the contract the old
# installer had.

load '../lib/nix.bash'

activation() { # activation <darwin|linux>: { name: { after, data } } for setup-* entries
	local cfg
	if [ "$1" = darwin ]; then
		cfg="darwinConfigurations.mac.config.home-manager.users.\"${USER}\""
	else
		cfg="homeConfigurations.linux.config"
	fi
	nix_eval_expr_json "let a = (builtins.getFlake \"git+file://${REPO_ROOT}\").${cfg}.home.activation; in builtins.mapAttrs (_: e: { inherit (e) after; data = e.data; }) (builtins.removeAttrs a (builtins.filter (n: builtins.substring 0 6 n != \"setup-\") (builtins.attrNames a)))"
}

field() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=d
for k in sys.argv[1:]: v=v.get(k) if isinstance(v, dict) else None
print(json.dumps(v))' "${@:2}"; }

@test "setup: every step runs after linkGeneration and only warns when it fails" {
	for kind in darwin linux; do
		run --separate-stderr activation "$kind"
		[ "$status" -eq 0 ]
		json="$output"
		names="$(printf '%s' "$json" | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')"
		[ -n "$names" ]
		for n in $names; do
			after="$(field "$json" "$n" after)"
			[[ "$after" == *'"linkGeneration"'* ]] || { echo "$kind $n after=$after"; false; }
			data="$(field "$json" "$n" data)"
			[[ "$data" == *"if ! (PATH="*" && run "* ]] || { echo "$kind $n: $data"; false; }
			[[ "$data" == *"warnEcho"* ]] || { echo "$kind $n: $data"; false; }
		done
	done
}

names() { printf '%s' "$1" | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))'; }

SHARED="setup-capsule-daemon setup-claude-cli setup-codebase-memory setup-gh-extensions setup-git-identity setup-git-lfs setup-mise-trust setup-nvim-default setup-pacifica setup-pi-packages setup-theme-init setup-userstyles setup-zellij-plugins"

@test "setup: the mac runs every ported step, plus its own" {
	run --separate-stderr activation darwin
	[ "$status" -eq 0 ]
	expected="$(printf '%s\n' ${SHARED} setup-orbstack setup-sbarlua setup-warp-seed | sort | tr '\n' ' ' | sed 's/ $//')"
	[ "$(names "$output")" = "$expected" ] || { echo "got: $(names "$output")"; false; }
}

@test "setup: linux runs the shared steps and Omarchy's bar, themes and Rise (warp and SbarLua are mac-only)" {
	run --separate-stderr activation linux
	[ "$status" -eq 0 ]
	expected="$(printf '%s\n' ${SHARED} setup-omarchy-bar setup-omarchy-themes setup-quickshell-rise | sort | tr '\n' ' ' | sed 's/ $//')"
	[ "$(names "$output")" = "$expected" ] || { echo "got: $(names "$output")"; false; }
}

@test "setup: the mac's userstyles and SbarLua are dotctl setup steps" {
	run --separate-stderr activation darwin
	[[ "$(field "$output" setup-userstyles data)" == *"dotctl setup --repo ${REPO_ROOT} userstyles"* ]]
	[[ "$(field "$output" setup-sbarlua data)" == *"dotctl setup --repo ${REPO_ROOT} sbarlua"* ]]
}

@test "setup: steps see the user's tools (profiles, mise, cargo, Homebrew, the system), not only activation's PATH" {
	run --separate-stderr activation darwin
	data="$(field "$output" setup-git-lfs data)"
	[[ "$data" == *"/etc/profiles/per-user/${USER}/bin"* ]]
	[[ "$data" == *"/.local/share/mise/shims"* ]]
	[[ "$data" == *"/.cargo/bin"* ]]
	[[ "$data" == *"/opt/homebrew/bin"* ]]
	[[ "$data" == *":/usr/bin:/bin:"* ]]
}

@test "setup: jig setup also sees the user's tools (bun from mise, codex, pnpm)" {
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}\").darwinConfigurations.mac.config.home-manager.users.\"${USER}\".home.activation.harnessApply.data"
	[[ "$output" == *"/.local/share/mise/shims"* ]]
	[[ "$output" == *"harness/bin/jig"*" setup"* ]]
}
