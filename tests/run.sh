#!/usr/bin/env bash
# Run every bats suite under tests/. `bats` comes from PATH, else from npx.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v bats >/dev/null 2>&1; then
	exec bats --recursive "$@" "${here}"
fi
exec npx --yes bats@1.11.1 --recursive "$@" "${here}"
