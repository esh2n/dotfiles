#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# harness-apply <checkout>: what activation runs for the coding-agent harness
# once the links are in place — build the DSH plugin, install DSH's expanded
# copies into scaffolded profiles, then `jig apply --write` per harness and
# `jig codex register`. Missing tools are skipped with a warning, never fatal
# (the contract the old installer had too).

SCRIPT="${BATS_TEST_DIRNAME}/../../next/pkgs/scripts/harness-apply/harness-apply.sh"

setup() {
	ROOT="${BATS_TEST_TMPDIR}/repo"
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	export HOME="${BATS_TEST_TMPDIR}/home" DSH_HOME="${BATS_TEST_TMPDIR}/home/.dsh"
	mkdir -p "${ROOT}/harness/bin" "${ROOT}/next/home/shared/harness/dsh/profiles/proxy" \
		"${ROOT}/harness/jig/adapters/dsh/src" "${BIN}" "${HOME}"
	# jig launcher stand-in: records its arguments.
	printf '#!/usr/bin/env bash\necho "jig $*" >>"%s"\n' "${LOG}" >"${ROOT}/harness/bin/jig"
	touch "${ROOT}/harness/jig/adapters/dsh/src/index.ts"
	printf '{"root": "{{DOTFILES_ROOT}}", "home": "{{HOME}}"}\n' >"${ROOT}/next/home/shared/harness/dsh/hooks.claude.json"
	printf 'plugin: {{DOTFILES_ROOT}}\n' >"${ROOT}/next/home/shared/harness/dsh/profiles/proxy/cordis.patch.yml"
	for tool in bun pnpm codex; do
		printf '#!/usr/bin/env bash\necho "%s $* (in $PWD)" >>"%s"\n' "$tool" "${LOG}" >"${BIN}/${tool}"
		chmod +x "${BIN}/${tool}"
	done
}

apply() { PATH="${BIN}:/usr/bin:/bin" bash "${SCRIPT}" "${ROOT}"; }

@test "harness-apply: jig applies every harness, then registers codex" {
	run apply
	[ "$status" -eq 0 ]
	got="$(grep '^jig' "${LOG}")"
	expected='jig apply --target claude --write
jig apply --target codex --write
jig apply --target pi --write
jig apply --target omp --write
jig apply --target dsh --write
jig codex register --write'
	[ "$got" = "$expected" ]
}

@test "harness-apply: dsh gets its hooks file expanded, and scaffolded profiles their patch and the plugin" {
	mkdir -p "${DSH_HOME}/profiles/proxy"
	run apply
	[ "$status" -eq 0 ]
	[ "$(cat "${DSH_HOME}/hooks.claude.json")" = "{\"root\": \"${ROOT}\", \"home\": \"${HOME}\"}" ]
	[ "$(cat "${DSH_HOME}/profiles/proxy/cordis.patch.yml")" = "plugin: ${ROOT}" ]
	grep -q "^bun run build (in ${ROOT}/harness/jig/adapters/dsh)" "${LOG}"
	grep -q "^pnpm add link:${ROOT}/harness/jig/adapters/dsh (in ${DSH_HOME}/profiles/proxy)" "${LOG}"
}

@test "harness-apply: a profile not scaffolded on this machine is skipped" {
	run apply
	[ "$status" -eq 0 ]
	[ ! -e "${DSH_HOME}/profiles/proxy" ]
	! grep -q '^pnpm' "${LOG}"
}

@test "harness-apply: without bun, jig is skipped with a warning and activation continues" {
	rm "${BIN}/bun"
	run apply
	[ "$status" -eq 0 ]
	[[ "$output" == *"bun"* ]]
	! grep -q '^jig' "${LOG}"
}

@test "harness-apply: without codex, register is skipped" {
	rm "${BIN}/codex"
	run apply
	[ "$status" -eq 0 ]
	! grep -q '^jig codex register' "${LOG}"
	grep -q '^jig apply --target codex --write' "${LOG}"
}

@test "harness-apply: codex's config is seeded once from the default, before jig writes into it" {
	C="${ROOT}/next/home/shared/harness/codex"
	mkdir -p "$C"
	echo 'seed = true' >"${C}/config.toml.default"
	run apply
	[ "$status" -eq 0 ]
	[ "$(cat "${C}/config.toml")" = 'seed = true' ]
	echo 'trusted = "machine-local"' >"${C}/config.toml"
	run apply
	[ "$(cat "${C}/config.toml")" = 'trusted = "machine-local"' ]
}
