---
title: Theme Switcher
description: 全 application のテーマを 1 command で切り替える。
---

`dotctl theme set`は、対応する全applicationのテーマを一括で切り替えるcommand。`theme-switch`はその別名で、引数なしなら`dotctl theme list`と同じ。

## 対応テーマ

13種（`home/shared/theme/themes/`）。`dotctl theme list`で一覧を出せる。

| Theme | 備考 |
|-------|------|
| `catppuccin` / `catppuccin-latte` | Mocha（dark）とLatte（light） |
| `tokyonight` / `tokyonight-day` | darkとlight |
| `everforest` / `everforest-light` | darkとlight |
| `nord`, `dracula`, `gruvbox`, `kanagawa`, `onedark`, `rosepine`, `solarized` | |

## Usage

```bash
dotctl theme set nord
dotctl theme set catppuccin
theme-switch tokyonight   # dotctl theme set の別名
```

## 切り替え対象

1 commandで以下がすべて更新される:

- WezTerm
- Ghostty
- Sketchybar
- Borders
- Zellij (layout + zjstatus colors)
- Warp、Starship、VSCode、Neovim、CLIの色、wallpaper、Orca、OmniWM（LinuxではOmarchyも）

## 仕組み

`~/.config/theme/current`を、選んだテーマのpalette（`~/.config/theme/palettes/<name>/`、home-managerが作る）へのリンクに張り替える。WezTerm、Ghostty、Sketchybar、Bordersは`current`の中のファイルを読む。そのあと`sketchybar --reload`、bordersの再起動、WezTermの設定fileのtouchで読み直させる。ほかのapplicationは設定値を書き換える（`pkgs/dotctl/internal/theme/`）。

Zellijでは`~/.config/zellij/config.kdl`の`default_layout`が書き換わる:

```text
default_layout "<theme>"   # layouts/<theme>.kdl を使う
```

## Wallpaper

Wallhaven.ccからwallpaperを取得することもできる:

```bash
wallpaper search "cyberpunk"
```
