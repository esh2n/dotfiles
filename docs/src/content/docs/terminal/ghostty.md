---
title: Ghostty
description: GPU accelerated な terminal emulator の設定。背景透過と blur を効かせた構成。
---

Ghostty は GPU accelerated な高速 terminal emulator。背景透過、blur、ligature 対応のフォント設定、quick terminal など。

## 外観

| 項目 | 値 |
|------|------|
| Font | JetBrainsMono Nerd Font (15pt) |
| Background opacity | 0.6 |
| Blur radius | 30 |
| Cursor | block, blink |
| Window theme | dark |
| Color space | Display P3 |
| Titlebar | hidden (macOS) |
| Window shadow | 有効 |

### Font の ligature

code の見た目を良くするために ligature を有効化している。

```ini
font-feature = +liga
font-feature = +calt
font-feature = +ss01 ~ +ss05
```

### Cell の調整

行間と underline の位置を微調整して可読性を上げている。

```ini
font-thicken = true
adjust-cell-height = 20%
adjust-underline-position = 10%
```

## Quick Terminal

`Cmd+Shift+Space` で画面上部から dropdown terminal を呼び出せる。autohide 付き。

```ini
quick-terminal-position = top
quick-terminal-animation-duration = 200ms
quick-terminal-autohide = true
```

## Shell integration

Fish shell との integration が有効。cursor, title, sudo の feature を使う。

```ini
shell-integration = fish
shell-integration-features = cursor,title,sudo
```

## Keybindings

### Tab / Window

| Key | 操作 |
|-----|------|
| `Cmd+T` | 新規 tab |
| `Cmd+Shift+T` | 新規 window |
| `Cmd+W` | tab を閉じる |
| `Cmd+1-9` | tab 1-9 に切替 |
| `Cmd+Tab` / `Cmd+Shift+Tab` | 次/前の tab |

### Split

| Key | 操作 |
|-----|------|
| `Cmd+D` | 右に split |
| `Cmd+Shift+D` | 下に split |
| `Cmd+Shift+矢印` | split 間の移動 |
| `Cmd+Alt+矢印` | split の resize |
| `Cmd+Shift+Enter` | split zoom toggle |

### Navigation

| Key | 操作 |
|-----|------|
| `Cmd+Left/Right` | 前/次の tab |
| `Cmd+Up/Down` | page scroll |
| `Shift+PageUp/Down` | page scroll |
| `Cmd+Home/End` | scroll to top/bottom |

### その他

| Key | 操作 |
|-----|------|
| `Cmd+K` | 画面 clear |
| `Cmd+Enter` | fullscreen toggle |
| `Cmd+Plus/Minus/0` | font size 変更/reset |
| `Cmd+Shift+,` | config reload |
| `Shift+Enter` | newline (Claude Code 対応) |

## Zellij との共存

Ghostty の `Alt+Left/Right` を unbind して、Zellij の keybinding と衝突しないようにしている。

```ini
keybind = alt+left=unbind
keybind = alt+right=unbind
```

## テーマ連動

`theme-switch` で切り替えると、`~/.config/ghostty/theme` ファイルが更新される。

## その他の設定

| 項目 | 値 |
|------|------|
| Scrollback | 50,000 行 |
| Mouse scroll multiplier | 3x |
| Clipboard read/write | 許可 |
| Mouse hide while typing | 有効 |
| Image storage | 320MB |
| Window save state | always |
