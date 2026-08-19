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

## Workspaces

The bar shows "number + emoji" labels (via `displayName`, 2026-08-19):

| WS | Label | Purpose |
|----|-------|---------|
| 1 | 1 💻 | main work |
| 2 | 2 🌐 | browsing |
| 3 | 3 💬 | communication |
| 4 | 4 📝 | notes / docs |
| 5 | 5 🎧 | media / misc |
| 6 | 6 ❤️ | (secondary) |
| 7 | 7 🚀 | (secondary) |

## Keybinds (current)

| Operation | Keybind |
|-----------|---------|
| Focus | `Opt+Arrows` (`Opt+Tab` = previous window) |
| Move window | `Opt+Shift+Arrows` |
| Switch workspace / send window | `Opt+1-9` / `Opt+Shift+1-9` |
| **Move workspace to monitor** | `Ctrl+Cmd+Arrows` (session-only) |
| Focus next monitor | `Ctrl+Cmd+Tab` |
| Fullscreen (in-WM) | `Opt+Return` |
| Column full width | `Opt+Shift+F` |
| **Float ⇔ tile toggle** | `Opt+T` |
| Column tabbed | `Opt+Shift+T` |
| **Scratchpad recall / stash** | `Opt+Shift+Space` |
| **Assign to scratchpad** | `Ctrl+Opt+Shift+Space` (focused window) |
| Cycle column width presets | `Opt+.` / `Opt+,` (1/3, 1/2, 2/3) |
| Width ±10% | `Opt+-` / `Opt+=` |
| Balance columns | `Opt+Shift+B` |
| Toggle Niri / Dwindle | `Opt+Shift+L` |
| Quake terminal | `` Opt+` `` |
| Command palette | `Ctrl+Opt+Space` |
| Overview | `Opt+Shift+O` |

## How monitor assignment works

`monitorAssignment` is a **required field** on every workspace — an
"unassigned / dynamic" state does not exist. Three cases:

- `main` / `secondary` — heuristic resolution; unreliable across monitor
  setups (on a 3-monitor desk, "secondary" once resolved to the built-in
  Retina display)
- `specificDisplay` — pins a display by UUID. **Falls back to the nearest
  available monitor when that display is disconnected**, so it degrades
  gracefully away from the desk

**Prefer `specificDisplay`**: pick the real display per workspace in
Settings > Workspaces. Moves via `Ctrl+Cmd+Arrows` or
`omniwmctl workspace move-to-monitor` are runtime overrides and reset on
restart.

## Editing settings.toml — IMPORTANT

OmniWM owns the file; "live-reload on save" applies to GUI changes only.
External edits are reverted from an internal backup at launch if the app was
running, was killed uncleanly (`mado stop`), or the edit breaks the schema
(e.g. removing `monitorAssignment`).

Correct procedure: **quit gracefully
(`osascript -e 'quit app "OmniWM"'`) → edit → `open -a OmniWM`**.

## Built-ins

- **Quake terminal** — libghostty-powered; position, size, glass effects
- **Command palette** — fuzzy window search and jump
- **Overview** — thumbnail window list
- **Scratchpads** — stash / recall any app (keys in the table above)
- **Menu bar icon hiding** — Ice / Bartender equivalent

## Customization

Settings live in `~/.config/omniwm/settings.toml` (symlinked to
`domains/workspace/config/omniwm/`) plus the GUI Settings. External edits
follow the procedure above.

- All hotkeys remappable (Settings > Hotkeys)
- App Rules — float / workspace assignment / sizes
  (equivalent of AeroSpace's `on-window-detected`)
- Workspace bar — position, height, icon overrides (`[workspaceBar.iconOverrides]`)
- System Hyper Trigger — turn Caps Lock or F13-F20 into Hyper
- Mouse & Trackpad — gestures, scroll sensitivity

## omniwmctl (automation)

`general.ipcEnabled = true` is set (changing it requires an OmniWM restart).

```bash
omniwmctl query workspaces --format table        # workspace → monitor mapping
omniwmctl query displays --format table          # display layout
omniwmctl workspace move-to-monitor 5 right      # move a workspace across monitors
omniwmctl command toggle-focused-window-floating # run any action
omniwmctl subscribe                              # event stream
omniwmctl watch active-workspace --exec update-bar.sh   # run a script per event
```

`omniwmctl help` lists every action. `watch` + a script makes sketchybar
integration possible (we currently use the built-in bar).

## Known limitations

- Dwindle group membership / tab order is runtime state and is not restored
  across restarts
- Workspace-to-monitor moves via keys / CLI reset on restart (persist with
  `specificDisplay`)
