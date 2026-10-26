---
title: Borders
description: Active window を色付き border でハイライトする設定。
---

BordersはmacOSのactive windowにborderを描画するツール。AeroSpaceと組み合わせて、focusしているwindowを視覚的に区別する。

## 設定

| 項目 | 値 |
|------|------|
| Style | round |
| Width | 7.0px |
| HiDPI | off |
| Active color | テーマに連動 |
| Inactive color | テーマに連動 |

## テーマ連動

`bordersrc`は`colors.sh`をsourceしてactive/inactive colorを取得する。`theme-switch`で色が切り替わる。

```bash
source "$(dirname "$0")/colors.sh"

options=(
    style=round
    width=7.0
    hidpi=off
    active_color="$active_color"
    inactive_color="$inactive_color"
)

borders "${options[@]}"
```

## Workspace CLIとの連携

Bordersは`mado`のprofile切替で自動的にstart / stopされる
（omniwm profileでは停止）。個別操作には以下のaliasを使う。

| Command | 操作 |
|---------|------|
| `brdr` | Borders restart |
| `brds` | Borders start |
| `brdk` | Borders stop |
