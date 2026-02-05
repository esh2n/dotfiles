---
title: Theme Switcher
description: 全 application のテーマを 1 command で切り替える。
---

`theme-switch` は、対応する全 application のテーマを一括で切り替える command。

## 対応テーマ

| Theme | 雰囲気 |
|-------|--------|
| Catppuccin Mocha | warm な soft pastel |
| Nord | cool な arctic palette |
| Tokyo Night | dark で vibrant |

## Usage

```bash
theme-switch nord
theme-switch catppuccin
theme-switch tokyonight
```

## 切り替え対象

1 command で以下がすべて更新される:

- WezTerm
- Ghostty
- Sketchybar
- Borders
- Zellij (layout + zjstatus colors)

## 仕組み

各 application にはテーマ固有の config file がある。`theme-switch` は symlink と config 値を選択したテーマに向けて更新し、必要に応じて service を restart する。

Zellij では default layout の symlink が切り替わる:

```text
~/.config/zellij/layouts/default.kdl → active theme の layout
```

## Wallpaper

Wallhaven.cc から wallpaper を取得することもできる:

```bash
wallpaper search "cyberpunk"
```
