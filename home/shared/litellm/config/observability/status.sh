#!/usr/bin/env bash
# One-screen status for the local LLM gateway: what it costs, how fast it
# answers, what is failing, and what to do about it.
#
# This exists because a dashboard you have to open and interpret is not the same
# as being told something is wrong. Same numbers as the dashboard and the alert
# rules, printed where a terminal is already looking.
#
# Exit code: 0 = ok, 1 = at least one alert is firing, 2 = Prometheus unreachable.
# That makes it usable as a check in a loop or a hook, not just as a read-out.
set -euo pipefail
cd "$(dirname "$0")"

PROM_URL="${PROM_URL:-http://127.0.0.1:9090}" exec python3 - <<'PY'
import json, os, sys, urllib.parse, urllib.request
from datetime import datetime

BASE = os.environ.get("PROM_URL", "http://127.0.0.1:9090")
WINDOW = "24h"


def api(path, params=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)


def q(expr):
    """Instant query -> list of (labels, float value). Empty on no data."""
    try:
        d = api("/api/v1/query", {"query": expr})
    except Exception:
        return []
    if d.get("status") != "success":
        return []
    out = []
    for r in d["data"]["result"]:
        try:
            out.append((r["metric"], float(r["value"][1])))
        except (KeyError, IndexError, ValueError):
            continue
    return out


def scalar(expr):
    r = q(expr)
    return r[0][1] if r else None


def fmt(v, spec="{:.4f}", dash="—"):
    return dash if v is None else spec.format(v)


def human(n, dash="—"):
    if n is None:
        return dash
    for unit, div in (("B", 1e9), ("M", 1e6), ("k", 1e3)):
        if abs(n) >= div:
            return f"{n / div:.2f}{unit}"
    return f"{n:.0f}"


try:
    api("/api/v1/status/buildinfo")
except Exception as e:
    print(f"Prometheus に接続できません（{BASE}）: {e}", file=sys.stderr)
    print("  → ./start.sh で起動してください。", file=sys.stderr)
    sys.exit(2)

now = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M %Z")
print(f"LLM ゲートウェイ 計測状況  {now}")
print()

# --- 取り込みの健全性 -------------------------------------------------------
print("取り込み")
targets = api("/api/v1/targets")["data"]["activeTargets"]
litellm = [t for t in targets if t["labels"].get("job") == "litellm"]
if not litellm:
    print("  [warn] litellm の取り込み対象がありません")
else:
    t = litellm[0]
    health = t["health"]
    err = t.get("lastError") or ""
    if health == "unknown":
        # Fresh start: no scrape has completed yet. Not a failure.
        print("  [info] litellm の取り込み: 初回の取り込み待ち（起動直後）")
    else:
        mark = "ok  " if health == "up" else "warn"
        print(f"  [{mark}] litellm の取り込み: {health}{(' — ' + err) if err else ''}")
# prometheus_tsdb_head_min_time is in MILLISECONDS (measured: 1789813928850
# while time() is ~1789813928), so it is divided before subtracting. Getting
# this wrong prints a coverage figure of minus half a billion hours.
secs_covered = scalar("time() - prometheus_tsdb_head_min_time / 1000")
if secs_covered is None:
    coverage = "—"
elif secs_covered < 3600:
    coverage = f"{secs_covered / 60:.1f} 分"
else:
    coverage = f"{secs_covered / 3600:.1f} 時間"
print(f"         保存済み: {coverage}の記録（保持上限 90日）")
if secs_covered is not None and secs_covered < 24 * 3600:
    print("         ※ 24時間分に達するまで、下の「直近24時間」は実際に記録できた範囲だけを反映します")

