#!/usr/bin/env bats
# The new layout (next/) is grown beside the current one (core/nix) and may
# only replace it once it builds the very same system. These tests compare the
# derivation paths of both; equal paths mean equal systems, byte for byte.

load '../lib/nix.bash'

@test "next: the mac configuration builds the same system as the current one" {
	current="$(nix_eval_raw core/nix "darwinConfigurations.${USER}-mac.system.drvPath")"
	next="$(nix_eval_raw next "darwinConfigurations.mac.system.drvPath")"
	[ -n "$current" ]
	[ "$next" = "$current" ]
}
