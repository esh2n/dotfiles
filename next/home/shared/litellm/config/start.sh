#!/usr/bin/env bash
# Start the LiteLLM measuring proxy with keys injected by 1Password at launch.
#
# `op run --env-file litellm.op-vars` resolves the op:// references into the
# environment of THIS process only (never to disk), then `-e VAR` passes those
# resolved values through into the container. Secrets never land in a file, a
# committed config, or the shell history.
#
# Requires: op (1Password CLI, signed in) and docker. Native alternative at the
# bottom. Proxy comes up on http://localhost:4000 ; metrics on /metrics.
set -euo pipefail
cd "$(dirname "$0")"

# Pin a real, current tag — verify the latest stable on
# https://github.com/BerriAI/litellm/pkgs/container/litellm before first run.
LITELLM_IMAGE="ghcr.io/berriai/litellm:v1.90.2"

op run --env-file litellm.op-vars -- \
  docker run --rm \
    -v "$(pwd)/config.yaml:/app/proxy_server_config.yaml" \
    -p 4000:4000 \
    -e DEEPSEEK_API_KEY -e OPENAI_API_KEY -e LITELLM_MASTER_KEY \
    -e LM_STUDIO_API_BASE -e LM_STUDIO_API_KEY \
    "$LITELLM_IMAGE" \
    --config /app/proxy_server_config.yaml

# --- native alternative (no Docker; localhost:1234 works as-is) --------------
# Change LM_STUDIO_API_BASE in litellm.op-vars to http://localhost:1234/v1,
# then:
#   pip install 'litellm[proxy]'   # or: uv pip install 'litellm[proxy]'
#   op run --env-file litellm.op-vars -- litellm --config config.yaml
