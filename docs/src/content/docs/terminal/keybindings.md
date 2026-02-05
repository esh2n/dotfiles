---
title: Keybindings
description: tmux / WezTerm / Zellij で統一された keybinding。
---

tmux, WezTerm, Zellij の 3 つの terminal で共通の keybinding を使えるようにしている。prefix key は `Ctrl+q`。

## Pane 操作

| 操作 | Key | 備考 |
|------|-----|------|
| 横分割 | `Prefix + \` | |
| 縦分割 | `Prefix + -` | |
| pane 移動 | `Prefix + h/j/k/l` | |
| pane resize | `Prefix + H/J/K/L` | |
| pane 最大化 | `Prefix + z` | |
| floating 切替 | `Prefix + w` | Zellij のみ |
| 埋込/float 切替 | `Prefix + e` | Zellij のみ |
| pane を閉じる | `Prefix + x` | |

## Tab 操作

| 操作 | Key | 備考 |
|------|-----|------|
| 前の tab | `Ctrl+h` | prefix 不要 |
| 次の tab | `Ctrl+l` | prefix 不要 |
| Tab 1-5 | `Ctrl+1-5` | prefix 不要、Zellij のみ |
| 新規 tab | `Prefix + t` | Zellij のみ |
| 直前の tab | `Prefix + Tab` | tmux のみ |

## Copy / Scroll mode

| 操作 | Key | 備考 |
|------|-----|------|
| mode に入る | `Prefix + [` | WezTerm は `Prefix + c` |
| 移動 | `h/j/k/l`, `w/b/e`, `0/$` | Vim 式 |
| 半 page scroll | `Ctrl+u/d` | |
| 全 page scroll | `Ctrl+b/f` | |
| 検索 | `/` → `n/N` | `Ctrl+r` で match type 切替 |
| 選択開始 | `v` / `V` / `Ctrl+v` | 文字 / 行 / 矩形 |
| copy して終了 | `y` | clipboard に copy |
| mode を抜ける | `Esc` or `q` | |

## Session

| 操作 | Key |
|------|-----|
| detach | `Prefix + d` |

## Zellij plugin

| 操作 | Key | 説明 |
|------|-----|------|
| Monocle | `Prefix + f` | fuzzy finder |
| Harpoon | `Prefix + b` | pane bookmark 管理 |

## tmux session 復元

tmux-resurrect と tmux-continuum の設定。

- 15 分ごとに自動 save
- tmux 起動時に自動 restore
- 手動 save: `Prefix + Ctrl+s`
- 手動 restore: `Prefix + Ctrl+r`
- 復元対象: window, pane, working directory, 実行中 program (vim, nvim, ssh など)
- 保存先: `~/.tmux/resurrect/`

## Zellij session 管理

```bash
# session 一覧
zellij list-sessions

# session に attach
zellij attach <session-name>

# detach → Prefix + d

# session 削除
zellij delete-session <session-name>
```

Zellij の session は明示的に削除するまで残る。
