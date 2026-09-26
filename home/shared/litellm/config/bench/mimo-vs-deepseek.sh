#!/usr/bin/env bash
# MiMo-V2.6-Flash against deepseek-flash (the `main` tier) on this bench's
# prompts, each on its own vendor API (rules/research/2026-09-26-mimo-vs-deepseek.md).
# The keys come from 1Password through the same service account LiteLLM uses
# and reach quant-ab.mjs only as BENCH_API_KEY, never on a command line.
#
#   bash home/shared/litellm/config/bench/mimo-vs-deepseek.sh [runs]
#
# XIAOMI_REF / DEEPSEEK_REF override where the keys are.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../secrets.sh
source "${here}/../secrets.sh"
export_op_token

runs="${1:-2}"
xiaomi_ref="${XIAOMI_REF:-op://llm-automation/xiaomi/credential}"
deepseek_ref="${DEEPSEEK_REF:-op://llm-automation/deepseek/credential}"
report="${here}/report-mimo-vs-deepseek.md"
work="$(mktemp -d)"
trap '/bin/rm -rf "${work}"' EXIT

# bench <name> <api base> <model> <op ref>
bench() {
  local key
  key="$(read_secret "$4")"
  BENCH_API_KEY="${key}" node "${here}/quant-ab.mjs" \
    --base "$2" --models "$3" --runs "${runs}" --out "${work}/$1.md"
}

bench mimo https://api.xiaomimimo.com/v1 mimo-v2.6-flash "${xiaomi_ref}"
bench deepseek https://api.deepseek.com/v1 deepseek-flash "${deepseek_ref}"

{
  printf '# MiMo-V2.6-Flash vs deepseek-flash\n\n'
  printf -- '- date: %s · runs/prompt: %s · each model on its own vendor API\n\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "${runs}"
  for name in mimo deepseek; do
    sed 's/^# /## /' "${work}/${name}.md"
    printf '\n'
  done
} >"${report}"
echo "wrote ${report}"
