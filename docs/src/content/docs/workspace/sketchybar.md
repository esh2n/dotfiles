---
title: Sketchybar
description: Lua ベースの floating pill-style status bar。
---

SketchybarはmacOS用の高機能status bar。Luaで設定を書き、floating pill-styleのデザインで構成している。

## 外観

Figma 風の floating pill bar。

| 項目 | 値 |
|------|------|
| Height | 36px |
| Corner radius | 12px |
| Blur radius | 0 |
| Border | 2px (blue) |
| Margin | 12px |
| Y offset | 8px |
| Background | Catppuccin Mochaのmantle (#181825, 94% opacity) |

## Module構成

```text
~/.config/sketchybar/
├── sketchybarrc        # entry point (Lua shebang)
├── init.lua            # sbar module の初期化
├── bar.lua             # bar 本体の設定
├── default.lua         # default item style
├── settings.lua        # font, padding の設定
├── colors.lua          # color definition (→ ~/.config/theme/current/sketchybar.lua)
├── icons.lua           # SF Symbols / Nerd Font icon
├── items/
│   ├── init.lua        # item loader
│   ├── apple.lua       # Apple menu
│   ├── spaces.lua      # workspace indicator
│   ├── front_app.lua   # active app 名表示
│   ├── calendar.lua    # 日時表示
│   ├── media.lua       # media 再生情報
│   ├── spotify.lua     # Spotify 再生情報
│   ├── menus.lua       # menu 表示
│   └── widgets/        # CPU, battery などの widget
├── plugins/            # event handler script
├── helpers/            # font helper binary
└── themes/             # theme color file
    └── catppuccin.lua  # Catppuccin Mocha palette
```

## Color palette

Catppuccin Mochaベースの色定義。

| Name | Color | 用途 |
|------|-------|------|
| black | `#1e1e2e` | background |
| white | `#cdd6f4` | text |
| red | `#f38ba8` | error, alert |
| green | `#a6e3a1` | success |
| blue | `#89b4fa` | accent, border |
| yellow | `#f9e2af` | warning |
| orange | `#fab387` | highlight |
| magenta | `#cba6f7` | purple accent |
| grey | `#6c7086` | inactive |

## Settings

| 項目 | 値 |
|------|------|
| Icon set | SF Symbols |
| Font | SF Pro / SF Mono (default) |
| Paddings | 3px |
| Group paddings | 5px |

JetBrainsMono Nerd Fontへの切り替えもsettings.luaのコメントを解除するだけで可能。

## Items

### Apple menu
左端にApple logoを表示。clickでpopup menu。

### Spaces
AeroSpaceのworkspace番号を表示。active workspaceはハイライト。

### Front app
現在のactive application名を表示。

### Calendar
日付と時刻を表示。

### Media / Spotify
再生中の曲名とアーティストを表示。

### Widgets
CPU usage、battery残量などのsystem情報。

## テーマ連動

`colors.lua`は`~/.config/theme/current/sketchybar.lua`へのsymlinkになっている。`dotctl theme set`（別名`theme-switch`）は`current`を選んだテーマのpaletteに張り替え、`sketchybar --reload`でテーマを反映させる。
