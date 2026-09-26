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
#    ready — the service manager may fire first. Said once in the log, so a
#    stopped engine shows; an engine that refuses this user is not waited for
#    (exit, and the service manager's retry logs it again).
waited=0
until docker_info="$(docker info 2>&1)"; do
  case "$docker_info" in
    *"permission denied"*)
      echo "litellm-up: Docker refuses this user (not in the docker group): run omarchy-setup-security-sudoless-docker, then log in again" >&2
      exit 1
      ;;
  esac
  if [ "$waited" = 0 ]; then
    echo "litellm-up: waiting for the Docker engine (macOS: start OrbStack; Linux: docker.socket)"
    waited=1
  fi
  sleep 3
done
[ "$waited" = 0 ] || echo "litellm-up: the Docker engine answers"

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

# 4) where the deterministic tier is: the Omarchy desktop's llama-server
#    (rules/decisions/2026-09-26-deterministic-on-the-gpu.md), reached by its
#    tailnet name from every machine, the desktop included — llama-server
#    binds loopback and `tailscale serve --tcp 8080` is its one exposure.
#    LLAMA_SERVER_HOST comes from the roles file's "llamaServerHost". Without
#    it, or without the key, LiteLLM still serves the other tiers and only
#    deterministic fails.
LLAMA_SERVER_HOST="${LLAMA_SERVER_HOST:-}"
LLAMA_SERVER_API_KEY="$(try_secret op://llm-automation/llama-server/credential)"
if [ -n "$LLAMA_SERVER_HOST" ]; then
  LLAMA_SERVER_API_BASE="http://${LLAMA_SERVER_HOST}:8080/v1"
else
  echo "litellm-up: \"llamaServerHost\" is not in the roles file — the deterministic tier will fail until it is" >&2
  LLAMA_SERVER_API_BASE="http://llama-server.invalid:8080/v1"
fi
if [ -z "$LLAMA_SERVER_API_KEY" ]; then
  echo "litellm-up: op://llm-automation/llama-server/credential did not resolve — the deterministic tier will fail until it does" >&2
  LLAMA_SERVER_API_KEY="unset"
fi
export LLAMA_SERVER_API_KEY

# 4b) where deterministic falls back while the desktop is off: the Mac's LM
#     Studio (rules/decisions/2026-09-27-deterministic-falls-back-to-the-mac.md).
#     On the Mac it is local (host.docker.internal is the host's loopback as
#     seen from the container); elsewhere it is the Mac's tailnet name, the
#     roles file's "lmStudioHost". Without either the fallback fails too.
#     The curl covers a machine that runs LM Studio locally without being a
#     Mac; uname covers the Mac while LM Studio is not up yet at login.
LM_STUDIO_HOST="${LM_STUDIO_HOST:-}"
if curl -sf --max-time 2 http://127.0.0.1:1234/v1/models >/dev/null 2>&1 || [ "$(uname -s)" = Darwin ]; then
  LM_STUDIO_API_BASE="http://host.docker.internal:1234/v1"
elif [ -n "$LM_STUDIO_HOST" ]; then
  LM_STUDIO_API_BASE="http://${LM_STUDIO_HOST}:1234/v1"
else
  echo "litellm-up: \"lmStudioHost\" is not in the roles file — deterministic has no fallback while the desktop is off" >&2
  LM_STUDIO_API_BASE="http://lm-studio.invalid:1234/v1"
fi
# Linux: the container cannot resolve a *.ts.net name itself — the host's
# resolver is systemd-resolved's 127.0.0.53 stub, which Docker replaces with
# public DNS. Resolve it here, on the host, and hand the container that one
# name, leaving every other lookup as it was. (macOS: OrbStack's containers
# already resolve through the Mac's own resolver, MagicDNS included.)
HOST_ARGS=()
if [ "$(uname -s)" = Linux ]; then
  for tailnet_host in "$LLAMA_SERVER_HOST" "$LM_STUDIO_HOST"; do
    [ -n "$tailnet_host" ] || continue
    tailnet_ip="$(getent ahostsv4 "$tailnet_host" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
    if [ -n "$tailnet_ip" ]; then
      HOST_ARGS+=(--add-host "${tailnet_host}:${tailnet_ip}")
    else
      echo "litellm-up: ${tailnet_host} does not resolve on this machine (Tailscale down?) — deterministic cannot reach it until it does" >&2
    fi
  done
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
exec docker run --rm --name "$NAME" ${DB_ARGS[@]+"${DB_ARGS[@]}"} ${HOST_ARGS[@]+"${HOST_ARGS[@]}"} \
  -p 127.0.0.1:4000:4000 \
  -p "127.0.0.1:${METRICS_PORT}:${METRICS_PORT}" \
  -v "$CFG_DIR/config.yaml":/app/config.yaml \
  -e DEEPSEEK_API_KEY \
  -e LITELLM_MASTER_KEY \
  -e TYPESAFE_API_KEY \
  -e OPENAI_API_KEY=unset-placeholder \
  -e LLAMA_SERVER_API_BASE="$LLAMA_SERVER_API_BASE" \
  -e LLAMA_SERVER_API_KEY \
  -e LM_STUDIO_API_BASE="$LM_STUDIO_API_BASE" \
  -e LM_STUDIO_API_KEY=lm-studio \
  "$IMAGE" --config /app/config.yaml --prometheus_metrics_port "$METRICS_PORT"
