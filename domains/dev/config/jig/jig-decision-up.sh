#!/usr/bin/env bash
# Foreground launcher for jig's judgment service, supervised by launchd.
#
# Secret model (identical to the LiteLLM proxy's launcher — one convention, not
# two): the 1Password SERVICE ACCOUNT token comes from the macOS login Keychain
# (no biometric prompt), then ONE bounded `op read` resolves the judgment key into
# this process's env. That is the only place the key ever exists: the harnesses
# call this service over the loopback and never hold a credential themselves.
#
# The `op read` is time-boxed so a throttled or unreachable 1Password fails fast
# and launchd retries, instead of hanging forever and blocking recovery.
#
# Deployed to ~/.config/jig; launched by
# ~/Library/LaunchAgents/com.esh2n.jig-decision.plist. Source: dotfiles repo.
set -euo pipefail

# launchd hands us a minimal PATH; name the tools' real locations.
export PATH="/etc/profiles/per-user/esh2n/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Where the jig checkout lives. Set by the plist; overridable for a worktree.
JIG_DIR="${JIG_DIR:-$HOME/go/github.com/esh2n/dotfiles/domains/dev/llm/harness/jig}"
BUN="${BUN:-$HOME/.local/share/mise/installs/bun/1.3.13/bin/bun}"
PORT="${JIG_DECISION_PORT:-4100}"

# 1) service-account token from the login Keychain (headless, no Touch ID)
OP_SERVICE_ACCOUNT_TOKEN="$(security find-generic-password -s litellm-op-token -w)"
export OP_SERVICE_ACCOUNT_TOKEN

# 2) resolve the ONE secret this service needs, time-boxed (fail fast -> launchd retries)
TYPESAFE_API_KEY="$(timeout 60 op read op://llm-automation/typesafe/credential)"
export TYPESAFE_API_KEY

# 3) refuse to start a service that cannot possibly answer, with the reason
if [ ! -f "$JIG_DIR/src/cli/jig.ts" ]; then
  echo "jig not found at $JIG_DIR (set JIG_DIR in the plist)" >&2
  exit 1
fi

# 4) run in the FOREGROUND so launchd owns the process and can restart it
cd "$JIG_DIR"
export JIG_DECISION_PORT="$PORT"
exec "$BUN" src/cli/jig.ts serve
