---
title: tmux
description: Catppuccin ベースの status bar と Spotify 連携を組み込んだ tmux の設定。
---

Zellij と並行して使える tmux の設定。prefix key の統一、vi-mode の copy、session の自動復元、カスタム status bar を含む。

## Prefix key

prefix は `Ctrl+q` に変更している（Zellij と統一）。

```bash
unbind C-b
set -g prefix C-q
```

## Keybindings

### Prefix なし

| Key | 操作 |
|-----|------|
| `Ctrl+h` | 前の window |
| `Ctrl+l` | 次の window |

### Prefix mode (`Ctrl+q` →)

| Key | 操作 |
|-----|------|
| `\` | 右に分割 |
| `-` | 下に分割 |
| `h`/`j`/`k`/`l` | pane 間のフォーカス移動 |
| `H`/`J`/`K`/`L` | pane の resize |
| `z` | pane zoom (全画面) |
| `x` | pane を閉じる |
| `Tab` | 直前の window に切替 |
| `[` | copy mode に入る |
| `?` | keybindings help popup |

### Copy mode (vi-style)

| Key | 操作 |
|-----|------|
| `v` | 選択開始 |
| `y` | copy (pbcopy 経由) |
| `H` | 行頭 |
| `L` | 行末 |
| `Escape` | cancel |

### Spotify 操作

| Key | 操作 |
|-----|------|
| `p` | 再生/一時停止 |
| `]` | 次の曲 |
| `P` | 前の曲 |

## Plugins

TPM (Tmux Plugin Manager) で管理。

| Plugin | 説明 |
|--------|------|
| tmux-sensible | 安全な default 設定 |
| tmux-yank | system clipboard 連携 |
| tmux-battery | battery 残量表示 |
| tmux-cpu | CPU usage 表示 |
| tmux-weather | 天気情報 |
| tmux-net-speed | network speed 表示 |
| tmux-resurrect | session の保存/復元 |
| tmux-continuum | 自動 save (15 分間隔) と自動 restore |
| catppuccin/tmux | Catppuccin テーマ |

## Session の自動復元

tmux-resurrect と tmux-continuum で session を自動保存・復元する。

- 15 分間隔で自動 save
- tmux 起動時に自動 restore
- vim/nvim の session も復元
- pane の内容も保持
- ssh, node, python, go, cargo などの process も復元対象

## Status bar

Catppuccin Mocha ベースの pill-style status bar。左に session 名、右に各種情報を表示する。

### 表示内容

| Item | 説明 |
|------|------|
| Session 名 | 左端に ghost icon 付き |
| Spotify | 再生中の曲名 |
| Help icon | click で keybindings popup |
| 天気 | 気温と天気 icon |
| 気圧 | hPa 表示 |
| 降水確率 | 傘 icon 付き |
| Network | 接続状態 |
| 地震情報 | 最新の地震速報 |
| Battery | 残量 |
| CPU | usage % |
| 時刻 | HH:MM |

### Window tabs

pill 型の window tab。active tab は青背景、inactive は暗い背景で表示。

## テーマ連動

`theme-switch` コマンドで切り替えると `~/.config/tmux/themes/current.conf` が更新され、tmux のテーマも自動で変わる。

## 設定

基本的な設定値。

| 項目 | 値 |
|------|------|
| Default terminal | tmux-256color |
| True color | RGB 対応 |
| History limit | 50,000 行 |
| Mouse | 有効 |
| Base index | 1 (0 ではなく 1 始まり) |
| Shell | /opt/homebrew/bin/zsh |
