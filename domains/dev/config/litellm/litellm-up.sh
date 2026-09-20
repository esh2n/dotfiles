#!/usr/bin/env bash
# Foreground launcher for the local LiteLLM measuring proxy, supervised by launchd.
#
# Secret model (Stack A — no secret at rest): the 1Password SERVICE ACCOUNT token
# is read from the macOS login Keychain (no biometric prompt), then bounded
# `op read`s resolve the provider secrets into this process's env. Nothing secret
# touches disk, the config, or Docker metadata — the container runs --rm in the
# FOREGROUND so launchd (KeepAlive) supervises it. Each op read is time-boxed so a
# throttled/unreachable 1Password fails fast and launchd retries.
#
# master_key is a real secret (op://llm-automation/litellm/credential). Consumers
# fetch it through their own op paths.
#
# TYPESAFE_API_KEY (op://llm-automation/typesafe/credential) is the DOWNSTREAM key
# for the built-in /typesafe/v1/systemone pass-through: the proxy meters the
# judgment model (jev) like any other model — jev's dollar cost lands in the same
# Prometheus spend metric as chat traffic — and overwrites the caller's
# Authorization with this key, so the key lives only here, never in a harness.
#
# The image is pinned by DIGEST, not a moving tag: the TypeSafe pass-through landed
# on main (reports as 1.103.0) AFTER v1.102.0 branched, so no released tag carries
# it yet. The digest freezes one build (validated in isolation: chat, the typed
# /typesafe passthrough, and the litellm_spend_metric for typesafe/jev all green).
# Move this to a released `v1.103.0` tag once that ships.
#
# Deployed to ~/.config/litellm; launched by
# ~/Library/LaunchAgents/com.esh2n.litellm-proxy.plist. Source: dotfiles repo.
set -euo pipefail

# launchd hands us a minimal PATH; name the tools' real locations.
export PATH="/etc/profiles/per-user/$(id -un)/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CFG_DIR="$HOME/.config/litellm"
IMAGE="ghcr.io/berriai/litellm@sha256:114aca7726c311915c8ea5120fcc44d32a0648c3ae3aec41a1014f0e846b16d1"
NAME="litellm-proxy"

# `op read` with one retry on empty: a cold-start shell intermittently returns an
# empty value on the first read (measured), and an empty master key boots a proxy
# that 401s every request. Retry once, then hard-abort so launchd retries the whole
# launch instead of running with a missing secret. (exit inside $() propagates to
# the assignment, which set -e turns into a launch abort.)
read_secret() {
  local ref="$1" value
  value="$(timeout 60 op read "$ref" 2>/dev/null || true)"
  if [ -z "$value" ]; then
    sleep 2
    value="$(timeout 60 op read "$ref" 2>/dev/null || true)"
  fi
  if [ -z "$value" ]; then
    echo "litellm-up: could not resolve $ref (empty after retry)" >&2
    exit 1
  fi
  printf '%s' "$value"
}

# 1) service-account token from the login Keychain (headless, no Touch ID)
OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -s litellm-op-token -w)"
export OP_SERVICE_ACCOUNT_TOKEN

# 2) wait for the container runtime (OrbStack) to be ready — launchd may fire first
until docker info >/dev/null 2>&1; do sleep 3; done

# 3) resolve the secrets, time-boxed with retry-on-empty (fail fast -> launchd retries)
DEEPSEEK_API_KEY="$(read_secret op://llm-automation/deepseek/credential)"
export DEEPSEEK_API_KEY
LITELLM_MASTER_KEY="$(read_secret op://llm-automation/litellm/credential)"
export LITELLM_MASTER_KEY
TYPESAFE_API_KEY="$(read_secret op://llm-automation/typesafe/credential)"
export TYPESAFE_API_KEY

# 4) clear any stale container, then run in the FOREGROUND so launchd owns it.
#    Non-secret values are inline; secrets are passed through from the env
#    (bare -e NAME), never on the command line.
docker rm -f "$NAME" >/dev/null 2>&1 || true
exec docker run --rm --name "$NAME" -p 127.0.0.1:4000:4000 \
  -v "$CFG_DIR/config.yaml":/app/config.yaml \
  -e DEEPSEEK_API_KEY \
  -e LITELLM_MASTER_KEY \
  -e TYPESAFE_API_KEY \
  -e OPENAI_API_KEY=unset-placeholder \
  -e LM_STUDIO_API_BASE=http://host.docker.internal:1234/v1 \
  -e LM_STUDIO_API_KEY=lm-studio \
  "$IMAGE" --config /app/config.yaml
