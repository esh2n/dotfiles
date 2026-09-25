#!/usr/bin/env bash
# The home-LLM check lives in dotctl (`dotctl llm check`, next/pkgs/dotctl,
# internal/llm); this name is kept for the old layout's installer and for
# hands that still type it.
set -euo pipefail
exec dotctl llm check --repo "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)" "$@"
