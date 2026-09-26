#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Browser extensions (macOS): Chrome and Dia force-install the extensions
# listed in home/darwin/browsers/config/extensions.json — declared by
# nix-darwin (system.defaults.CustomUserPreferences), not a script's
# `defaults write`.

load '../lib/nix.bash'

@test "browsers: Chrome and Dia force-install exactly the listed extensions" {
	want="$(python3 -c 'import json,sys; print(json.dumps([e["id"] for e in json.load(open(sys.argv[1]))["extensions"]], separators=(",", ":")))' "${REPO_ROOT}/home/darwin/browsers/config/extensions.json")"
	for app in com.google.Chrome company.thebrowser.dia; do
		run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}\").darwinConfigurations.mac.config.system.defaults.CustomUserPreferences.\"${app}\".ExtensionInstallForcelist"
		[ "$status" -eq 0 ]
		[ "$output" = "$want" ] || { echo "${app}: ${output}"; false; }
	done
}

@test "browsers: nothing in next runs the old system or workspace installers" {
	run grep -rn "domains/system/install.sh\|domains/workspace/install.sh" "${REPO_ROOT}/home" "${REPO_ROOT}/lib" "${REPO_ROOT}/system" "${REPO_ROOT}/pkgs"
	[ "$status" -eq 1 ]
}
