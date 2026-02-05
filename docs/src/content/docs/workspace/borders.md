---
title: Borders
description: Active window を色付き border でハイライトする設定。
---

Borders は macOS の active window に border を描画するツール。AeroSpace と組み合わせて、focus している window を視覚的に区別する。

## 設定

| 項目 | 値 |
|------|------|
| Style | round |
| Width | 7.0px |
| HiDPI | on |
| Active color | テーマに連動 |
| Inactive color | テーマに連動 |

## テーマ連動

`bordersrc` は `colors.sh` を source して active/inactive color を取得する。`theme-switch` で色が切り替わる。

```bash
source "$(dirname "$0")/colors.sh"

options=(
    style=round
    width=7.0
    hidpi=on
    active_color="$active_color"
    inactive_color="$inactive_color"
)

borders "${options[@]}"
```

## Workspace CLI との連携

`ws` コマンド (Workspace CLI) から Borders の start / stop / restart を制御できる。

| Command | 操作 |
|---------|------|
| `brdr` | Borders restart |
| `brds` | Borders start |
| `brdk` | Borders stop |
