---
title: Sketchybar
description: Lua ベースの floating pill-style status bar。
---

Sketchybar は macOS 用の高機能 status bar。Lua で設定を書き、floating pill-style のデザインで構成している。

## 外観

Figma 風の floating pill bar。

| 項目 | 値 |
|------|------|
| Height | 36px |
| Corner radius | 12px |
| Blur radius | 20 |
| Border | 2px (blue) |
| Margin | 12px |
| Y offset | 8px |
| Background | Catppuccin Mocha の mantle (#181825, 94% opacity) |

## Module 構成

```text
~/.config/sketchybar/
├── sketchybarrc        # entry point (Lua shebang)
├── init.lua            # sbar module の初期化
├── bar.lua             # bar 本体の設定
├── default.lua         # default item style
├── settings.lua        # font, padding の設定
├── colors.lua          # color definition (→ theme link)
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

Catppuccin Mocha ベースの色定義。

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

JetBrainsMono Nerd Font への切り替えも settings.lua のコメントを解除するだけで可能。

## Items

### Apple menu
左端に Apple logo を表示。click で popup menu。

### Spaces
AeroSpace の workspace 番号を表示。active workspace はハイライト。

### Front app
現在の active application 名を表示。

### Calendar
日付と時刻を表示。

### Media / Spotify
再生中の曲名とアーティストを表示。

### Widgets
CPU usage、battery 残量などの system 情報。

## テーマ連動

`colors.lua` が `themes/` 内のテーマファイルへの symlink になっている。`theme-switch` で symlink 先を切り替え、Sketchybar を restart することでテーマが反映される。
