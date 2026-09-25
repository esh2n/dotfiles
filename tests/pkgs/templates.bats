#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# dotctl templates render: every *.template under the checkout becomes the file beside
# it, with {{HOME}}, {{USER}}, {{DOTFILES_ROOT}} replaced and
# {{CONDITIONAL_INCLUDES}} built from next/home/shared/git/config/conditional/*.conf
# (machine-local, untracked). The rendered files are working copies that
# theme-switch and the tools themselves write to, so they live in the checkout.

load '../lib/dotctl.bash'

setup_file() {
	build_dotctl "${BATS_FILE_TMPDIR}"
}

setup() {
	ROOT="${BATS_TEST_TMPDIR}/repo"
	mkdir -p "${ROOT}/domains/dev/config/app" "${ROOT}/domains/dev/home" "${ROOT}/next/home/shared/git/config/conditional"
}

render() {
	HOME=/home/tester USER=tester "${DOTCTL}" templates render --repo "${ROOT}"
}

@test "templates: placeholders are replaced and the output sits beside the template" {
	printf 'home={{HOME}} user={{USER}} root={{DOTFILES_ROOT}}\n' >"${ROOT}/domains/dev/config/app/conf.toml.template"
	run render
	[ "$status" -eq 0 ]
	[ "$(cat "${ROOT}/domains/dev/config/app/conf.toml")" = "home=/home/tester user=tester root=${ROOT}" ]
}

@test "templates: conditional includes come from the conf files, gitdir ones as includeIf" {
	printf '[user]\n{{CONDITIONAL_INCLUDES}}\n[core]\n' >"${ROOT}/domains/dev/home/.gitconfig.template"
	printf '# GITDIR: {{HOME}}/work/\n[user]\n  email = w@example.com\n' >"${ROOT}/next/home/shared/git/config/conditional/work.conf"
	printf '[user]\n  name = me\n' >"${ROOT}/next/home/shared/git/config/conditional/default.conf"
	run render
	[ "$status" -eq 0 ]
	expected='[user]
[include]
    path = ~/.config/git/conditional/default.conf
[includeIf "gitdir:/home/tester/work/"]
    path = ~/.config/git/conditional/work.conf

[core]'
	[ "$(cat "${ROOT}/domains/dev/home/.gitconfig")" = "$expected" ]
}

@test "templates: running twice gives the same files" {
	printf 'home={{HOME}}\n' >"${ROOT}/domains/dev/config/app/a.template"
	render
	first="$(cat "${ROOT}/domains/dev/config/app/a")"
	render
	[ "$(cat "${ROOT}/domains/dev/config/app/a")" = "$first" ]
}

@test "templates: templates under node_modules are not touched" {
	mkdir -p "${ROOT}/domains/dev/node_modules/x"
	printf '{{HOME}}\n' >"${ROOT}/domains/dev/node_modules/x/y.template"
	run render
	[ "$status" -eq 0 ]
	[ ! -e "${ROOT}/domains/dev/node_modules/x/y" ]
}

@test "templates: a missing checkout is an error, not a silent no-op" {
	run "${DOTCTL}" templates render --repo "${BATS_TEST_TMPDIR}/nowhere"
	[ "$status" -ne 0 ]
	[[ "$output" == *"nowhere"* ]]
}

@test "templates: the repo's real templates render exactly as manager.sh renders them" {
	repo="${BATS_TEST_DIRNAME}/../.."
	old="${BATS_TEST_TMPDIR}/old" new="${BATS_TEST_TMPDIR}/new"
	for dest in "$old" "$new"; do
		while IFS= read -r t; do
			mkdir -p "${dest}/$(dirname "$t")"
			cp "${repo}/${t}" "${dest}/${t}"
		done < <(git -C "$repo" ls-files '*.template')
		mkdir -p "${dest}/next/home/shared/git/config/conditional"
		printf '# GITDIR: {{HOME}}/work/\n[user]\n  email = w@example.com\n' >"${dest}/next/home/shared/git/config/conditional/work.conf"
		printf '[user]\n  name = me\n' >"${dest}/next/home/shared/git/config/conditional/default.conf"
	done
	# manager.sh's own renderer, pointed at the copy (its DOTFILES_ROOT).
	(
		cd "$old"
		HOME=/home/tester USER=tester bash -c '
			source "$1/core/utils/common.sh"
			scratch="$3"
			mktemp() { command mktemp "${scratch}/tmp.XXXXXX"; }
			eval "$(sed -n "/^generate_conditional_includes()/,/^}/p;/^process_template()/,/^}/p" "$1/core/config/manager.sh")"
			DOTFILES_ROOT="$2"
			log_info() { :; }; log_success() { :; }
			while IFS= read -r t; do process_template "$t"; done < <(find "$2" -name "*.template")
		' _ "$repo" "$old" "${BATS_TEST_TMPDIR}"
	)
	HOME=/home/tester USER=tester "${DOTCTL}" templates render --repo "$new"
	while IFS= read -r t; do
		out="${t%.template}"
		diff -u "${old}/${out}" "${new}/${out}"
	done < <(git -C "$repo" ls-files '*.template')
}
