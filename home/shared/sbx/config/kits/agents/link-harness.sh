#!/usr/bin/env bash
# link-harness.sh <pi|dsh> <checkout>: inside a fresh sandbox, give one
# harness what home-manager and `jig setup` give it on the host — its config
# linked from the mounted checkout, then `jig setup --target <h>` (DSH's
# expanded copies and plugin, then `jig apply --target <h> --write`).
# Run by the pi and dsh kits' startup (spec.yaml.in); the sandbox's home is
# new, so nothing here backs up or sweeps old links.
set -euo pipefail

harness="${1:?usage: link-harness.sh <pi|dsh> <checkout>}"
root="${2:?usage: link-harness.sh <pi|dsh> <checkout>}"
cfg="${root}/home/shared/harness"
jig="${root}/harness/bin/jig"

say() { echo "link-harness ${harness}: $*"; }
link() { mkdir -p "$(dirname "$2")" && ln -sfn "$1" "$2"; }

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
	;;
*)
	say "unknown harness (pi or dsh)" >&2
	exit 2
	;;
esac

if command -v bun >/dev/null 2>&1; then
	bash "${jig}" setup --target "${harness}" || say "[WARN] jig setup --target ${harness} failed"
else
	say "[WARN] bun is not on PATH; jig setup skipped"
fi
