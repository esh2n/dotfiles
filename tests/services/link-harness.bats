#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# sbx kits' link-harness.sh: inside a fresh sandbox, pi and dsh get their
# config linked from the mounted checkout, then `jig setup --target <h>`
# (a stand-in launcher here; jig's own tests cover what setup does).

SCRIPT="${BATS_TEST_DIRNAME}/../../home/shared/sbx/config/kits/agents/link-harness.sh"

setup() {
	ROOT="${BATS_TEST_TMPDIR}/repo"
	export HOME="${BATS_TEST_TMPDIR}/home"
	C="${ROOT}/home/shared/harness"
	mkdir -p "${C}/pi/extensions" "${C}/pi/themes" "${C}/dsh/profiles/proxy" "${HOME}/.dsh/profiles/proxy"
	echo '{}' >"${C}/pi/settings.json"
	echo '{}' >"${C}/pi/models.json"
	echo 'x' >"${C}/pi/extensions/guard.ts"
	echo '{}' >"${C}/pi/themes/nord.json"
	echo 'a: 1' >"${C}/dsh/settings.yaml"
	echo 'cmd: {{DOTFILES_ROOT}}/x {{HOME}}' >"${C}/dsh/hooks.claude.json"
	echo 'root: {{DOTFILES_ROOT}}' >"${C}/dsh/profiles/proxy/cordis.patch.yml"
	LOG="${BATS_TEST_TMPDIR}/jig.log"
	BIN="${BATS_TEST_TMPDIR}/bin"
	mkdir -p "${ROOT}/harness/bin" "${BIN}"
	printf '#!/usr/bin/env bash\necho "jig $*" >>"%s"\n' "${LOG}" >"${ROOT}/harness/bin/jig"
	printf '#!/usr/bin/env bash\n' >"${BIN}/bun"
	chmod +x "${BIN}/bun"
}

lh() { PATH="/usr/bin:/bin" bash "${SCRIPT}" "$@"; }
lh_bun() { PATH="${BIN}:/usr/bin:/bin" bash "${SCRIPT}" "$@"; }

@test "link-harness pi: links settings, models, extensions and themes file by file" {
	run lh pi "${ROOT}"
	[ "$status" -eq 0 ]
	[ "$(readlink "${HOME}/.pi/agent/settings.json")" = "${C}/pi/settings.json" ]
	[ "$(readlink "${HOME}/.pi/agent/extensions/guard.ts")" = "${C}/pi/extensions/guard.ts" ]
	[ "$(readlink "${HOME}/.pi/agent/themes/nord.json")" = "${C}/pi/themes/nord.json" ]
	[[ "$output" == *"[WARN] bun is not on PATH; jig setup skipped"* ]]
}

@test "link-harness dsh: settings linked, then jig setup for dsh alone" {
	run lh_bun dsh "${ROOT}"
	[ "$status" -eq 0 ]
	[ "$(readlink "${HOME}/.dsh/settings.yaml")" = "${C}/dsh/settings.yaml" ]
	[ "$(cat "${LOG}")" = "jig setup --target dsh" ]
}

@test "link-harness: an unknown harness is refused" {
	run lh codex "${ROOT}"
	[ "$status" -eq 2 ]
}
