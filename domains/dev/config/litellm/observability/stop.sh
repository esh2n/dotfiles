#!/usr/bin/env bash
# Stop the observability stack. Data is kept.
#
# `docker compose down` removes the containers but not the named volumes, so the
# stored history survives. `down -v` would delete it — that is the one command
# that throws away the reason this stack exists, so it is not offered as a flag
# here. If you ever really mean it:
#   docker volume rm litellm-observability_prometheus-data
set -euo pipefail
cd "$(dirname "$0")"

docker compose --profile ui down

cat <<'EOF'

停止しました。保存データ（Prometheus の90日分）は残っています。
注意: 止まっている間、ゲートウェイの数値は取り込まれません。ゲートウェイ側は
      プロセス内カウンタなので、その間に再起動が起きると、その区間の履歴は
      復元できません（次回 start.sh 以降が再び記録されます）。
EOF
