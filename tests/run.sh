#!/usr/bin/env bash
# Run bats suites: the files given, or every suite under tests/.
# `bats` comes from PATH, else from npx.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -eq 0 ]]; then
	set -- --recursive "${here}"
fi
if command -v bats >/dev/null 2>&1; then
	exec bats "$@"
fi
exec npx --yes bats@1.11.1 "$@"
