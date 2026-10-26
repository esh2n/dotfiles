#!/usr/bin/env bash
# Foreground launcher for the tasks' sync (every machine;
# rules/decisions/2026-10-23-personal-tasks-sync.md). Resolves the replicas'
# shared client id and encryption secret headlessly, like LiteLLM's own
# launcher, and hands over to `dotctl tasks sync loop` (pkgs/dotctl,
# internal/tasks), which syncs every five minutes and backs the replica up
# once a day.
set -euo pipefail

# PATH, export_op_token, try_secret (Keychain on macOS, libsecret on Linux)
# shellcheck source=SCRIPTDIR/../litellm/config/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../litellm/config/secrets.sh"
use_service_path
# the tasks' own service account, which reads only the taskwarrior vault
OP_TOKEN_ITEM="taskwarrior-op-token"

: "${DOTCTL:?set by the unit}"
if [ -n "${TASK_SYNC_URL:-}" ]; then
	TASK_CLIENT_ID="" TASK_ENCRYPTION_SECRET=""
	if (export_op_token) 2>/dev/null; then
		export_op_token
		TASK_CLIENT_ID="$(try_secret op://taskwarrior/taskwarrior/client-id)"
		TASK_ENCRYPTION_SECRET="$(try_secret op://taskwarrior/taskwarrior/encryption-secret)"
	fi
	if [ -z "${TASK_CLIENT_ID}" ] || [ -z "${TASK_ENCRYPTION_SECRET}" ]; then
		# no token in the OS store (${OP_TOKEN_ITEM}) or no item yet: take the
		# day's backup, then exit so the service manager tries again later
		echo "task-sync-up: no sync secrets (the 1Password token ${OP_TOKEN_ITEM} in the OS store, or op://taskwarrior/taskwarrior/client-id and encryption-secret); backing up only, trying again later" >&2
		echo "  macOS: security add-generic-password -a \"\$USER\" -s ${OP_TOKEN_ITEM} -w '<token>'" >&2
		echo "  Linux: secret-tool store --label='1Password taskwarrior' service ${OP_TOKEN_ITEM}" >&2
		unset TASK_SYNC_URL TASK_CLIENT_ID TASK_ENCRYPTION_SECRET OP_SERVICE_ACCOUNT_TOKEN
		"${DOTCTL}" tasks sync once || true
		exit 1
	fi
	export TASK_CLIENT_ID TASK_ENCRYPTION_SECRET
fi
# the loop and the task it runs need none of the vault
unset OP_SERVICE_ACCOUNT_TOKEN
exec "${DOTCTL}" tasks sync loop
