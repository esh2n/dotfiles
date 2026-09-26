#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# harness/bin/jig, the launcher ~/bin/jig links to: it hands bun jig's entry
# point in this checkout, however many links deep it is called.

ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"

@test "jig launcher: bun gets this checkout's harness/jig entry point, through links" {
	bin="${BATS_TEST_TMPDIR}/bin"
	mkdir -p "$bin"
	printf '#!/usr/bin/env bash\necho "$1"\n' >"${bin}/bun"
	chmod +x "${bin}/bun"
	ln -s "${ROOT}/harness/bin/jig" "${BATS_TEST_TMPDIR}/hop"
	ln -s "${BATS_TEST_TMPDIR}/hop" "${bin}/jig"
	run env PATH="${bin}:/usr/bin:/bin" jig version
	[ "$status" -eq 0 ]
	[ "$output" = "${ROOT}/harness/jig/src/cli/jig.ts" ]
	[ -f "$output" ]
}
