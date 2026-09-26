#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Browser extensions: on macOS Chrome and Dia force-install the extensions
# listed in home/shared/browsers/config/extensions.json — declared by
# nix-darwin (system.defaults.CustomUserPreferences), not a script's
# `defaults write`; on Linux the same list is Chromium's external extensions.

load '../lib/nix.bash'

@test "browsers: Chrome and Dia force-install exactly the listed extensions" {
	want="$(python3 -c 'import json,sys; print(json.dumps([e["id"] for e in json.load(open(sys.argv[1]))["extensions"]], separators=(",", ":")))' "${REPO_ROOT}/home/shared/browsers/config/extensions.json")"
	for app in com.google.Chrome company.thebrowser.dia; do
		run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}\").darwinConfigurations.mac.config.system.defaults.CustomUserPreferences.\"${app}\".ExtensionInstallForcelist"
		[ "$status" -eq 0 ]
		[ "$output" = "$want" ] || { echo "${app}: ${output}"; false; }
	done
}

@test "browsers: Omarchy's Chromium gets the same list as external extensions" {
	list="${REPO_ROOT}/home/shared/browsers/config/extensions.json"
	want="$(python3 -c 'import json,sys; print(" ".join(sorted(e["id"] for e in json.load(open(sys.argv[1]))["extensions"])))' "${list}")"
	run --separate-stderr nix_eval_expr_json "builtins.attrNames (builtins.removeAttrs (builtins.getFlake \"git+file://${REPO_ROOT}\").homeConfigurations.linux.config.home.file [ ])"
	[ "$status" -eq 0 ]
	got="$(printf '%s' "$output" | python3 -c 'import json,sys,re; print(" ".join(sorted(m.group(1) for n in json.load(sys.stdin) if (m := re.search(r"/chromium/External Extensions/([a-p]{32})\.json$", n)))))')"
	[ "$got" = "$want" ] || { echo "got: ${got}"; false; }
	# the browser itself is Omarchy's
	run --separate-stderr nix_eval_expr_json "(builtins.getFlake \"git+file://${REPO_ROOT}\").homeConfigurations.linux.config.programs.chromium.finalPackage"
	[ "$output" = "null" ]
}

@test "browsers: nothing in next runs the old system or workspace installers" {
	run grep -rn "domains/system/install.sh\|domains/workspace/install.sh" "${REPO_ROOT}/home" "${REPO_ROOT}/lib" "${REPO_ROOT}/system" "${REPO_ROOT}/pkgs"
	[ "$status" -eq 1 ]
}
