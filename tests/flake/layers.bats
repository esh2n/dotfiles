#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# Layer rules from plans/2026-09-24-dotfiles-architecture.md §2, checked on
# the source: references run top to bottom only.

ROOT="${BATS_TEST_DIRNAME}/../.."
# the flake's own modules (the harness and tests hold no Nix modules)
FLAKE=("${ROOT}/home" "${ROOT}/system" "${ROOT}/pkgs" "${ROOT}/overlays" "${ROOT}/lib" "${ROOT}/roles")

@test "layers: only roles/ reads or sets the roles; feature modules never know them" {
	run grep -rln --include='*.nix' 'dotfiles\.roles' "${ROOT}/home" "${ROOT}/system" "${ROOT}/pkgs" "${ROOT}/overlays"
	[ "$status" -eq 1 ]
}

@test "layers: no module reads osConfig (empty under standalone home-manager)" {
	run grep -rln --include='*.nix' 'osConfig' "${FLAKE[@]}"
	[ "$status" -eq 1 ]
}

@test "layers: nothing is keyed by hostname" {
	run grep -rlni --include='*.nix' -E 'hostname|networking\.hostName|computerName' "${FLAKE[@]}"
	[ "$status" -eq 1 ]
}
