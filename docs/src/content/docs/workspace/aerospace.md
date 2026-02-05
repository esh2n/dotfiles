---
title: AeroSpace
description: Tiling window manager の設定と keybinding。
---

macOS 用の tiling window manager。名前付き workspace でアプリを整理し、keyboard だけで window を操作する。

## Workspace 一覧

| Key | Workspace | アプリ |
|-----|-----------|--------|
| `W` | Work | Cursor, VSCode |
| `S` | Shell | Ghostty, Warp, WezTerm |
| `B` | Browser | Chrome, Safari, Firefox, Dia |
| `C` | Communication | Slack (sub monitor 推奨) |
| `M` | Music | Spotify, Apple Music |
| `N` | Notion | document |
| `D` | Discord | Discord |
| `G` | Gather | 予約枠 (floating mode) |
| `1-5` | 汎用 | 自由に使用 |

## Main mode

### Window 操作

| Key | 操作 |
|-----|------|
| `Alt+h/j/k/l` | focus 移動 (monitor をまたぐ) |
| `Alt+Shift+h/j/k/l` | workspace 内で window を移動 |

### Multi-monitor

| Key | 操作 |
|-----|------|
| `Alt+Ctrl+h/j/k/l` | window を別 monitor に移動 |
| `Alt+Ctrl+n` | 次の monitor に移動 (循環) |
| `Alt+Ctrl+p` | 前の monitor に移動 (循環) |

### Layout

| Key | 操作 |
|-----|------|
| `Alt+r` | tile layout (横並び) |
| `Alt+Shift+r` | accordion layout (重ね表示) |
| `Alt+t` | floating / tiling 切替 |
| `Alt+f` | fullscreen |

### Resize

| Key | 操作 |
|-----|------|
| `Alt+-` | size を 50 縮小 |
| `Alt+=` | size を 50 拡大 |

### Workspace 切替

| Key | 操作 |
|-----|------|
| `Alt+1-5` | workspace 1-5 に切替 |
| `Alt+w/b/c/g/m/n/s/d` | 名前付き workspace に切替 |
| `Alt+Tab` | 直前の workspace に戻る |
| `Alt+Shift+Tab` | workspace を次の monitor に移動 |

### Window を workspace に移動

| Key | 操作 |
|-----|------|
| `Alt+Shift+1-5` | workspace 1-5 に移動して追従 |
| `Alt+Shift+w/b/c/g/m/n/s/d` | 名前付き workspace に移動して追従 |

## Service mode

`Alt+Shift+;` で入る。

| Key | 操作 |
|-----|------|
| `Esc` | config reload して main mode に戻る |
| `r` | workspace tree の layout を reset |
| `f` | floating / tiling 切替 |
| `Backspace` | 現在以外の window をすべて閉じる |

## 設定メモ

- default layout は accordion (window 1 枚なら全面表示)
- アプリは専用の workspace に自動で割り当てられる
- padding: 上 52px (sketchybar 40px + 12px)、横 12px、縦 8px
- Gather は floating mode で、どの monitor にも自由に移動できる
- 各 monitor は独立した workspace を持つ
