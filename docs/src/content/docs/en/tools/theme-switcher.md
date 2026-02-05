---
title: Theme Switcher
description: Switch all application themes with one command.
---

`theme-switch` applies a theme across every integrated application at once.

## Available themes

| Theme | Vibe |
|-------|------|
| Catppuccin Mocha | Warm, soft pastels |
| Nord | Cool, arctic palette |
| Tokyo Night | Dark, vibrant |

## Usage

```bash
theme-switch nord
theme-switch catppuccin
theme-switch tokyonight
```

## What it touches

A single command updates all of these:

- WezTerm
- Ghostty
- Sketchybar
- Borders
- Zellij (layout + zjstatus colors)

## How it works

Each application has theme-specific config files. `theme-switch` updates symlinks and config values to point to the selected theme, then restarts services as needed.

For Zellij, the default layout symlink gets swapped:

```text
~/.config/zellij/layouts/default.kdl → active theme layout
```

## Wallpaper

You can also grab wallpapers from Wallhaven.cc:

```bash
wallpaper search "cyberpunk"
```
