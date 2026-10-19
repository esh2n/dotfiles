---
title: Theme Switcher
description: Switch all application themes with one command.
---

`dotctl theme set` applies a theme across every integrated application at once. `theme-switch` is an alias for it; with no argument it runs `dotctl theme list`.

## Available themes

13 themes (`home/shared/theme/themes/`). `dotctl theme list` prints them.

| Theme | Note |
|-------|------|
| `catppuccin` / `catppuccin-latte` | Mocha (dark) and Latte (light) |
| `tokyonight` / `tokyonight-day` | Dark and light |
| `everforest` / `everforest-light` | Dark and light |
| `nord`, `dracula`, `gruvbox`, `kanagawa`, `onedark`, `rosepine`, `solarized` | |

## Usage

```bash
dotctl theme set nord
dotctl theme set catppuccin
theme-switch tokyonight   # alias for dotctl theme set
```

## What it touches

A single command updates all of these:

- WezTerm
- Ghostty
- Sketchybar
- Borders
- Zellij (layout + zjstatus colors)
- Warp, Starship, VSCode, Neovim, CLI colours, wallpaper, Orca, OmniWM (and Omarchy on Linux)

## How it works

It relinks `~/.config/theme/current` to the chosen theme's palette (`~/.config/theme/palettes/<name>/`, made by home-manager). WezTerm, Ghostty, Sketchybar and Borders read their files inside `current`; dotctl then runs `sketchybar --reload`, restarts borders and touches the WezTerm config so they reload. The other applications get their config values rewritten (`pkgs/dotctl/internal/theme/`).

For Zellij, `default_layout` in `~/.config/zellij/config.kdl` is rewritten:

```text
default_layout "<theme>"   # uses layouts/<theme>.kdl
```

## Wallpaper

You can also grab wallpapers from Wallhaven.cc:

```bash
wallpaper search "cyberpunk"
```
