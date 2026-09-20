#!/usr/bin/env bash
# Foreground launcher for jig's judgment service, supervised by launchd.
#
# Secret model (identical convention to the LiteLLM proxy's launcher): the
# 1Password SERVICE ACCOUNT token comes from the macOS login Keychain (no biometric
# prompt), then bounded `op read`s resolve the secret this service needs into its
# env. The harnesses call this service over the loopback and never hold a credential
# themselves.
#
# Transport = PROXY: jev (TypeSafe) traffic is sent THROUGH the local LiteLLM proxy's
# built-in /typesafe pass-through, so jev's dollar cost is metered in the same place
# as every other model (litellm_spend_metric) and the downstream TypeSafe key lives
# only in the proxy. In this mode jig sends the LiteLLM MASTER key as its bearer
# (JIG_JEV_API_KEY) to JIG_JEV_BASE_URL; the proxy overwrites the Authorization with
# its own TYPESAFE_API_KEY. DIRECT-to-vendor mode is still available by leaving
# JIG_JEV_BASE_URL unset and exporting TYPESAFE_API_KEY instead (see
# resolveJudgmentClientConfig in typesafe-client.ts).
#
# Authentication: `/decide`, `/tier` and `/compact` require `Authorization:
# Bearer <token>`, where the token lives in a 0600 file this process creates
# (or reuses) on start — default `~/Library/Application Support/jig/decision.token`,
# overridable via JIG_DECISION_TOKEN_FILE. This defends against another local
# user reaching the loopback port; it is not a defense against same-uid
# malware, which could read the token file directly. `/health` stays open.
#
# Deployed to ~/.config/jig; launched by
# ~/Library/LaunchAgents/com.esh2n.jig-decision.plist. Source: dotfiles repo.
set -euo pipefail

# launchd hands us a minimal PATH; name the tools' real locations.
export PATH="/etc/profiles/per-user/$(id -un)/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Where the jig checkout lives. Set by the plist (from {{DOTFILES_ROOT}} at
# apply time); this fallback is only for a manual/ad-hoc run where JIG_DIR
# isn't exported, and stays portable by never hardcoding a username.
JIG_DIR="${JIG_DIR:-${DOTFILES_ROOT:-$HOME/go/github.com/$(id -un)/dotfiles}/domains/dev/llm/harness/jig}"
BUN="${BUN:-$HOME/.local/share/mise/installs/bun/1.3.13/bin/bun}"
PORT="${JIG_DECISION_PORT:-4100}"

# `op read` with one retry on empty: a cold-start shell intermittently returns an
# empty value on the first read (measured), and an empty key makes every jev call
# 401. Retry once, then hard-abort so launchd retries the whole launch instead of
# starting with a missing secret. (exit inside $() propagates to the assignment,
# which set -e turns into a launch abort.)
read_secret() {
  local ref="$1" value
  value="$(timeout 60 op read "$ref" 2>/dev/null || true)"
  if [ -z "$value" ]; then
    sleep 2
    value="$(timeout 60 op read "$ref" 2>/dev/null || true)"
  fi
  if [ -z "$value" ]; then
    echo "jig-decision-up: could not resolve $ref (empty after retry)" >&2
    exit 1
  fi
  printf '%s' "$value"
}

# 1) service-account token from the login Keychain (headless, no Touch ID)
OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -s litellm-op-token -w)"
export OP_SERVICE_ACCOUNT_TOKEN

# 2) PROXY transport: jev goes through the LiteLLM proxy, so the secret this service
#    needs is the LiteLLM MASTER key (not the TypeSafe key — that lives in the proxy).
JIG_JEV_API_KEY="$(read_secret op://llm-automation/litellm/credential)"
export JIG_JEV_API_KEY
export JIG_JEV_BASE_URL="http://localhost:4000/typesafe"

# 3) refuse to start a service that cannot possibly answer, with the reason
if [ ! -f "$JIG_DIR/src/cli/jig.ts" ]; then
  echo "jig not found at $JIG_DIR (set JIG_DIR in the plist)" >&2
  exit 1
fi

# 4) run in the FOREGROUND so launchd owns the process and can restart it
cd "$JIG_DIR"
export JIG_DECISION_PORT="$PORT"
exec "$BUN" src/cli/jig.ts serve
