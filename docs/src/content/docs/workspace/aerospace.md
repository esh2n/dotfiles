---
title: AeroSpace
description: Tiling window manager の設定と keybinding。
---

macOS用のtiling window manager。名前付きworkspaceでアプリを整理し、keyboardだけでwindowを操作する。

## Workspace一覧

| Key | Workspace | アプリ |
|-----|-----------|--------|
| `W` | Work | Cursor, VSCode |
| `S` | Shell | Ghostty, Warp, WezTerm |
| `B` | Browser | Chrome, Safari, Firefox, Dia |
| `C` | Communication | Slack (sub monitor推奨) |
| `M` | Music | Spotify, Apple Music |
| `N` | Notion | document |
| `D` | Discord | Discord |
| `G` | Gather | 予約枠 (floating mode) |
| `1-5` | 汎用 | 自由に使用 |

## Main mode

### Window操作

| Key | 操作 |
|-----|------|
| `Alt+h/j/k/l` | focus移動 (monitorをまたぐ) |
| `Alt+Shift+h/j/k/l` | workspace内でwindowを移動 |

### Multi-monitor

| Key | 操作 |
|-----|------|
| `Alt+Ctrl+h/j/k/l` | windowを別monitorに移動 |
| `Alt+Ctrl+n` | 次のmonitorに移動 (循環) |
| `Alt+Ctrl+p` | 前のmonitorに移動 (循環) |

### Layout

| Key | 操作 |
|-----|------|
| `Alt+r` | tile layout (横並び) |
| `Alt+Shift+r` | accordion layout (重ね表示) |
| `Alt+t` | floating / tiling切替 |
| `Alt+f` | fullscreen |

### Resize

| Key | 操作 |
|-----|------|
| `Alt+-` | sizeを50縮小 |
| `Alt+=` | sizeを50拡大 |

### Workspace切替

| Key | 操作 |
|-----|------|
| `Alt+1-5` | workspace 1-5に切替 |
| `Alt+w/b/c/g/m/n/s/d` | 名前付きworkspaceに切替 |
| `Alt+Tab` | 直前のworkspaceに戻る |
| `Alt+Shift+Tab` | workspaceを次のmonitorに移動 |

### Windowをworkspaceに移動

| Key | 操作 |
|-----|------|
| `Alt+Shift+1-5` | workspace 1-5に移動して追従 |
| `Alt+Shift+w/b/c/g/m/n/s/d` | 名前付きworkspaceに移動して追従 |

## Service mode

入るキーは割り当てていない。`aerospace mode service`で入る。

| Key | 操作 |
|-----|------|
| `Esc` | config reloadしてmain modeに戻る |
| `Backspace` | 現在以外のwindowをすべて閉じる |

## 設定メモ

- default layoutはaccordion (window 1枚なら全面表示)
- アプリは専用のworkspaceに自動で割り当てられる
- padding: 上52px (sketchybar 40px + 12px)、横12px、縦8px
- Gatherはfloating modeで、どのmonitorにも自由に移動できる
- 各monitorは独立したworkspaceを持つ
