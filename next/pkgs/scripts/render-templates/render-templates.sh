#!/usr/bin/env bash
# render-templates <checkout>
#
# Renders every *.template in the checkout into the file beside it:
#   {{HOME}} {{USER}} {{DOTFILES_ROOT}}  the machine's values
#   {{CONDITIONAL_INCLUDES}}             git include / includeIf sections built
#                                        from domains/dev/config/git/conditional/*.conf
#                                        (machine-local, untracked; a conf file
#                                        whose first "# GITDIR: <dir>" line names a
#                                        directory becomes includeIf "gitdir:<dir>")
# The rendered files are working copies (theme-switch and the tools write to
# them), so they stay in the checkout, gitignored. Idempotent.
set -euo pipefail

root="${1:?usage: render-templates <checkout>}"
if [[ ! -d "${root}" ]]; then
	echo "render-templates: no checkout at ${root}" >&2
	exit 1
fi
root="$(cd "${root}" && pwd)"

conditional_includes() {
	local dir="${root}/domains/dev/config/git/conditional" conf name gitdir
	[[ -d "${dir}" ]] || return 0
	while IFS= read -r conf; do
		name="$(basename "${conf}")"
		gitdir="$(sed -n 's/^# GITDIR: *//p' "${conf}" | head -n 1)"
		gitdir="${gitdir//\{\{HOME\}\}/${HOME}}"
		if [[ -n "${gitdir}" ]]; then
			printf '[includeIf "gitdir:%s"]\n    path = ~/.config/git/conditional/%s\n' "${gitdir}" "${name}"
		else
			printf '[include]\n    path = ~/.config/git/conditional/%s\n' "${name}"
		fi
	done < <(find "${dir}" -maxdepth 1 -type f -name '*.conf' | LC_ALL=C sort)
}

render() { # render <template>
	local template="$1" output="${1%.template}" includes tmp has_conditional=0
	includes="$(conditional_includes)"
	# The include block is followed by one blank line whenever the conditional
	# directory exists (what the renderer this replaces produced).
	[[ -d "${root}/domains/dev/config/git/conditional" ]] && has_conditional=1
	tmp="$(mktemp "${output}.XXXXXX")"
	sed -e "s|{{HOME}}|${HOME}|g" \
		-e "s|{{USER}}|${USER}|g" \
		-e "s|{{DOTFILES_ROOT}}|${root}|g" \
		"${template}" |
		INCLUDES="${includes}" HAS_CONDITIONAL="${has_conditional}" awk '
			/\{\{CONDITIONAL_INCLUDES\}\}/ {
				if (ENVIRON["INCLUDES"] != "") print ENVIRON["INCLUDES"]
				if (ENVIRON["HAS_CONDITIONAL"] == "1") print ""
				next
			}
			{ print }
		' >"${tmp}"
	mv -f "${tmp}" "${output}"
}

while IFS= read -r template; do
	render "${template}"
done < <(find "${root}" -name node_modules -prune -o -name .git -prune -o -type f -name '*.template' -print)
