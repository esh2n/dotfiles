#!/usr/bin/env bash
# Foreground launcher for the local LiteLLM measuring proxy, supervised by launchd.
#
# Secret model (Stack A — no secret at rest): the 1Password SERVICE ACCOUNT token
# is read from the macOS login Keychain (no biometric prompt), then a single
# bounded `op read` resolves the one provider secret (DeepSeek) into this
# process's env. Nothing secret touches disk, the config, or Docker metadata —
# the container runs --rm in the FOREGROUND so launchd (KeepAlive) supervises it.
# The op read is time-boxed so a throttled/unreachable 1Password fails fast and
# launchd retries, instead of hanging forever and blocking recovery.
#
# The proxy's master_key is a real secret (rotated 2026-09-20 off the old
# committed constant): resolved here from op://llm-automation/litellm/credential
# the same way as the provider key. Consumers fetch it through their own op
# paths (pi: !op read in models.json; dsh: op run --env-file dsh.op-vars).
#
# Deployed to ~/.config/litellm; launched by
# ~/Library/LaunchAgents/com.esh2n.litellm-proxy.plist. Source: dotfiles repo.
set -euo pipefail

# launchd hands us a minimal PATH; name the tools' real locations.
export PATH="/etc/profiles/per-user/$(id -un)/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CFG_DIR="$HOME/.config/litellm"
IMAGE="ghcr.io/berriai/litellm:v1.90.2"
NAME="litellm-proxy"

# 1) service-account token from the login Keychain (headless, no Touch ID)
OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -s litellm-op-token -w)"
export OP_SERVICE_ACCOUNT_TOKEN

# 2) wait for the container runtime (OrbStack) to be ready — launchd may fire first
until docker info >/dev/null 2>&1; do sleep 3; done

# 3) resolve the secrets, time-boxed (fail fast -> launchd retries)
DEEPSEEK_API_KEY="$(timeout 60 op read op://llm-automation/deepseek/credential)"
export DEEPSEEK_API_KEY
LITELLM_MASTER_KEY="$(timeout 60 op read op://llm-automation/litellm/credential)"
export LITELLM_MASTER_KEY

# 4) clear any stale container, then run in the FOREGROUND so launchd owns it.
#    Non-secret values are inline; the secret is passed through from the env
#    (bare -e NAME), never on the command line.
docker rm -f "$NAME" >/dev/null 2>&1 || true
exec docker run --rm --name "$NAME" -p 127.0.0.1:4000:4000 \
  -v "$CFG_DIR/config.yaml":/app/config.yaml \
  -e DEEPSEEK_API_KEY \
  -e LITELLM_MASTER_KEY \
  -e OPENAI_API_KEY=unset-placeholder \
  -e LM_STUDIO_API_BASE=http://host.docker.internal:1234/v1 \
  -e LM_STUDIO_API_KEY=lm-studio \
  "$IMAGE" --config /app/config.yaml
