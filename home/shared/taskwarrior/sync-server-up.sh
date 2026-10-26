#!/usr/bin/env bash
# Foreground launcher for the tasks' sync server (the observer machine;
# rules/decisions/2026-10-23-personal-tasks-sync.md). It answers on loopback
# only; `tailscale serve --https=10222` (dotctl llm setup) puts it on the
# tailnet with a certificate. The server stores only encrypted changes: the
# key never leaves the replicas. It admits the one client id the replicas
# share, read headlessly from 1Password.
set -euo pipefail

# PATH, export_op_token, read_secret (Keychain on macOS, libsecret on Linux)
# shellcheck source=SCRIPTDIR/../litellm/config/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../litellm/config/secrets.sh"
use_service_path
# the tasks' own service account, which reads only the taskwarrior vault
OP_TOKEN_ITEM="taskwarrior-op-token"

: "${SYNC_SERVER:?set by the unit}"
: "${SYNC_LISTEN:?set by the unit}"
export_op_token
CLIENT_ID="$(read_secret op://taskwarrior/taskwarrior/client-id)"
# the server reads --allow-client-id from CLIENT_ID: off the command line, and
# the vault token does not go with it
export CLIENT_ID
unset OP_SERVICE_ACCOUNT_TOKEN
DATA_DIR="${HOME}/.local/share/taskchampion-sync-server"
mkdir -p "${DATA_DIR}"
chmod 700 "${DATA_DIR}"
exec "${SYNC_SERVER}" --listen "${SYNC_LISTEN}" --data-dir "${DATA_DIR}"
