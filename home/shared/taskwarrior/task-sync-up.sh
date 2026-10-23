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

: "${DOTCTL:?set by the unit}"
if [ -n "${TASK_SYNC_URL:-}" ]; then
	TASK_CLIENT_ID="" TASK_ENCRYPTION_SECRET=""
	if (export_op_token) 2>/dev/null; then
		export_op_token
		TASK_CLIENT_ID="$(try_secret op://llm-automation/taskwarrior/client-id)"
		TASK_ENCRYPTION_SECRET="$(try_secret op://llm-automation/taskwarrior/encryption-secret)"
	fi
	if [ -z "${TASK_CLIENT_ID}" ] || [ -z "${TASK_ENCRYPTION_SECRET}" ]; then
		# no token in the OS store (${OP_TOKEN_ITEM}) or no item yet: take the
		# day's backup, then exit so the service manager tries again later
		echo "task-sync-up: no sync secrets (the 1Password token, or op://llm-automation/taskwarrior/client-id and encryption-secret); backing up only, trying again later" >&2
		unset TASK_SYNC_URL TASK_CLIENT_ID TASK_ENCRYPTION_SECRET OP_SERVICE_ACCOUNT_TOKEN
		"${DOTCTL}" tasks sync once || true
		exit 1
	fi
	export TASK_CLIENT_ID TASK_ENCRYPTION_SECRET
fi
# the loop and the task it runs need none of the vault
unset OP_SERVICE_ACCOUNT_TOKEN
exec "${DOTCTL}" tasks sync loop
