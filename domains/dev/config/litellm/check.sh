#!/usr/bin/env bash
# Does the home-LLM stack actually answer? One real round trip per tier plus
# the plumbing around it, printed as PASS / FAIL lines. Nothing here is
# inferred from logs or config: every line is a request made now.
#
# Ruling: rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md
# Run by hand (`bash domains/dev/config/litellm/check.sh`) or at the end of
# `make update` (domains/dev/install.sh, section 5). Exit code = number of FAILs.
#
# What is probed follows what this machine offers: --lmstudio (LM Studio's
# server and `tailscale serve 1234`), --console (Prometheus, Grafana, Open
# WebUI, `tailscale serve 3001`; without it, `tailscale serve 4001` for the
# console's scrape). Every machine gets its own LiteLLM and the tiers through
# it. The old layout's --role hub|node means both|neither.
#
# What it costs: one tiny prompt to `main` (DeepSeek, a fraction of a cent);
# `deterministic` is local and free. `complex` is not exercised by default
# (it is the escalation tier; pass --complex to include it).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/etc/profiles/per-user/$(id -un)/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
WITH_COMPLEX=0
ROLE=""
LMSTUDIO=""
CONSOLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --complex) WITH_COMPLEX=1 ;;
    --role) ROLE="${2:-}"; shift ;;
    --lmstudio) LMSTUDIO=1 ;;
    --console) CONSOLE=1 ;;
    *) echo "usage: check.sh [--complex] [--lmstudio] [--console] | [--role hub|node]" >&2; exit 2 ;;
  esac
  shift
done
case "$ROLE" in hub|node|"") ;; *) echo "check.sh: role must be hub or node, not ${ROLE}" >&2; exit 2 ;; esac

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
# What this machine offers decides what is probed. next passes it as
# --lmstudio / --console (the machine's roles); --role hub|node is the old
# layout's name for both / neither; with nothing, guess as the old installer
# did: the Mac with LM Studio.app is both.
if [ -n "${LMSTUDIO}${CONSOLE}" ]; then
  LMSTUDIO="${LMSTUDIO:-0}"; CONSOLE="${CONSOLE:-0}"
  ROLE="$( { [ "$LMSTUDIO" = 1 ] && printf 'lmstudio '; [ "$CONSOLE" = 1 ] && printf 'console'; } | sed 's/ $//')"
else
  if [ -z "$ROLE" ]; then
    ROLE=node; [ "$(uname -s)" = Darwin ] && [ -d "/Applications/LM Studio.app" ] && ROLE=hub
  fi
  if [ "$ROLE" = hub ]; then LMSTUDIO=1; CONSOLE=1; else LMSTUDIO=0; CONSOLE=0; fi
fi
echo "home-llm check (${ROLE})"

# --- LM Studio (hub): the model server itself ------------------------------
if [ "$LMSTUDIO" = 1 ]; then
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
  body="$(curl -s --max-time 120 -A home-llm-check -H "Authorization: Bearer ${KEY}" -H 'content-type: application/json' \
    -d "{\"model\":\"${tier}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: pong\"}],\"max_tokens\":64}" \
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

# --- LM Studio (hub): the context window the model is really loaded with -----
# Probed AFTER `ask deterministic` on purpose: LM Studio loads a model
# just-in-time on the first request and unloads it after its idle TTL, so
# before the completion above /api/v0/models may list every model as
# "not-loaded" (measured 2026-09-24: FAIL here while the tier answered in 2.7s).
# loaded_context_length is the number the deterministic tier's contextWindow
# in policy/tiers.json must not exceed.
if [ "$LMSTUDIO" = 1 ]; then
  ctx="$(curl -sf --max-time 5 http://127.0.0.1:1234/api/v0/models 2>/dev/null | python3 -c '
import json,sys
for m in json.load(sys.stdin).get("data",[]):
    if m.get("state")=="loaded": print(f"{m[\"id\"]}: loaded={m.get(\"loaded_context_length\")} max={m.get(\"max_context_length\")}")
' 2>/dev/null | tr "\n" ";")"
  [ -n "$ctx" ] && pass "LM Studio loaded context: ${ctx}" || fail "LM Studio: no model loaded even after the deterministic completion (JIT load failed, or /api/v0/models is off)"
fi

# --- omp sees the proxy tiers? (the same key the omp() wrapper hands over) ---
if command -v omp >/dev/null 2>&1 && [ -n "$KEY" ]; then
  # --json, then the provider field: the text listing does not print "proxy/<id>" (measured 2026-09-23: 0 matches while the picker showed all three).
  seen="$(LITELLM_API_KEY="$KEY" timeout 30 omp models ls --json 2>/dev/null | python3 -c '
import json, sys
def walk(o):
    if isinstance(o, dict):
        if o.get("provider") == "proxy" and isinstance(o.get("id"), str): yield o["id"]
        for v in o.values(): yield from walk(v)
    elif isinstance(o, list):
        for v in o: yield from walk(v)
print(" ".join(sorted(set(walk(json.load(sys.stdin))))))
' 2>/dev/null)"
  case "$seen" in
    *complex*deterministic*main*) pass "omp lists the proxy tiers: ${seen}" ;;
    *) fail "omp does not list proxy/{main,complex,deterministic} (models.yml provider, or key) — got: ${seen:-none}" ;;
  esac
