---
title: Sketchybar
description: Lua-based floating pill-style status bar.
---

Sketchybar is a highly customizable status bar for macOS. Configured in Lua with a floating pill-style design.

## Appearance

Figma-inspired floating pill bar.

| Setting | Value |
|---------|-------|
| Height | 36px |
| Corner radius | 12px |
| Blur radius | 20 |
| Border | 2px (blue) |
| Margin | 12px |
| Y offset | 8px |
| Background | Catppuccin Mocha mantle (#181825, 94% opacity) |

## Module structure

```text
~/.config/sketchybar/
├── sketchybarrc        # Entry point (Lua shebang)
├── init.lua            # sbar module initialization
├── bar.lua             # Bar configuration
├── default.lua         # Default item style
├── settings.lua        # Font, padding settings
├── colors.lua          # Color definitions (→ theme symlink)
├── icons.lua           # SF Symbols / Nerd Font icons
├── items/
│   ├── init.lua        # Item loader
│   ├── apple.lua       # Apple menu
│   ├── spaces.lua      # Workspace indicator
│   ├── front_app.lua   # Active app name
│   ├── calendar.lua    # Date and time
│   ├── media.lua       # Media playback info
│   ├── spotify.lua     # Spotify playback info
│   ├── menus.lua       # Menu display
│   └── widgets/        # CPU, battery, etc.
├── plugins/            # Event handler scripts
├── helpers/            # Font helper binaries
└── themes/             # Theme color files
    └── catppuccin.lua  # Catppuccin Mocha palette
```

## Color palette

Catppuccin Mocha color scheme.

| Name | Color | Usage |
|------|-------|-------|
| black | `#1e1e2e` | Background |
| white | `#cdd6f4` | Text |
| red | `#f38ba8` | Error, alert |
| green | `#a6e3a1` | Success |
| blue | `#89b4fa` | Accent, border |
| yellow | `#f9e2af` | Warning |
| orange | `#fab387` | Highlight |
| magenta | `#cba6f7` | Purple accent |
| grey | `#6c7086` | Inactive |

## Settings

| Setting | Value |
|---------|-------|
| Icon set | SF Symbols |
| Font | SF Pro / SF Mono (default) |
| Paddings | 3px |
| Group paddings | 5px |

JetBrainsMono Nerd Font can be enabled by uncommenting the config in settings.lua.

## Items

### Apple menu
Apple logo on the left. Click for popup menu.

### Spaces
AeroSpace workspace numbers. Active workspace is highlighted.

### Front app
Shows the currently active application name.

### Calendar
Date and time display.

### Media / Spotify
Currently playing track and artist.

### Widgets
CPU usage, battery level, and other system info.

## Theme integration

`colors.lua` is a symlink to a theme file in `themes/`. Running `theme-switch` changes the symlink target and restarts Sketchybar.
