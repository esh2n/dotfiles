#!/usr/bin/env bash
# Foreground launcher for the local LiteLLM measuring proxy, supervised by launchd.
#
# Secret model (Stack A — no secret at rest): the 1Password SERVICE ACCOUNT token
# is read from the OS store — login Keychain / libsecret — (no biometric prompt), then bounded
# `op read`s resolve the provider secrets into this process's env. Nothing secret
# is on a command line or in the repository. The provider keys and DATABASE_URL
# do reach the container as environment variables, which Docker keeps in the
# container's config (`docker inspect` shows them to whoever can use the docker
# socket) for as long as the container exists; the container runs --rm in the
# FOREGROUND so launchd (KeepAlive) supervises it and removes it on exit. The
# ledger DB container reads its password from a 0600 file instead. Each op read
# is time-boxed so a throttled/unreachable 1Password fails fast and launchd retries.
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
DB_IMAGE="postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24"
DB_NAME="litellm-db"
NETWORK="litellm"


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

# 3b) this machine's spend ledger: LiteLLM writes every request's cost to its
#     own Postgres on the same docker network — never across the tailnet on
#     the request path. The observer machine's Postgres is the one ledger
#     the others ship to (rules/decisions/2026-09-25-llm-cost-ledger-local-first.md).
#     Without the DB secret LiteLLM serves as before, only unrecorded.
#     The password must be URL-safe (letters and digits): it goes into a URL.
LITELLM_DB_PASSWORD="$(try_secret op://llm-automation/litellm-db/password)"
DB_ARGS=()
if [ -n "$LITELLM_DB_PASSWORD" ]; then
  # the DB container reads its password from a file (POSTGRES_PASSWORD_FILE),
  # so it is not kept in the container's config
  SECRET_DIR="${XDG_RUNTIME_DIR:-$HOME/.local/state}/litellm-secrets"
  (umask 077 && mkdir -p "$SECRET_DIR" && printf '%s' "$LITELLM_DB_PASSWORD" >"$SECRET_DIR/db_password")
  docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
  if [ "$(docker inspect -f '{{.State.Running}}' "$DB_NAME" 2>/dev/null || true)" != true ]; then
    docker rm -f "$DB_NAME" >/dev/null 2>&1 || true
    # 5432 on loopback only: the ledger sync reads it here, and on the
    # observer machine `tailscale serve --tcp 5432` is its one exposure.
    docker run -d --name "$DB_NAME" --restart unless-stopped --network "$NETWORK" \
      -p 127.0.0.1:5432:5432 -v litellm-db-data:/var/lib/postgresql/data \
      -v "$SECRET_DIR/db_password:/run/secrets/db_password:ro" \
      -e POSTGRES_PASSWORD_FILE=/run/secrets/db_password -e POSTGRES_USER=litellm -e POSTGRES_DB=litellm \
      "$DB_IMAGE" >/dev/null
  fi
  until docker exec "$DB_NAME" pg_isready -U litellm -d litellm >/dev/null 2>&1; do sleep 1; done
  export DATABASE_URL="postgresql://litellm:${LITELLM_DB_PASSWORD}@${DB_NAME}:5432/litellm"
  DB_ARGS=(--network "$NETWORK" -e DATABASE_URL)
else
  echo "litellm-up: no ledger DB secret (op://llm-automation/litellm-db/password); serving without spend records" >&2
fi

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
#    home/shared/tailscale/config/acl.hujson. Same decision record as step 4.
METRICS_PORT=4001
docker rm -f "$NAME" >/dev/null 2>&1 || true
exec docker run --rm --name "$NAME" ${DB_ARGS[@]+"${DB_ARGS[@]}"} \
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
