---
title: Theme Switcher
description: 全 application のテーマを 1 command で切り替える。
---

`dotctl theme set` は、対応する全 application のテーマを一括で切り替える command。`theme-switch` はその別名で、引数なしなら `dotctl theme list` と同じ。

## 対応テーマ

13 種（`home/shared/theme/themes/`）。`dotctl theme list` で一覧を出せる。

| Theme | 備考 |
|-------|------|
| `catppuccin` / `catppuccin-latte` | Mocha（dark）と Latte（light） |
| `tokyonight` / `tokyonight-day` | dark と light |
| `everforest` / `everforest-light` | dark と light |
| `nord`, `dracula`, `gruvbox`, `kanagawa`, `onedark`, `rosepine`, `solarized` | |

## Usage

```bash
dotctl theme set nord
dotctl theme set catppuccin
theme-switch tokyonight   # dotctl theme set の別名
```

## 切り替え対象

1 command で以下がすべて更新される:

- WezTerm
- Ghostty
- Sketchybar
- Borders
- Zellij (layout + zjstatus colors)
- Warp、Starship、VSCode、Neovim、CLI の色、wallpaper、Orca、OmniWM（Linux では Omarchy も）

## 仕組み

`~/.config/theme/current` を、選んだテーマの palette（`~/.config/theme/palettes/<name>/`、home-manager が作る）へのリンクに張り替える。WezTerm、Ghostty、Sketchybar、Borders は `current` の中のファイルを読む。そのあと `sketchybar --reload`、borders の再起動、WezTerm の設定 file の touch で読み直させる。ほかの application は設定値を書き換える（`pkgs/dotctl/internal/theme/`）。

Zellij では `~/.config/zellij/config.kdl` の `default_layout` が書き換わる:

```text
default_layout "<theme>"   # layouts/<theme>.kdl を使う
```

## Wallpaper

Wallhaven.cc から wallpaper を取得することもできる:

```bash
wallpaper search "cyberpunk"
```
