#!/usr/bin/env bash
# Print the LiteLLM gateway master key to stdout, headlessly.
#
# Consumers that talk to the local proxy (pi's models.json apiKey `!command`
# form, and any interactive shell) call this so they resolve the key WITHOUT a
# 1Password desktop approval prompt on every use: it reads the 1Password
# service-account token from the OS store (the same item the proxy's own
# launcher uses) and does one bounded `op read`. No biometric, no
# per-message popup — the trade the key rotation must not lose.
#
# Same op item the proxy resolves at launch (op://llm-automation/litellm/credential).
set -euo pipefail
# shellcheck source=SCRIPTDIR/secrets.sh
source "$(dirname "${BASH_SOURCE[0]}")/secrets.sh"
export_op_token
exec timeout 30 op read op://llm-automation/litellm/credential
