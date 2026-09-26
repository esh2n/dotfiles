#!/usr/bin/env bash
# Verify the alert rules: syntax, PromQL, and behaviour.
#
# Three checks, cheapest first:
#   1. promtool check rules   — YAML and PromQL parse, names are legal
#   2. promtool test rules    — synthetic series: does the alert fire when it
#                               should, and stay quiet when a guard says so
#   3. live rules endpoint    — what the running Prometheus actually loaded
#
# Step 2 is the one that matters. A rule can load cleanly, evaluate without
# error, and still never fire (or fire on everything), and nothing in the
# Prometheus UI would tell you.
set -euo pipefail
cd "$(dirname "$0")"

PROM_IMAGE="prom/prometheus:v3.14.0"
PROM_RUNTIME_URL="${PROM_URL:-http://127.0.0.1:9090}"
fail=0

echo "1. ルールと設定の構文"
# `check rules` and `test rules` read the files from the mount. `check config`
# is different: prometheus.yml names its rule file by the container path it will
# have when running, so that exact path has to exist for the check to resolve.
docker run --rm -v "$PWD/prometheus":/p --entrypoint promtool "$PROM_IMAGE" \
  check rules /p/alerts.yml || fail=1
docker run --rm \
  -v "$PWD/prometheus/prometheus.yml":/etc/prometheus/prometheus.yml:ro \
  -v "$PWD/prometheus/alerts.yml":/etc/prometheus/alerts.yml:ro \
  --entrypoint promtool "$PROM_IMAGE" check config /etc/prometheus/prometheus.yml || fail=1

echo
echo "2. 挙動（発火する場合／ガードで発火しない場合）"
docker run --rm -v "$PWD/prometheus":/p --entrypoint promtool "$PROM_IMAGE" \
  test rules /p/alerts.test.yml || fail=1

echo
echo "3. 稼働中の Prometheus が読み込んでいるルール"
# Queried from Python rather than curl | python3 -c, so the quoting inside
# f-strings stays readable and the URL is fetched where it is parsed.
if python3 - "$PROM_RUNTIME_URL" <<'PY'
import json, sys, urllib.request
base = sys.argv[1]
try:
    with urllib.request.urlopen(base + "/api/v1/rules", timeout=5) as r:
        groups = json.load(r)["data"]["groups"]
except Exception as e:
    print("  [skip] Prometheus が起動していません（./start.sh で起動すると確認できます）")
    print("         (%s)" % e)
    sys.exit(2)
count = 0
for g in groups:
    for rule in g["rules"]:
        count += 1
        name = rule["name"]
        health = rule.get("health")
        state = rule.get("state")
        mark = "ok  " if health == "ok" else "warn"
        line = "  [%s] %-18s state=%s for=%s health=%s" % (mark, name, state, rule.get("duration"), health)
        print(line)
        if health != "ok":
            print("          lastError: %s" % rule.get("lastError"))
print("  %d ルール" % count)
PY
then
  :
else
  status=$?
  if [[ $status != 2 ]]; then fail=1; fi
fi

echo
if [[ $fail == 0 ]]; then
  echo "結果: OK"
else
  echo "結果: 失敗があります" >&2
fi
exit $fail
