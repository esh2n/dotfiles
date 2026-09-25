#!/usr/bin/env bash
# Foreground launcher for llama-server in router mode (the gpu role; systemd
# --user owns the process). Decision:
# rules/decisions/2026-09-24-home-llm-second-host-omarchy-llama-server.md.
#
# Bound to loopback; `tailscale serve --tcp 8080` (home-llm-setup --gpu) is
# the only exposure. Every request needs the API key, resolved headlessly from
# 1Password like LiteLLM's and handed over in a 0600 file under
# $XDG_RUNTIME_DIR — never on the command line, where ps would show it.
# Models are the GGUF files in $LLAMA_MODELS_DIR, chosen by the request's
# `model` field.
set -euo pipefail

# PATH, export_op_token and read_secret (libsecret on Linux)
# shellcheck source=SCRIPTDIR/../../../../domains/dev/config/litellm/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../../domains/dev/config/litellm/secrets.sh"
use_service_path

: "${LLAMA_SERVER_BIN:?set by the unit}" "${LLAMA_PORT:?set by the unit}" "${LLAMA_MODELS_DIR:?set by the unit}"

export_op_token
KEY="$(read_secret op://llm-automation/llama-server/credential)"

umask 077
KEY_FILE="${XDG_RUNTIME_DIR:-/tmp}/llama-server.key"
printf '%s\n' "${KEY}" >"${KEY_FILE}"
unset KEY

mkdir -p "${LLAMA_MODELS_DIR}"
exec "${LLAMA_SERVER_BIN}" \
	--host 127.0.0.1 --port "${LLAMA_PORT}" \
	--models-dir "${LLAMA_MODELS_DIR}" \
	--api-key-file "${KEY_FILE}" \
	--metrics
