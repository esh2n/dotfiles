#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Layer rules from plans/2026-09-24-dotfiles-architecture.md §2, checked on
# the source: references run top to bottom only.

NEXT="${BATS_TEST_DIRNAME}/../../next"

@test "layers: only roles/ reads or sets the roles; feature modules never know them" {
	run grep -rln --include='*.nix' 'dotfiles\.roles' "${NEXT}/home" "${NEXT}/system" "${NEXT}/pkgs" "${NEXT}/overlays"
	[ "$status" -eq 1 ]
}

@test "layers: no module reads osConfig (empty under standalone home-manager)" {
	run grep -rln --include='*.nix' 'osConfig' "${NEXT}"
	[ "$status" -eq 1 ]
}

@test "layers: nothing is keyed by hostname" {
	run grep -rlni --include='*.nix' -E 'hostname|networking\.hostName|computerName' "${NEXT}"
	[ "$status" -eq 1 ]
}
