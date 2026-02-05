---
title: WezTerm
description: Lua で構成された modular な WezTerm の設定。Windows/WSL にも対応。
---

WezTerm は Lua で設定を書ける terminal emulator。modular な構成で、OS ごとの最適化、テーマ切替、Claude Code の通知連携などを含む。

## Module 構成

```
~/.config/wezterm/
├── wezterm.lua          # entry point
└── lua/
    ├── core/
    │   ├── appearance.lua   # font, opacity, window
    │   ├── keybinds.lua     # keybinding 定義
    │   └── layout.lua       # 起動時 layout
    ├── ui/
    │   ├── colors.lua       # Catppuccin color palette
    │   ├── status.lua       # status bar (macOS/Linux)
    │   └── tabs.lua         # tab styling
    └── utils/
        └── os.lua           # OS 判定 utility
```

## 外観

| 項目 | macOS/Linux | Windows |
|------|-------------|---------|
| Renderer | WebGpu (High Performance) | Software |
| FPS | 60 | 30 |
| Font | Hack Nerd Font | Consolas |
| Opacity | 0.6 | 0.6 |
| Window decoration | RESIZE | RESIZE |

背景透過は `0.6` がデフォルト。`toggle-opacity` event で `0.6 ↔ 1.0` を切り替えられる。

## OS 別の最適化

### macOS/Linux

- WebGpu rendering (HighPerformance)
- 60fps animation
- カスタム status bar (天気、Spotify など)
- Hack Nerd Font

### Windows/WSL

- Software rendering (安定性優先)
- 15fps animation, 30fps max
- シンプルな status bar (時刻とバッテリーのみ)
- auto config reload を無効化
- WSL (Ubuntu) を直接起動

## Claude Code 通知

WezTerm の `bell` event を hook して、foreground process が Claude Code の場合に toast notification を表示する。

```lua
wezterm.on("bell", function(window, pane)
  if is_claude(pane) then
    window:toast_notification("Claude Code", "Task completed", nil, 4000)
  end
end)
```

Claude Code がタスクを完了すると bell を鳴らすので、別の window で作業していても通知が届く。

## Tab title

tab title には現在の working directory を表示。home directory は `~` に置換。

## テーマ連動

Catppuccin ベースの color palette を `lua/ui/colors.lua` で定義。`theme-switch` で切り替えると色が変わる。

## Status bar (macOS/Linux)

macOS と Linux では、外部 script を呼び出すリッチな status bar を表示する。天気、Spotify、network speed などの情報を含む。

Windows 環境では外部プロセスを使わず、時刻とバッテリーのみのシンプルな表示。

## 起動時 layout

`gui-startup` event で起動時に window を最大化する。macOS では `lua/core/layout.lua` のカスタム layout を適用。Windows では最小限の初期化のみ。
