#!/usr/bin/env bash
# Start DeepSeek Harness web UI with the proxy key injected by 1Password.
#
# `op run` resolves the op:// ref into this process's env (never to disk); DSH
# reads LITELLM_API_KEY from the inherited env (highest precedence) to auth to
# the local LiteLLM proxy. The proxy (started separately, see ../litellm) holds
# the actual DeepSeek/OpenAI keys.
#
# Requires: op (1Password CLI, signed in), Node ^22.19 || >=24, and the LiteLLM
# proxy already running on :4000. Web UI comes up on http://127.0.0.1:3080.
# Reach it remotely over an SSH tunnel (dsh has no cloud component).
#
# The npx version below is pinned deliberately: an unpinned `npx
# @deepseek-ai/dsh` resolves whatever the registry serves at launch time, in
# a process holding LITELLM_API_KEY and the guard bridge — a compromised,
# hijacked, or typosquatted publish would run as the user with that
# credential and full filesystem access on the next start. Bump the version
# by hand after reviewing the release, not automatically.
set -euo pipefail
cd "$(dirname "$0")"

op run --env-file dsh.op-vars -- npx @deepseek-ai/dsh@0.1.5-rc.2 web
