#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# zellij's pane bookmarks (Prefix + b) come from a pinned zellij-pane-picker,
# placed where config.kdl.template looks for it, on both platforms.

load '../lib/nix.bash'

@test "zellij: pane-picker is pinned under ~/.local/share on both platforms, where the binding looks" {
	run --separate-stderr nix_eval_expr_json "let f = builtins.getFlake \"git+file://${REPO_ROOT}?dir=next\"; k = \"zellij/plugins/zellij-pane-picker.wasm\"; in [ (f.darwinConfigurations.mac.config.home-manager.users.\"${USER}\".xdg.dataFile ? \${k}) (f.homeConfigurations.linux.config.xdg.dataFile ? \${k}) ]"
	[ "$status" -eq 0 ]
	[ "$output" = "[true,true]" ]
	grep -q 'LaunchOrFocusPlugin "file:~/.local/share/zellij/plugins/zellij-pane-picker.wasm"' "${REPO_ROOT}/domains/dev/config/zellij/config.kdl.template"
	! grep -q "harpoon" "${REPO_ROOT}/domains/dev/config/zellij/config.kdl.template"
}
