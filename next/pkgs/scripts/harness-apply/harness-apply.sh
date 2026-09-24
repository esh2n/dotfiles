#!/usr/bin/env bash
# harness-apply <checkout>
#
# The coding-agent harness steps that are commands, not files. Run by
# activation after the links are written:
#   1. build jig's DSH plugin and give DSH its expanded copies
#      ($DSH_HOME/hooks.claude.json; each scaffolded profile's
#      cordis.patch.yml, plus the plugin linked into it with pnpm)
#   2. `jig apply --target <h> --write` for claude, codex, pi, omp, dsh
#   3. `jig codex register --write` when codex is installed
# A missing tool is a warning, never a failure: activation must finish.
set -euo pipefail

root="${1:?usage: harness-apply <checkout>}"
if [[ ! -d "${root}" ]]; then
	echo "harness-apply: no checkout at ${root}" >&2
	exit 1
fi
root="$(cd "${root}" && pwd)"
dsh_home="${DSH_HOME:-${HOME}/.dsh}"
dsh_src="${root}/domains/dev/config/dsh"
plugin="${root}/domains/dev/llm/harness/jig/adapters/dsh"
jig="${root}/domains/dev/bin/jig"

warn() { echo "harness-apply: $*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

expand() { # expand <src> <dest>: a copy with {{HOME}} {{USER}} {{DOTFILES_ROOT}} filled in
	[[ -f "$1" ]] || return 0
	mkdir -p "$(dirname "$2")"
	sed -e "s|{{HOME}}|${HOME}|g" \
		-e "s|{{USER}}|${USER:-}|g" \
		-e "s|{{DOTFILES_ROOT}}|${root}|g" \
		"$1" >"$2.tmp"
	mv -f "$2.tmp" "$2"
}

# 1. DSH
plugin_built=0
if [[ -f "${plugin}/src/index.ts" ]]; then
	if have bun && (cd "${plugin}" && bun run build >/dev/null); then
		plugin_built=1
	else
		warn "jig DSH plugin not built (bun missing or build failed); profiles will not compose jig-guard"
	fi
fi
expand "${dsh_src}/hooks.claude.json" "${dsh_home}/hooks.claude.json"
for profile_src in "${dsh_src}"/profiles/*/; do
	[[ -d "${profile_src}" ]] || continue
	profile="$(basename "${profile_src}")"
	profile_home="${dsh_home}/profiles/${profile}"
	[[ -d "${profile_home}" ]] || continue # not scaffolded on this machine
	expand "${profile_src}cordis.patch.yml" "${profile_home}/cordis.patch.yml"
	if [[ "${plugin_built}" == 1 ]] && have pnpm; then
		(cd "${profile_home}" && pnpm add "link:${plugin}" >/dev/null) ||
			warn "could not link the jig plugin into DSH profile ${profile}"
	fi
done

# 2 and 3. jig
if [[ ! -f "${jig}" ]]; then
	warn "no jig launcher at ${jig}; skipping jig apply"
	exit 0
fi
if ! have bun; then
	warn "bun is not on PATH; skipping jig apply (run make up again once mise has installed bun)"
	exit 0
fi
for target in claude codex pi omp dsh; do
	bash "${jig}" apply --target "${target}" --write || warn "jig apply --target ${target} failed"
done
if have codex; then
	bash "${jig}" codex register --write || warn "jig codex register failed"
fi