# --- 直近24時間の要約 -------------------------------------------------------
print()
print(f"直近24時間")
cost = scalar(f"sum(increase(litellm_spend_metric_total[{WINDOW}]))")
ok = scalar(f"sum(increase(litellm_deployment_success_responses_total[{WINDOW}]))")
fail = scalar(f"sum(increase(litellm_deployment_failure_responses_total[{WINDOW}]))")
tin = scalar(f"sum(increase(litellm_input_tokens_metric_total[{WINDOW}]))")
tout = scalar(f"sum(increase(litellm_output_tokens_metric_total[{WINDOW}]))")
ttft = scalar(
    "(sum(rate(litellm_llm_api_time_to_first_token_metric_sum[10m]))"
    " / clamp_min(sum(rate(litellm_llm_api_time_to_first_token_metric_count[10m])), 0.0001))"
)
base = scalar(
    "(sum(rate(litellm_llm_api_time_to_first_token_metric_sum[24h] offset 10m))"
    " / clamp_min(sum(rate(litellm_llm_api_time_to_first_token_metric_count[24h] offset 10m)), 0.0001))"
)
rate = scalar(
    "sum(rate(litellm_deployment_failure_responses_total[15m]))"
    " / clamp_min(sum(rate(litellm_deployment_success_responses_total[15m]))"
    " + sum(rate(litellm_deployment_failure_responses_total[15m])), 0.0001)"
)

print(f"  費用          ${fmt(cost)}")
print(f"  リクエスト    {fmt(ok, '{:.0f}')} 成功 / {fmt(fail, '{:.0f}')} 失敗"
      f"   失敗率 {fmt(rate, '{:.2%}')}（直近15分）")
print(f"  TTFT 平均     {fmt(ttft, '{:.3f}')} 秒     （24時間の基準 {fmt(base, '{:.3f}')} 秒）")
print(f"  トークン      入力 {human(tin)} / 出力 {human(tout)}")

# --- モデル別 ---------------------------------------------------------------
print()
print("別名別（直近24時間）")
reqs = {m.get("requested_model", "?"): v
        for m, v in q(f"sum by (requested_model) (increase(litellm_deployment_success_responses_total[{WINDOW}]))")}
ttfts = {m.get("requested_model", "?"): v for m, v in q(
    "sum by (requested_model) (rate(litellm_llm_api_time_to_first_token_metric_sum[10m]))"
    " / clamp_min(sum by (requested_model) (rate(litellm_llm_api_time_to_first_token_metric_count[10m])), 0.0001)")}
if reqs or ttfts:
    print(f"  {'別名':<14}{'リクエスト':>12}{'TTFT平均':>12}")
    for name in sorted(set(reqs) | set(ttfts)):
        print(f"  {name:<14}{fmt(reqs.get(name), '{:.0f}'):>12}{fmt(ttfts.get(name), '{:.3f}'):>11}s")
else:
    print("  （この窓にデータがありません）")

print()
print("実モデル別の費用（直近24時間）")
spend = {m.get("model") or m.get("api_provider") or "?": v
         for m, v in q(f"sum by (model) (increase(litellm_spend_metric_total[{WINDOW}]))")}
if spend:
    for name in sorted(spend, key=lambda k: -spend[k]):
        print(f"  {name:<18}${spend[name]:.4f}")
    print("  注: 費用の counter には別名(requested_model)が付かないため、別名との対応は")
    print("      main=deepseek-flash / complex=deepseek-v4-pro で読む（実測のラベル仕様）。")
else:
    print("  （記録なし）")

# --- 発火中のアラート -------------------------------------------------------
print()
alerts = api("/api/v1/alerts")["data"]["alerts"]
active = [a for a in alerts if a.get("state") in ("firing", "pending")]
if not active:
    print("発火中のアラート: なし")
    sys.exit(0)

firing = [a for a in active if a.get("state") == "firing"]
print(f"発火中のアラート: {len(active)} 件（firing {len(firing)}）")
for a in sorted(active, key=lambda x: (x.get("state") != "firing", x["labels"].get("alertname", ""))):
    lab, ann = a["labels"], a.get("annotations", {})
    state = a.get("state")
    print()
    print(f"  [{state}] {lab.get('alertname')}  (since {a.get('activeAt', '?')[:19]})")
    if ann.get("summary"):
        print(f"    {ann['summary']}")
    if ann.get("action"):
        print(f"    次の行動: {ann['action']}")
    if ann.get("caveat"):
        print(f"    但し: {ann['caveat']}")

sys.exit(1 if firing else 0)
PY
