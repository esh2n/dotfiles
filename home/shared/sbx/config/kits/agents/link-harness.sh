#!/usr/bin/env bash
# link-harness.sh <pi|dsh> <checkout>: inside a fresh sandbox, give one
# harness what home-manager and harness-apply give it on the host — its
# config linked from the mounted checkout, then `jig apply --target <h>`.
# Run by the pi and dsh kits' startup (spec.yaml.in); the sandbox's home is
# new, so nothing here backs up or sweeps old links.
set -euo pipefail

harness="${1:?usage: link-harness.sh <pi|dsh> <checkout>}"
root="${2:?usage: link-harness.sh <pi|dsh> <checkout>}"
cfg="${root}/home/shared/harness"
jig="${root}/harness/bin/jig"

say() { echo "link-harness ${harness}: $*" >&2; }
link() { mkdir -p "$(dirname "$2")" && ln -sfn "$1" "$2"; }
expand() { # expand <src> <dest>: a copy with {{HOME}} {{USER}} {{DOTFILES_ROOT}} filled in
	[[ -f "$1" ]] || return 0
	mkdir -p "$(dirname "$2")"
	rm -f "$2"
	sed -e "s|{{HOME}}|${HOME}|g" -e "s|{{USER}}|${USER:-}|g" -e "s|{{DOTFILES_ROOT}}|${root}|g" "$1" >"$2"
}

case "${harness}" in
pi)
	home="${HOME}/.pi/agent"
	for f in settings.json models.json; do
		[[ -f "${cfg}/pi/${f}" ]] && link "${cfg}/pi/${f}" "${home}/${f}"
	done
	# file by file: pi writes its own files beside them
	for f in "${cfg}"/pi/extensions/*.ts; do [[ -e "$f" ]] && link "$f" "${home}/extensions/$(basename "$f")"; done
	for f in "${cfg}"/pi/themes/*.json; do [[ -e "$f" ]] && link "$f" "${home}/themes/$(basename "$f")"; done
	;;
dsh)
	home="${DSH_HOME:-${HOME}/.dsh}"
	[[ -f "${cfg}/dsh/settings.yaml" ]] && link "${cfg}/dsh/settings.yaml" "${home}/settings.yaml"
	expand "${cfg}/dsh/hooks.claude.json" "${home}/hooks.claude.json"
	plugin="${root}/harness/jig/adapters/dsh"
	built=0
	if command -v bun >/dev/null 2>&1 && (cd "${plugin}" && bun run build >/dev/null 2>&1); then
		built=1
	else
		say "jig's DSH plugin not built; profiles will not compose jig-guard"
	fi
	for src in "${cfg}"/dsh/profiles/*/; do
		profile="$(basename "${src}")"
		[[ -d "${home}/profiles/${profile}" ]] || continue
		expand "${src}cordis.patch.yml" "${home}/profiles/${profile}/cordis.patch.yml"
		if [[ "${built}" == 1 ]] && command -v pnpm >/dev/null 2>&1; then
			(cd "${home}/profiles/${profile}" && pnpm add "link:${plugin}" >/dev/null 2>&1) ||
				say "could not link jig's plugin into profile ${profile}"
		fi
	done
	;;
*)
	say "unknown harness (pi or dsh)"
	exit 2
	;;
esac

if command -v bun >/dev/null 2>&1; then
	bash "${jig}" apply --target "${harness}" --write || say "jig apply --target ${harness} failed"
else
	say "bun is not on PATH; jig apply skipped"
fi
