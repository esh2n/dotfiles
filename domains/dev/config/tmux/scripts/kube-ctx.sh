#!/usr/bin/env bash
set -euo pipefail
command -v kubectl >/dev/null 2>&1 || exit 0
CTX=$(kubectl config current-context 2>/dev/null) || exit 0
[ -n "$CTX" ] && printf '⎈ %s' "$CTX"
