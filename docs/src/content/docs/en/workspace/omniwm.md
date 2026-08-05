---
title: OmniWM
description: Niri/Hyprland inspired tiling WM with built-in bar, quake terminal, and omniwmctl automation.
---

A Niri/Hyprland inspired tiling window manager
([BarutSRB/OmniWM](https://github.com/BarutSRB/OmniWM)).
Developer signed + notarized — no SIP disabling. Requires macOS 26 (Tahoe)
on Apple Silicon with "Displays have separate spaces" ON.

## Start / stop

```bash
mado use omniwm   # start (stops sketchybar / borders — OmniWM draws its own)
mado use loop     # back to the usual set
```

Accessibility permission is requested on first launch.

## Layout model

Vertical columns on an infinite horizontal strip, Niri style (same idea as
Paneru — new windows never shrink existing ones). Each workspace can toggle
between Niri (scrolling columns) and Dwindle (BSP) with `Opt+Shift+L`.

## Keybinds (upstream defaults)

Re-mapping to alt-hjkl is planned once settings.toml is generated.

| Operation | Keybind |
|-----------|---------|
| Focus | `Opt+Arrows` |
| Move window | `Opt+Shift+Arrows` |
| Workspace 1-9 | `Opt+1-9` |
| Fullscreen | `Opt+Return` |
| Balance columns | `Opt+Shift+B` |
| Toggle Niri / Dwindle | `Opt+Shift+L` |
| Quake terminal | `` Opt+` `` |
| Command palette | `Ctrl+Opt+Space` |
| Overview | `Opt+Shift+O` |

## Built-ins

- **Quake terminal** — libghostty-powered; position, size, glass effects
- **Command palette** — fuzzy window search and jump
- **Overview** — thumbnail window list
- **Scratchpads** — stash / recall any app
- **Menu bar icon hiding** — Ice / Bartender equivalent

## Customization

Settings live in `~/.config/omniwm/settings.toml` (symlinked to
`domains/workspace/config/omniwm/`, generated on first launch, live-reloads
on save) plus the GUI Settings.

- All hotkeys remappable (Settings > Hotkeys)
- App Rules — float / workspace assignment / sizes
  (equivalent of AeroSpace's `on-window-detected`)
- Workspace bar — position, height, icon overrides (`[workspaceBar.iconOverrides]`)
- System Hyper Trigger — turn Caps Lock or F13-F20 into Hyper
- Mouse & Trackpad — gestures, scroll sensitivity

## omniwmctl (automation)

```bash
omniwmctl query workspaces            # state as JSON
omniwmctl subscribe                   # event stream
omniwmctl watch active-workspace --exec update-bar.sh   # run a script per event
```

`watch` + a script makes sketchybar integration possible (we currently use
the built-in bar).

## Known limitations

- Dwindle group membership / tab order is runtime state and is not restored
  across restarts
