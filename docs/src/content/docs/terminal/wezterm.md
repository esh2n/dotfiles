---
title: WezTerm
description: Lua で構成された modular な WezTerm の設定。Windows/WSL にも対応。
---

WezTermはLuaで設定を書けるterminal emulator。modularな構成で、OSごとの最適化、テーマ切替、Claude Codeの通知連携などを含む。

## Module構成

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

背景透過は`0.6`がデフォルト。`toggle-opacity` eventで`0.6 ↔ 1.0`を切り替えられる。

## OS別の最適化

### macOS/Linux

- WebGpu rendering (HighPerformance)
- 60fps animation
- カスタムstatus bar (天気、Spotifyなど)
- Hack Nerd Font

### Windows/WSL

- Software rendering (安定性優先)
- 15fps animation, 30fps max
- シンプルなstatus bar (時刻とバッテリーのみ)
- auto config reloadを無効化
- WSL (Ubuntu) を直接起動

## Claude Code通知

WezTermの`bell` eventをhookして、foreground processがClaude Codeの場合にtoast notificationを表示する。

```lua
wezterm.on("bell", function(window, pane)
  if is_claude(pane) then
    window:toast_notification("Claude Code", "Task completed", nil, 4000)
  end
end)
```

Claude Codeがタスクを完了するとbellを鳴らすので、別のwindowで作業していても通知が届く。

## Tab title

tab titleには現在のworking directoryを表示。home directoryは`~`に置換。

## テーマ連動

Catppuccinベースのcolor paletteを`lua/ui/colors.lua`で定義。`theme-switch`で切り替えると色が変わる。

## Status bar (macOS/Linux)

macOSとLinuxでは、外部scriptを呼び出すリッチなstatus barを表示する。天気、Spotify、network speedなどの情報を含む。

Windows環境では外部プロセスを使わず、時刻とバッテリーのみのシンプルな表示。

## 起動時layout

`gui-startup` eventで起動時にwindowを最大化する。macOSでは`lua/core/layout.lua`のカスタムlayoutを適用。Windowsでは最小限の初期化のみ。
