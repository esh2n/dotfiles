#!/usr/bin/env bash
# MiMo against DeepSeek on this bench's prompts, each on its own vendor API
# (rules/decisions/2026-09-27-model-catalog-and-tier-assignment.md): TIER=flash (default) is
# mimo-v2.6-flash against deepseek-flash (the `main` tier), TIER=pro is
# mimo-v2.6-pro against deepseek-v4-pro (the `complex` tier).
# The keys come from 1Password through the same service account LiteLLM uses
# and reach quant-ab.mjs only as BENCH_API_KEY, never on a command line.
#
#   bash home/shared/litellm/config/bench/mimo-vs-deepseek.sh [runs]
#
# XIAOMI_REF / DEEPSEEK_REF override where the keys are; ONLY=mimo or
# ONLY=deepseek runs one side. MIMO_BASE overrides MiMo's endpoint: a
# pay-as-you-go key (sk-…) uses https://api.xiaomimimo.com/v1, a Token Plan key
# (tp-…) its plan's endpoint, e.g. https://token-plan-cn.xiaomimimo.com/v1
# (https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/../secrets.sh
source "${here}/../secrets.sh"
export_op_token

runs="${1:-2}"
tier="${TIER:-flash}"
case "${tier}" in
flash) mimo_model=mimo-v2.6-flash deepseek_model=deepseek-flash max_tokens=4096 ;;
# the pro models reason longer; 4096 tokens can cut them off mid-thought
pro) mimo_model=mimo-v2.6-pro deepseek_model=deepseek-v4-pro max_tokens=16384 ;;
*)
  echo "${0##*/}: TIER is flash or pro, not ${tier}" >&2
  exit 2
  ;;
esac
xiaomi_ref="${XIAOMI_REF:-op://llm-automation/xiaomi/credential}"
deepseek_ref="${DEEPSEEK_REF:-op://llm-automation/deepseek/credential}"
suffix=""
[ "${tier}" = flash ] || suffix="-${tier}"
report="${here}/report-mimo-vs-deepseek${suffix}${ONLY:+-${ONLY}}.md"
work="$(mktemp -d)"
trap '/bin/rm -rf "${work}"' EXIT

# bench <name> <api base> <model> <op ref>
bench() {
  local key
  key="$(read_secret "$4")"
  BENCH_API_KEY="${key}" node "${here}/quant-ab.mjs" \
    --base "$2" --models "$3" --runs "${runs}" --max-tokens "${max_tokens}" --out "${work}/$1.md"
}

# ONLY=mimo (or deepseek) runs one side, e.g. after fixing that side alone
only="${ONLY:-}"
names=()
if [ -z "${only}" ] || [ "${only}" = mimo ]; then
  bench mimo "${MIMO_BASE:-https://api.xiaomimimo.com/v1}" "${mimo_model}" "${xiaomi_ref}"
  names+=(mimo)
fi
if [ -z "${only}" ] || [ "${only}" = deepseek ]; then
  bench deepseek https://api.deepseek.com/v1 "${deepseek_model}" "${deepseek_ref}"
  names+=(deepseek)
fi

{
  printf '# %s vs %s\n\n' "${mimo_model}" "${deepseek_model}"
  printf -- '- date: %s · runs/prompt: %s · each model on its own vendor API\n\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "${runs}"
  for name in "${names[@]}"; do
    sed 's/^# /## /' "${work}/${name}.md"
    printf '\n'
  done
} >"${report}"
echo "wrote ${report}"
