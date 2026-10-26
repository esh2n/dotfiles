---
title: Keybindings
description: WezTerm / Zellij / Herdr で統一された keybinding。
---

WezTerm, Zellij, Herdrで共通のkeybindingを使えるようにしている。prefix keyは`Ctrl+q`。

Herdrは分割 (`Prefix + \` / `-`)・pane移動 (`Prefix + h/j/k/l`)・タブ移動 (`Alt+h`/`Alt+l`) を
この共通スキームに合わせている。Herdr固有のキー・エージェント連携は [Herdr](/dotfiles/terminal/herdr/) を参照。

## Pane操作

| 操作 | Key | 備考 |
|------|-----|------|
| 横分割 | `Prefix + \` | |
| 縦分割 | `Prefix + -` | |
| pane移動 | `Prefix + h/j/k/l` | |
| pane resize | `Prefix + H/J/K/L` | Zellijのみ。Herdrは`Prefix + r` |
| pane最大化 | `Prefix + z` | |
| floating切替 | `Prefix + w` | Zellijのみ |
| 埋込/float切替 | `Prefix + e` | Zellijのみ |
| paneを閉じる | `Prefix + x` | |

## Tab操作

| 操作 | Key | 備考 |
|------|-----|------|
| 前のtab | Zellij `Prefix + Shift+Tab`、WezTerm `Cmd+[`、Herdr `Alt+h` | |
| 次のtab | Zellij `Prefix + Tab`、WezTerm `Cmd+]`、Herdr `Alt+l` | |
| Tab 1-5 | `Ctrl+1-5` | prefix不要、Zellijのみ |
| 新規tab | `Prefix + t` | Zellijのみ |

## Copy / Scroll mode

| 操作 | Key | 備考 |
|------|-----|------|
| modeに入る | `Prefix + [` | WezTermは`Prefix + c` |
| 移動 | `h/j/k/l`, `w/b/e`, `0/$` | Vim式 |
| 半page scroll | `Ctrl+u/d` | |
| 全page scroll | `Ctrl+b/f` | |
| 検索 | `/` → `n/N` | `Ctrl+r`でmatch type切替 |
| 選択開始 | `v` / `V` / `Ctrl+v` | 文字 / 行 / 矩形 |
| copyして終了 | `y` | clipboardにcopy |
| modeを抜ける | `Esc` or `q` | |

## Session

| 操作 | Key | 備考 |
|------|-----|------|
| detach | `Prefix + d` | Zellijのみ。Herdrは`Prefix + q` |

## Zellij plugin

| 操作 | Key | 説明 |
|------|-----|------|
| Monocle | `Prefix + f` | fuzzy finder |
| zellij-pane-picker | `Prefix + b` | 星を付けたpaneに切替 |

## Zellij session管理

```bash
# session 一覧
zellij list-sessions

# session に attach
zellij attach <session-name>

# detach → Prefix + d

# session 削除
zellij delete-session <session-name>
```

Zellijのsessionは明示的に削除するまで残る。
