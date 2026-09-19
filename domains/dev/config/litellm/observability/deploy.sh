#!/usr/bin/env bash
# Deploy this stack to ~/.config/litellm/observability and check it for drift.
#
# Why a copy at all, when this stack holds no secrets? Because the container
# mounts must point at a path that outlives the checkout they were edited in —
# this stack was written in a git worktree, and a worktree gets deleted. The
# sibling gateway in ../ is deployed the same way for a different reason (it
# injects a key at launch), so both halves of the stack now live under one
# directory.
#
# The cost of a copy is drift, so `--check` exists: it diffs the deployed copy
# against this checkout and exits 1 on any difference. The long-term fix is a
# symlink instead of a copy, which the jig rebuild is meant to bring.
#
#   ./deploy.sh           deploy (copy this checkout over the deployed copy)
#   ./deploy.sh --check   compare only; exit 1 if they differ
#
# Two details that are not obvious, both learned by breaking them:
#
#   1. Files are copied IN PLACE (never removed and recreated). prometheus.yml
#      and alerts.yml are bind-mounted as single files, and a single-file bind
#      mount follows the inode: `rm` + `cp` leaves the container holding a
#      deleted file, so the next `POST /-/reload` fails with "no such file or
#      directory" while the process keeps running happily on what it already
#      read. Copying over the path keeps the inode and the mount alive.
#   2. After copying, any service already running from the deployed directory is
#      recreated. That is what repairs a mount that was broken by an earlier
#      deploy, and it is cheap: Prometheus' 90 days of samples live in a Docker
#      volume, so a recreate loses only the samples in flight.
set -euo pipefail
cd "$(dirname "$0")"

SRC="$(pwd)"
DEST="$HOME/.config/litellm/observability"

# Only the definitions are deployed. Prometheus' 90 days of samples live in a
# Docker volume, not here, so a redeploy never touches stored history.
ITEMS=(docker-compose.yml prometheus grafana deploy.sh start.sh stop.sh status.sh test.sh README.md)

if [[ "${1:-}" == "--check" ]]; then
  if [[ ! -d "$DEST" ]]; then
    echo "[fail] 配備先がありません: $DEST（./deploy.sh を実行してください）"
    exit 1
  fi
  drift=0
  for item in "${ITEMS[@]}"; do
    [[ -e "$SRC/$item" ]] || continue
    if ! diff -rq "$SRC/$item" "$DEST/$item" >/dev/null 2>&1; then
      echo "[fail] 差分: $item"
      diff -rq "$SRC/$item" "$DEST/$item" 2>&1 | sed 's/^/       /' | head -5
      drift=1
    fi
  done
  if [[ $drift == 0 ]]; then
    echo "[ok] 配備済みコピーはこのチェックアウトと一致しています"
    exit 0
  fi
  echo
  echo "解消するには ./deploy.sh を実行してください（編集は必ずこのチェックアウト側で行う）。"
  exit 1
fi

if [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--check]" >&2
  exit 2
fi

mkdir -p "$DEST"
for item in "${ITEMS[@]}"; do
  [[ -e "$SRC/$item" ]] || continue
  if [[ -d "$SRC/$item" ]]; then
    # Copy the contents, do not replace the directory itself.
    mkdir -p "$DEST/$item"
    cp -R "$SRC/$item/." "$DEST/$item/"
  else
    cp "$SRC/$item" "$DEST/$item"
  fi
done
chmod +x "$DEST"/*.sh 2>/dev/null || true

echo "配備しました: $DEST"

# Recreate whatever is running from here, so bind mounts always match the copy
# that was just written. Services that are not running stay not running.
if [[ -f "$DEST/docker-compose.yml" ]] && docker info >/dev/null 2>&1; then
  running="$(cd "$DEST" && docker compose --profile ui ps --services --status running 2>/dev/null || true)"
  if [[ -n "$running" ]]; then
    echo "起動中のサービスを作り直します: $(echo $running | tr '\n' ' ')"
    (cd "$DEST" && docker compose --profile ui up -d --force-recreate $running >/dev/null)
    echo "  完了（Prometheus の保存データはボリューム側なので残ります）"
  else
    echo "起動するには: cd \"$DEST\" && ./start.sh --ui"
  fi
else
  echo "起動するには: cd \"$DEST\" && ./start.sh --ui"
fi
