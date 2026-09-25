#!/usr/bin/env bash
# Foreground launcher for the cost-ledger sync (a machine without the
# llm-console role; rules/decisions/2026-09-25-llm-cost-ledger-local-first.md).
# Resolves the ledger DB password headlessly, like LiteLLM's own launcher, and
# hands over to llm-ledger-sync (next/pkgs/scripts/llm-ledger-sync).
set -euo pipefail

# PATH, export_op_token, try_secret (Keychain on macOS, libsecret on Linux)
# shellcheck source=SCRIPTDIR/../../../../domains/dev/config/litellm/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../../domains/dev/config/litellm/secrets.sh"
use_service_path

: "${LEDGER_SYNC_BIN:?set by the unit}"
export_op_token
LEDGER_PASSWORD="$(try_secret op://llm-automation/litellm-db/credential)"
if [ -z "${LEDGER_PASSWORD}" ]; then
	# no DB on this machine either (litellm-up.sh): nothing to ship; look again later
	echo "ledger-sync-up: no ledger DB secret (op://llm-automation/litellm-db/credential)" >&2
	exec sleep 3600
fi
export LEDGER_PASSWORD
exec "${LEDGER_SYNC_BIN}" loop
