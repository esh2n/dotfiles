#!/usr/bin/env bash
# Does the home-LLM stack actually answer? One real round trip per tier plus
# the plumbing around it, printed as PASS / FAIL lines. Nothing here is
# inferred from logs or config: every line is a request made now.
#
# Ruling: rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md
# Run by hand (`bash domains/dev/config/litellm/check.sh`) or at the end of
# `make update` (domains/dev/install.sh, section 5). Exit code = number of FAILs.
#
# Roles: on the hub (the Mac with LM Studio.app) every line applies. On a
# node (any machine without LM Studio) only what the ruling puts there is
# checked — its own LiteLLM, the tiers through it (deterministic reaches the
# hub over the tailnet), its metrics port and `tailscale serve 4001`; no
# local model, no Prometheus, no Open WebUI is expected or probed.
#
# What it costs: one tiny prompt to `main` (DeepSeek, a fraction of a cent);
# `deterministic` is local and free. `complex` is not exercised by default
# (it is the escalation tier; pass --complex to include it).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/etc/profiles/per-user/$(id -un)/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
WITH_COMPLEX=0
[ "${1:-}" = "--complex" ] && WITH_COMPLEX=1

# Every line is also appended, uncoloured and timestamped, to a log the owner
# (or an agent reading the machine later) can consult without re-running the
# probes: ${XDG_STATE_HOME:-~/.local/state}/home-llm/check.log
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/home-llm"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG="${LOG_DIR}/check.log"
{ echo ""; echo "== $(date '+%Y-%m-%d %H:%M:%S %Z') $(hostname -s) =="; } >>"$LOG" 2>/dev/null || true
FAILS=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; echo "PASS $*" >>"$LOG" 2>/dev/null || true; }
fail() { FAILS=$((FAILS + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$*"; echo "FAIL $*" >>"$LOG" 2>/dev/null || true; }
ROLE=node; [ "$(uname -s)" = Darwin ] && [ -d "/Applications/LM Studio.app" ] && ROLE=hub
echo "home-llm check (${ROLE})"

# --- LM Studio (hub): the model server itself ------------------------------
if [ "$ROLE" = hub ]; then
  models="$(curl -sf --max-time 5 http://127.0.0.1:1234/v1/models 2>/dev/null | python3 -c 'import json,sys; print(" ".join(m["id"] for m in json.load(sys.stdin)["data"]))' 2>/dev/null)"
  if [ -n "$models" ]; then pass "LM Studio :1234 lists: ${models}"; else fail "LM Studio :1234 does not answer /v1/models (server off, or no model loaded)"; fi
fi

# --- LiteLLM: key, tier list, one real completion per tier -------------------
KEY="$("${HERE}/proxy-key.sh" 2>/dev/null || true)"
if [ -z "$KEY" ]; then
  fail "LiteLLM master key unresolved (proxy-key.sh: Keychain item litellm-op-token → op read)"
else
  pass "LiteLLM master key resolved"
fi
tiers="$(curl -sf --max-time 5 -H "Authorization: Bearer ${KEY}" http://127.0.0.1:4000/v1/models 2>/dev/null | python3 -c 'import json,sys; print(" ".join(sorted(m["id"] for m in json.load(sys.stdin)["data"])))' 2>/dev/null)"
case "$tiers" in
  *complex*deterministic*main*) pass "LiteLLM :4000 tiers: ${tiers}" ;;
  "") fail "LiteLLM :4000 /v1/models does not answer (job down, or wrong key)" ;;
  *) fail "LiteLLM :4000 tiers incomplete: ${tiers:-none}" ;;
esac

