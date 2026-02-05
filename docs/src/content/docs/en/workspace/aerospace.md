---
title: AeroSpace
description: Tiling window manager setup and keybindings.
---

A tiling window manager for macOS. Apps are organized into named workspaces and controlled entirely by keyboard.

## Workspaces

| Key | Workspace | Apps |
|-----|-----------|------|
| `W` | Work | Cursor, VSCode |
| `S` | Shell | Ghostty, Warp, WezTerm |
| `B` | Browser | Chrome, Safari, Firefox, Dia |
| `C` | Communication | Slack (sub-monitor recommended) |
| `M` | Music | Spotify, Apple Music |
| `N` | Notion | Documentation |
| `D` | Discord | Discord |
| `G` | Gather | Reserved (floating mode) |
| `1-5` | General | Free use |

## Main mode

### Window navigation

| Key | Action |
|-----|--------|
| `Alt+h/j/k/l` | Focus window (crosses monitors) |
| `Alt+Shift+h/j/k/l` | Move window within workspace |

### Multi-monitor

| Key | Action |
|-----|--------|
| `Alt+Ctrl+h/j/k/l` | Move window to another monitor |
| `Alt+Ctrl+n` | Move to next monitor (wraps) |
| `Alt+Ctrl+p` | Move to previous monitor (wraps) |

### Layout

| Key | Action |
|-----|--------|
| `Alt+r` | Tiles layout (side by side) |
| `Alt+Shift+r` | Accordion layout (stacked) |
| `Alt+t` | Toggle floating/tiling |
| `Alt+f` | Fullscreen |

### Resize

| Key | Action |
|-----|--------|
| `Alt+-` | Shrink by 50 |
| `Alt+=` | Grow by 50 |

### Workspace switching

| Key | Action |
|-----|--------|
| `Alt+1-5` | Switch to workspace 1-5 |
| `Alt+w/b/c/g/m/n/s/d` | Switch to named workspace |
| `Alt+Tab` | Previous workspace |
| `Alt+Shift+Tab` | Move workspace to next monitor |

### Move window to workspace

| Key | Action |
|-----|--------|
| `Alt+Shift+1-5` | Move to workspace and follow |
| `Alt+Shift+w/b/c/g/m/n/s/d` | Move to named workspace and follow |

## Service mode

Enter with `Alt+Shift+;`:

| Key | Action |
|-----|--------|
| `Esc` | Reload config, back to main mode |
| `r` | Reset workspace tree layout |
| `f` | Toggle floating/tiling |
| `Backspace` | Close all windows except current |

## Notes

- Default layout is accordion (single window gets full space)
- Apps auto-assign to their dedicated workspace
- Padding: top 52px (sketchybar 40px + 12px), horizontal 12px, vertical 8px
- Gather uses floating mode so it can move freely between monitors
- Each monitor has independent workspaces
