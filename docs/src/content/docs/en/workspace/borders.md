---
title: Borders
description: Highlight the active window with a colored border.
---

Borders draws a border around the active window on macOS. Combined with AeroSpace to visually distinguish focused windows.

## Configuration

| Setting | Value |
|---------|-------|
| Style | Round |
| Width | 7.0px |
| HiDPI | On |
| Active color | Theme-dependent |
| Inactive color | Theme-dependent |

## Theme integration

`bordersrc` sources `colors.sh` to get active/inactive colors. Running `theme-switch` changes the colors.

```bash
source "$(dirname "$0")/colors.sh"

options=(
    style=round
    width=7.0
    hidpi=on
    active_color="$active_color"
    inactive_color="$inactive_color"
)

borders "${options[@]}"
```

## Workspace CLI integration

Borders can be controlled via the `ws` command (Workspace CLI).

| Command | Action |
|---------|--------|
| `brdr` | Borders restart |
| `brds` | Borders start |
| `brdk` | Borders stop |
