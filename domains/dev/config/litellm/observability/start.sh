#!/usr/bin/env bash
# Start the observability stack for the local LLM gateway.
#
# Default: Prometheus only. It is the half that stores data, and the gateway
# loses its counters on every restart, so Prometheus is the piece that must be
# up. Grafana renders what Prometheus stored and stores nothing itself, so it is
# opt-in with --ui.
#
# Runs from this directory (the repo checkout), not from a copy: this stack
# holds no secrets, so there is no reason to duplicate it. Contrast the gateway
# itself, which is deployed to ~/.config/litellm because it injects a key.
set -euo pipefail
cd "$(dirname "$0")"

PROM_URL="http://127.0.0.1:9090"
WITH_UI=0
for arg in "$@"; do
  case "$arg" in
    --ui) WITH_UI=1 ;;
    -h|--help)
      echo "usage: $0 [--ui]"
      echo "  (no args)  Prometheus だけ起動（常駐・保存担当）"
      echo "  --ui       Grafana も起動（見る用・保存はしない）"
      exit 0
      ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "docker が応答しません（OrbStack が起動しているか確認してください）" >&2
  exit 1
fi

# Prometheus first: restart policy `unless-stopped` keeps it up across Docker
# restarts, so this is normally a no-op.
docker compose up -d prometheus

printf 'Prometheus の起動を待っています'
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null --max-time 2 "$PROM_URL/-/ready"; then
    echo " — 起動"
    break
  fi
  printf '.'
  sleep 1
done

# Readiness is not the same as "is scraping". A target reports health
# "unknown" until its first scrape completes, so this waits for the first
# result instead of reading it one moment too early — otherwise a working stack
# prints a warning on every start, which is how real warnings get ignored.
printf 'litellm からの初回取り込みを待っています'
health="unknown"
for _ in $(seq 1 30); do
  health="$(curl -fsS --max-time 5 "$PROM_URL/api/v1/targets" 2>/dev/null \
    | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)["data"]["activeTargets"]
except Exception:
    print("unknown"); raise SystemExit
for t in d:
    if t["labels"].get("job")=="litellm":
        print(t["health"]); break
else:
    print("missing")
' 2>/dev/null || echo unknown)"
  # Wait until a scrape has actually happened. "unknown" means no scrape has
  # completed, and "missing" means the target is not registered yet — both are
  # "not ready", not "broken". Breaking out on either made this print a warning
  # on every clean start, and warnings that fire on success get ignored.
  [[ "$health" != "unknown" && "$health" != "missing" ]] && break
  printf '.'
  sleep 2
done
echo

case "$health" in
  up)      echo "[ok]   litellm の取り込み: 正常" ;;
  missing) echo "[warn] litellm の取り込み対象が見つかりません（prometheus.yml を確認）" ;;
  unknown) echo "[warn] litellm の初回取り込みが終わりません（ゲートウェイ停止中の可能性。status.sh で確認）" ;;
  *)       echo "[warn] litellm の取り込み: $health（ゲートウェイが落ちている可能性。status.sh で確認）" ;;
esac

echo "  保存データ: ${PROM_URL}/graph       （90日保持）"
echo "  取り込み状態: ${PROM_URL}/targets"

if [[ "$WITH_UI" == 1 ]]; then
  docker compose --profile ui up -d grafana
  printf 'Grafana の起動を待っています'
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:3000/api/health; then
      echo " — 起動"
      break
    fi
    printf '.'
    sleep 1
  done
  echo "  ダッシュボード: http://127.0.0.1:3000/d/litellm-gateway"
fi

echo
./status.sh
