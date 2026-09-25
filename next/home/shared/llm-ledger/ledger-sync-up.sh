#!/usr/bin/env bash
# Foreground launcher for the cost-ledger sync (a machine without the
# observer role; rules/decisions/2026-09-25-llm-cost-ledger-local-first.md).
# Resolves the ledger DB password headlessly, like LiteLLM's own launcher, and
# hands over to `dotctl ledger sync loop` (next/pkgs/dotctl, internal/ledger).
set -euo pipefail

# PATH, export_op_token, try_secret (Keychain on macOS, libsecret on Linux)
# shellcheck source=SCRIPTDIR/../litellm/config/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../litellm/config/secrets.sh"
use_service_path

: "${DOTCTL:?set by the unit}"
export_op_token
LEDGER_PASSWORD="$(try_secret op://llm-automation/litellm-db/password)"
if [ -z "${LEDGER_PASSWORD}" ]; then
	# no DB on this machine either (litellm-up.sh): nothing to ship; look again later
	echo "ledger-sync-up: no ledger DB secret (op://llm-automation/litellm-db/password)" >&2
	exec sleep 3600
fi
export LEDGER_PASSWORD
exec "${DOTCTL}" ledger sync loop
