---
title: Ghostty
description: GPU accelerated な terminal emulator の設定。背景透過と blur を効かせた構成。
---

GhosttyはGPU acceleratedな高速terminal emulator。背景透過、blur、ligature対応のフォント設定、quick terminalなど。

## 外観

| 項目 | 値 |
|------|------|
| Font | JetBrainsMono Nerd Font (15pt) |
| Background opacity | 0.8 |
| Blur radius | 30 |
| Cursor | block, blink |
| Window theme | dark |
| Color space | Display P3 |
| Titlebar | hidden (macOS) |
| Window shadow | 有効 |

### Fontのligature

codeの見た目を良くするためにligatureを有効化している。

```ini
font-feature = +liga
font-feature = +calt
font-feature = +ss01 ~ +ss05
```

### Cellの調整

行間とunderlineの位置を微調整して可読性を上げている。

```ini
font-thicken = true
adjust-cell-height = 20%
adjust-underline-position = 10%
```

## Quick Terminal

`Cmd+Shift+Space`で画面上部からdropdown terminalを呼び出せる。autohide付き。

```ini
quick-terminal-position = top
quick-terminal-animation-duration = 200ms
quick-terminal-autohide = true
```

## Shell integration

Zshとのintegrationが有効。cursor, title, sudoのfeatureを使う。

```ini
shell-integration = zsh
shell-integration-features = cursor,title,sudo
```

## Keybindings

### Tab / Window

| Key | 操作 |
|-----|------|
| `Cmd+T` | 新規tab |
| `Cmd+Shift+T` | 新規window |
| `Cmd+W` | tabを閉じる |
| `Cmd+1-9` | tab 1-9に切替 |
| `Cmd+Tab` / `Cmd+Shift+Tab` | 次/前のtab |

### Split

| Key | 操作 |
|-----|------|
| `Cmd+D` | 右にsplit |
| `Cmd+Shift+D` | 下にsplit |
| `Cmd+Shift+矢印` | split間の移動 |
| `Cmd+Alt+矢印` | splitのresize |
| `Cmd+Shift+Enter` | split zoom toggle |

### Navigation

| Key | 操作 |
|-----|------|
| `Cmd+Left/Right` | 前/次のtab |
| `Cmd+Up/Down` | page scroll |
| `Shift+PageUp/Down` | page scroll |
| `Cmd+Home/End` | scroll to top/bottom |

### その他

| Key | 操作 |
|-----|------|
| `Cmd+K` | 画面clear |
| `Cmd+Enter` | fullscreen toggle |
| `Cmd+Plus/Minus/0` | font size変更/reset |
| `Cmd+Shift+,` | config reload |
| `Shift+Enter` | newline (Claude Code対応) |

## Zellijとの共存

Ghosttyの`Alt+Left/Right`をunbindして、Zellijのkeybindingと衝突しないようにしている。

```ini
keybind = alt+left=unbind
keybind = alt+right=unbind
```

## テーマ連動

`theme-switch`で切り替えると、`~/.config/ghostty/theme`ファイルが更新される。

## その他の設定

| 項目 | 値 |
|------|------|
| Scrollback | 50,000行 |
| Mouse scroll multiplier | 3x |
| Clipboard read/write | 許可 |
| Mouse hide while typing | 有効 |
| Image storage | 320MB |
| Window save state | always |
