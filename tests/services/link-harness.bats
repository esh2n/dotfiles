#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# sbx kits' link-harness.sh: inside a fresh sandbox, pi and dsh get their
# config linked from the mounted checkout, then jig apply (skipped here: no
# bun on PATH).

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
}

lh() { PATH="/usr/bin:/bin" bash "${SCRIPT}" "$@"; }

@test "link-harness pi: links settings, models, extensions and themes file by file" {
	run lh pi "${ROOT}"
	[ "$status" -eq 0 ]
	[ "$(readlink "${HOME}/.pi/agent/settings.json")" = "${C}/pi/settings.json" ]
	[ "$(readlink "${HOME}/.pi/agent/extensions/guard.ts")" = "${C}/pi/extensions/guard.ts" ]
	[ "$(readlink "${HOME}/.pi/agent/themes/nord.json")" = "${C}/pi/themes/nord.json" ]
	[[ "$output" == *"jig apply skipped"* ]]
}

@test "link-harness dsh: settings linked, hooks and profile patches expanded" {
	run lh dsh "${ROOT}"
	[ "$status" -eq 0 ]
	[ "$(readlink "${HOME}/.dsh/settings.yaml")" = "${C}/dsh/settings.yaml" ]
	[ "$(cat "${HOME}/.dsh/hooks.claude.json")" = "cmd: ${ROOT}/x ${HOME}" ]
	[ "$(cat "${HOME}/.dsh/profiles/proxy/cordis.patch.yml")" = "root: ${ROOT}" ]
}

@test "link-harness: an unknown harness is refused" {
	run lh codex "${ROOT}"
	[ "$status" -eq 2 ]
}
