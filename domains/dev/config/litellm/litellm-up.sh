#!/usr/bin/env bash
# Foreground launcher for the local LiteLLM measuring proxy, supervised by launchd.
#
# Secret model (Stack A — no secret at rest): the 1Password SERVICE ACCOUNT token
# is read from the OS store — login Keychain / libsecret — (no biometric prompt), then bounded
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

# PATH, export_op_token and read_secret (Keychain on macOS, libsecret on Linux)
# shellcheck source=SCRIPTDIR/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/secrets.sh"
use_service_path

CFG_DIR="$HOME/.config/litellm"
IMAGE="ghcr.io/berriai/litellm@sha256:114aca7726c311915c8ea5120fcc44d32a0648c3ae3aec41a1014f0e846b16d1"
NAME="litellm-proxy"


# 1) service-account token from the OS store (headless, no prompt)
export_op_token

# 2) wait for the container runtime (OrbStack on macOS, Docker on Linux) to be
#    ready — the service manager may fire first
until docker info >/dev/null 2>&1; do sleep 3; done

# 3) resolve the secrets, time-boxed with retry-on-empty (fail fast -> launchd retries)
DEEPSEEK_API_KEY="$(read_secret op://llm-automation/deepseek/credential)"
export DEEPSEEK_API_KEY
LITELLM_MASTER_KEY="$(read_secret op://llm-automation/litellm/credential)"
export LITELLM_MASTER_KEY
TYPESAFE_API_KEY="$(read_secret op://llm-automation/typesafe/credential)"
export TYPESAFE_API_KEY

# 4) where LM Studio is — the ONE value that differs between machines
#    (rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md).
#    If a local LM Studio answers, use it (host.docker.internal is the host's
#    loopback as seen from the container). Otherwise this machine has no model
#    of its own and reaches the Mac's LM Studio over the tailnet, by its
#    Tailscale name. LiteLLM itself stays loopback-only everywhere; only LM
#    Studio is served on the tailnet (`tailscale serve --bg --tcp 1234
#    127.0.0.1:1234`, run once on the Mac). No per-machine file, no hostname
#    branch: a machine that later gets its own LM Studio switches by itself.
#    The local branch is the Mac's (LM Studio runs on macOS only, 2026-09-24
#    decision); a Linux machine reaches the models over the tailnet.
LM_STUDIO_REMOTE_HOST="${LM_STUDIO_REMOTE_HOST:-}"   # the Mac's MagicDNS name, e.g. mac.tail1234.ts.net
if curl -sf --max-time 2 http://127.0.0.1:1234/v1/models >/dev/null 2>&1; then
  LM_STUDIO_API_BASE="http://host.docker.internal:1234/v1"
elif [ -n "$LM_STUDIO_REMOTE_HOST" ]; then
  LM_STUDIO_API_BASE="http://${LM_STUDIO_REMOTE_HOST}:1234/v1"
  echo "litellm-up: no local LM Studio on :1234, using ${LM_STUDIO_API_BASE}" >&2
else
  echo "litellm-up: no local LM Studio on :1234 and LM_STUDIO_REMOTE_HOST is unset — the deterministic tier will fail until one exists" >&2
  LM_STUDIO_API_BASE="http://host.docker.internal:1234/v1"
fi

# 5) clear any stale container, then run in the FOREGROUND so launchd owns it.
#    Non-secret values are inline; secrets are passed through from the env
#    (bare -e NAME), never on the command line.
#
#    Two ports, both loopback: 4000 is the chat API (never leaves this machine);
#    4001 is LiteLLM's dedicated metrics listener (v1.101.0+, same metric set as
#    :4000/metrics/, no LiteLLM key auth). It exists so the Mac's Prometheus can
#    aggregate every machine WITHOUT the chat API ever being served: on a
#    non-Mac machine, run once
#      tailscale serve --bg --tcp 4001 tcp://127.0.0.1:4001
#    and only 4001 becomes reachable — from the owner's own devices, per
#    domains/dev/config/tailscale/acl.hujson. Same decision record as step 4.
METRICS_PORT=4001
docker rm -f "$NAME" >/dev/null 2>&1 || true
exec docker run --rm --name "$NAME" \
  -p 127.0.0.1:4000:4000 \
  -p "127.0.0.1:${METRICS_PORT}:${METRICS_PORT}" \
  -v "$CFG_DIR/config.yaml":/app/config.yaml \
  -e DEEPSEEK_API_KEY \
  -e LITELLM_MASTER_KEY \
  -e TYPESAFE_API_KEY \
  -e OPENAI_API_KEY=unset-placeholder \
  -e LM_STUDIO_API_BASE="$LM_STUDIO_API_BASE" \
  -e LM_STUDIO_API_KEY=lm-studio \
  "$IMAGE" --config /app/config.yaml --prometheus_metrics_port "$METRICS_PORT"
