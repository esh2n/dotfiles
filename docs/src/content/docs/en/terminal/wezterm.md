---
title: WezTerm
description: Modular Lua-based WezTerm config with Windows/WSL support.
---

WezTerm is a terminal emulator configured in Lua. Modular architecture with OS-specific optimizations, theme switching, and Claude Code notification integration.

## Module structure

```
~/.config/wezterm/
├── wezterm.lua          # Entry point
└── lua/
    ├── core/
    │   ├── appearance.lua   # Font, opacity, window
    │   ├── keybinds.lua     # Keybinding definitions
    │   └── layout.lua       # Startup layout
    ├── ui/
    │   ├── colors.lua       # Catppuccin color palette
    │   ├── status.lua       # Status bar (macOS/Linux)
    │   └── tabs.lua         # Tab styling
    └── utils/
        └── os.lua           # OS detection utility
```

## Appearance

| Setting | macOS/Linux | Windows |
|---------|-------------|---------|
| Renderer | WebGpu (High Performance) | Software |
| FPS | 60 | 30 |
| Font | Hack Nerd Font | Consolas |
| Opacity | 0.6 | 0.6 |
| Window decoration | RESIZE | RESIZE |

Background opacity defaults to `0.6`. The `toggle-opacity` event switches between `0.6 ↔ 1.0`.

## OS-specific optimizations

### macOS/Linux

- WebGpu rendering (HighPerformance)
- 60fps animation
- Custom status bar (weather, Spotify, etc.)
- Hack Nerd Font

### Windows/WSL

- Software rendering (stability first)
- 15fps animation, 30fps max
- Simple status bar (time and battery only)
- Auto config reload disabled
- Direct WSL (Ubuntu) launch

## Claude Code notification

Hooks into WezTerm's `bell` event. When the foreground process is Claude Code, a toast notification is shown.

```lua
wezterm.on("bell", function(window, pane)
  if is_claude(pane) then
    window:toast_notification("Claude Code", "Task completed", nil, 4000)
  end
end)
```

Claude Code rings the bell when a task completes, so you get notified even when working in another window.

## Tab title

Tab titles show the current working directory. Home directory is replaced with `~`.

## Theme integration

Catppuccin-based color palette defined in `lua/ui/colors.lua`. Colors change when `theme-switch` is run.

## Status bar (macOS/Linux)

On macOS and Linux, a rich status bar calls external scripts for weather, Spotify, network speed, and more.

On Windows, a simple display shows only time and battery (no external processes).

## Startup layout

The `gui-startup` event maximizes the window on launch. On macOS, a custom layout from `lua/core/layout.lua` is applied. Windows uses minimal initialization.
