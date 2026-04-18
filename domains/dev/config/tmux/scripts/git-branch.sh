#!/usr/bin/env bash
set -euo pipefail
cd "$1" 2>/dev/null || exit 0
BRANCH=$(git branch --show-current 2>/dev/null)
[ -n "$BRANCH" ] && printf '   %s' "$BRANCH"
