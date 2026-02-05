---
title: tmux
description: Catppuccin-based status bar with Spotify integration.
---

A tmux configuration that works alongside Zellij. Unified prefix key, vi-mode copy, automatic session restore, and a custom status bar.

## Prefix key

Prefix is rebound to `Ctrl+q` (same as Zellij).

```bash
unbind C-b
set -g prefix C-q
```

## Keybindings

### Without prefix

| Key | Action |
|-----|--------|
| `Ctrl+h` | Previous window |
| `Ctrl+l` | Next window |

### Prefix mode (`Ctrl+q` →)

| Key | Action |
|-----|--------|
| `\` | Split right |
| `-` | Split down |
| `h`/`j`/`k`/`l` | Focus pane |
| `H`/`J`/`K`/`L` | Resize pane |
| `z` | Zoom pane (fullscreen) |
| `x` | Close pane |
| `Tab` | Last window |
| `[` | Enter copy mode |
| `?` | Keybindings help popup |

### Copy mode (vi-style)

| Key | Action |
|-----|--------|
| `v` | Begin selection |
| `y` | Copy (via pbcopy) |
| `H` | Start of line |
| `L` | End of line |
| `Escape` | Cancel |

### Spotify controls

| Key | Action |
|-----|--------|
| `p` | Play/pause |
| `]` | Next track |
| `P` | Previous track |

## Plugins

Managed with TPM (Tmux Plugin Manager).

| Plugin | Description |
|--------|-------------|
| tmux-sensible | Sensible defaults |
| tmux-yank | System clipboard integration |
| tmux-battery | Battery level display |
| tmux-cpu | CPU usage display |
| tmux-weather | Weather info |
| tmux-net-speed | Network speed |
| tmux-resurrect | Session save/restore |
| tmux-continuum | Auto save (15 min) and auto restore |
| catppuccin/tmux | Catppuccin theme |

## Automatic session restore

tmux-resurrect and tmux-continuum handle automatic session persistence.

- Auto save every 15 minutes
- Auto restore on tmux startup
- Restores vim/nvim sessions
- Preserves pane contents
- Restores processes: ssh, node, python, go, cargo, etc.

## Status bar

Catppuccin Mocha pill-style status bar. Session name on the left, info widgets on the right.

### Widgets

| Item | Description |
|------|-------------|
| Session name | Ghost icon on the left |
| Spotify | Currently playing track |
| Help icon | Click for keybindings popup |
| Weather | Temperature and icon |
| Pressure | hPa display |
| Rain chance | Umbrella icon |
| Network | Connection status |
| Earthquake | Latest seismic alert |
| Battery | Charge level |
| CPU | Usage percentage |
| Time | HH:MM |

### Window tabs

Pill-shaped window tabs. Active tab has a blue background, inactive tabs are dimmed.

## Theme integration

Running `theme-switch` updates `~/.config/tmux/themes/current.conf`, which changes the tmux theme.

## Settings

| Setting | Value |
|---------|-------|
| Default terminal | tmux-256color |
| True color | RGB support |
| History limit | 50,000 lines |
| Mouse | Enabled |
| Base index | 1 (starts at 1, not 0) |
| Shell | /opt/homebrew/bin/zsh |