fi
if curl -sf --max-time 3 -o /dev/null http://127.0.0.1:4100/health 2>/dev/null; then
  pass "jig decision service :4100 answers (skill selection)"
else
  fail "jig decision service :4100 not answering — skill selection is off until it is (launchctl print gui/\$(id -u)/com.esh2n.jig-decision)"
fi

# --- metrics: the dedicated listener and the Prometheus that scrapes it ------
# The dedicated listener's documented probes: /health (no auth) and /metrics/ with the
# trailing slash (https://docs.litellm.ai/docs/proxy/prometheus). /metrics without the
# slash is not a contract, and the check that used it failed against a healthy listener
# (measured 2026-09-23).
if curl -sf --max-time 5 http://127.0.0.1:4001/health 2>/dev/null | grep -q healthy; then
  series="$(curl -sf --max-time 5 http://127.0.0.1:4001/metrics/ 2>/dev/null | grep -c '^litellm_')"
  pass "LiteLLM :4001 metrics listener healthy (${series:-0} litellm_* series)"
else
  fail "LiteLLM :4001 metrics listener not answering /health"
fi
if [ "$CONSOLE" = 1 ]; then
  # LiteLLM was just restarted by make update; Prometheus's last scrape may have
  # hit the gap. Give it a few scrape intervals before calling the target down.
  health=""
  for _ in $(seq 1 12); do
    health="$(curl -sf --max-time 5 http://127.0.0.1:9090/api/v1/targets 2>/dev/null | python3 -c '
import json,sys
for t in json.load(sys.stdin)["data"]["activeTargets"]:
    if t["labels"].get("job")=="litellm": print(t["health"], t["scrapeUrl"]); break
' 2>/dev/null)"
    case "$health" in up*|"") break ;; esac
    sleep 5
  done
  case "$health" in
    up*) pass "Prometheus scrapes litellm: ${health}" ;;
    "") fail "Prometheus :9090 not answering (observability/start.sh)" ;;
    *) fail "Prometheus litellm target: ${health}" ;;
  esac
  if curl -sf --max-time 5 -o /dev/null http://127.0.0.1:3000/api/health 2>/dev/null; then pass "Grafana :3000 answers (resident since 2026-09-24)"; else fail "Grafana :3000 not answering (observability/start.sh --ui)"; fi
  # A fresh Open WebUI (new data volume) takes tens of seconds to first answer; wait up to 2 min.
  webui=0
  for _ in $(seq 1 60); do curl -sf --max-time 2 -o /dev/null http://127.0.0.1:3001/ 2>/dev/null && { webui=1; break; }; sleep 2; done
  if [ "$webui" = 1 ]; then pass "Open WebUI :3001 answers"; else fail "Open WebUI :3001 not answering within 2 min (docker logs litellm-open-webui)"; fi
fi

# --- tailnet exposure -------------------------------------------------------
TS_BIN="$(command -v tailscale || true)"
[ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -n "$TS_BIN" ]; then
  serve="$(timeout 10 "$TS_BIN" serve status 2>/dev/null || true)"
  name="$(timeout 10 "$TS_BIN" status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
  if [ "$LMSTUDIO" = 1 ]; then
    printf '%s' "$serve" | grep -q ':1234' && pass "tailscale serve tcp:1234 (LM Studio) → ${name:-?}:1234" || fail "tailscale serve tcp:1234 missing"
  fi
  if [ "$CONSOLE" = 1 ]; then
    printf '%s' "$serve" | grep -q ':5432' && pass "tailscale serve tcp:5432 (cost ledger) → ${name:-?}:5432" || fail "tailscale serve tcp:5432 missing (the other machines cannot ship spend to the ledger)"
    printf '%s' "$serve" | grep -q ':3001' && pass "tailscale serve https:3001 (Open WebUI) → https://${name:-?}:3001" || fail "tailscale serve https:3001 missing (HTTPS certificates enabled in the admin console?)"
    # Which devices are on the tailnet right now: the phone must be one of them before the page can open there.
    peers="$(timeout 10 "$TS_BIN" status 2>/dev/null | awk 'NR>0 && $2 != "" {print $2 " (" $4 ")"}' | grep -v "^$(hostname -s)" | tr '\n' ',' | sed 's/,$//')"
    if [ -n "$peers" ]; then pass "tailnet devices besides this Mac: ${peers}"; else fail "no other device on the tailnet — the phone has not joined (Tailscale app, same account, switched on)"; fi
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
