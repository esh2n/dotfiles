#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# The keys of the Herdr app's prefix mod, and the keys.json that opens it.

REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

@test "herdr prefix: keys resolve to bindings" {
	run node --test "${REPO_ROOT}/tests/repo/herdr-prefix.test.mjs"
	[ "$status" -eq 0 ]
}

@test "herdr prefix: keys.json opens the mod from a terminal and from the window" {
	run python3 -c '
import json, sys
k = json.load(open(sys.argv[1]))
assert k["global"]["ctrl-q"] == "mod.open:prefix"
assert k["terminal"]["ctrl-q"] == "mod.open:prefix"
assert k["mod:prefix"]["ctrl-q"] == "prefix.send-literal"
' "${REPO_ROOT}/home/darwin/herdr-app/keys.json"
	[ "$status" -eq 0 ]
	[ -f "${REPO_ROOT}/home/darwin/herdr-app/mods/prefix/mod.json" ]
}