ask() {  # ask <tier> — one short completion; prints reply and wall time
  local tier="$1" t0 t1 body reply
  t0="$(date +%s.%N)"
  body="$(curl -s --max-time 120 -H "Authorization: Bearer ${KEY}" -H 'content-type: application/json' \
    -d "{\"model\":\"${tier}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}],\"max_tokens\":16}" \
    http://127.0.0.1:4000/v1/chat/completions 2>/dev/null)"
  t1="$(date +%s.%N)"
  reply="$(printf '%s' "$body" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["choices"][0]["message"]["content"].strip().replace("\n"," ")[:60] + "  [" + d.get("model","?") + "]")' 2>/dev/null)"
  if [ -n "$reply" ]; then
    pass "tier ${tier}: \"${reply}\" in $(printf '%.1f' "$(echo "$t1 - $t0" | bc)")s"
  else
    fail "tier ${tier}: no completion — $(printf '%s' "$body" | head -c 200)"
  fi
}
# `deterministic` on a node is the round trip that matters most there: the
# node's own LiteLLM → the hub's LM Studio over the tailnet (litellm-up.sh's
# LM_STUDIO_REMOTE_HOST). A node never needs a local model.
[ -n "$KEY" ] && { ask deterministic; ask main; [ "$WITH_COMPLEX" = 1 ] && ask complex; }

# --- omp sees the proxy tiers? (the same key the omp() wrapper hands over) ---
if command -v omp >/dev/null 2>&1 && [ -n "$KEY" ]; then
  seen="$(LITELLM_API_KEY="$KEY" timeout 30 omp models ls proxy 2>/dev/null | grep -o -E 'proxy/(main|complex|deterministic)' | sort -u | tr '\n' ' ')"
  case "$seen" in
    *complex*deterministic*main*) pass "omp lists the proxy tiers: ${seen}" ;;
    *) fail "omp does not list proxy/{main,complex,deterministic} (models.yml provider, or key) — got: ${seen:-none}" ;;
  esac
fi
if curl -sf --max-time 3 -o /dev/null http://127.0.0.1:4100/health 2>/dev/null; then
  pass "jig decision service :4100 answers (tier routing for pi/omp)"
else
  fail "jig decision service :4100 not answering — tier routing falls back to the current model (launchctl print gui/\$(id -u)/com.esh2n.jig-decision)"
fi

# --- metrics: the dedicated listener and the Prometheus that scrapes it ------
if curl -sf --max-time 5 http://127.0.0.1:4001/metrics 2>/dev/null | grep -q '^litellm_'; then
  pass "LiteLLM :4001 exposes litellm_* metrics"
else
  fail "LiteLLM :4001 metrics listener not answering"
fi
if [ "$ROLE" = hub ]; then
  health="$(curl -sf --max-time 5 http://127.0.0.1:9090/api/v1/targets 2>/dev/null | python3 -c '
import json,sys
for t in json.load(sys.stdin)["data"]["activeTargets"]:
    if t["labels"].get("job")=="litellm": print(t["health"], t["scrapeUrl"]); break
' 2>/dev/null)"
  case "$health" in
    up*) pass "Prometheus scrapes litellm: ${health}" ;;
    "") fail "Prometheus :9090 not answering (observability/start.sh)" ;;
    *) fail "Prometheus litellm target: ${health}" ;;
  esac
  if curl -sf --max-time 5 -o /dev/null http://127.0.0.1:3001/ 2>/dev/null; then pass "Open WebUI :3001 answers"; else fail "Open WebUI :3001 not answering (docker compose --profile webui up -d open-webui)"; fi
fi

# --- tailnet exposure -------------------------------------------------------
TS_BIN="$(command -v tailscale || true)"
[ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -n "$TS_BIN" ]; then
  serve="$(timeout 10 "$TS_BIN" serve status 2>/dev/null || true)"
  name="$(timeout 10 "$TS_BIN" status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
  if [ "$ROLE" = hub ]; then
    printf '%s' "$serve" | grep -q ':1234' && pass "tailscale serve tcp:1234 (LM Studio) → ${name:-?}:1234" || fail "tailscale serve tcp:1234 missing"
    printf '%s' "$serve" | grep -q ':3001' && pass "tailscale serve https:3001 (Open WebUI) → https://${name:-?}:3001" || fail "tailscale serve https:3001 missing (HTTPS certificates enabled in the admin console?)"
    echo "       from the phone (on the tailnet): open https://${name:-<mac>}:3001 — that is the one check only another device can make"
  else
    printf '%s' "$serve" | grep -q ':4001' && pass "tailscale serve tcp:4001 (metrics) → ${name:-?}:4001" || fail "tailscale serve tcp:4001 missing"
  fi
else
  fail "tailscale CLI not found"
fi

echo "home-llm check: ${FAILS} FAIL  (log: ${LOG})"
echo "TOTAL ${FAILS} FAIL" >>"$LOG" 2>/dev/null || true
exit "$FAILS"
