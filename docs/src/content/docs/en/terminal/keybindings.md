---
title: Keybindings
description: Unified keybindings across WezTerm, Zellij, and Herdr.
---

The same keybindings work across WezTerm, Zellij, and Herdr. Prefix key is `Ctrl+q`.

## Pane operations

| Action | Key | Note |
|--------|-----|------|
| Split right | `Prefix + \` | |
| Split down | `Prefix + -` | |
| Navigate panes | `Prefix + h/j/k/l` | |
| Resize panes | `Prefix + H/J/K/L` | |
| Zoom pane | `Prefix + z` | |
| Toggle floating | `Prefix + w` | Zellij only |
| Toggle embed/float | `Prefix + e` | Zellij only |
| Close pane | `Prefix + x` | |

## Tab operations

| Action | Key | Note |
|--------|-----|------|
| Previous tab | `Ctrl+h` | No prefix needed |
| Next tab | `Ctrl+l` | No prefix needed |
| Tab 1-5 | `Ctrl+1-5` | No prefix, Zellij only |
| New tab | `Prefix + t` | Zellij only |

## Copy / Scroll mode

| Action | Key | Note |
|--------|-----|------|
| Enter mode | `Prefix + [` | WezTerm: `Prefix + c` |
| Move | `h/j/k/l`, `w/b/e`, `0/$` | Vim-style |
| Half-page scroll | `Ctrl+u/d` | |
| Full-page scroll | `Ctrl+b/f` | |
| Search | `/` then `n/N` | `Ctrl+r` cycles match type |
| Start selection | `v` / `V` / `Ctrl+v` | Char / Line / Block |
| Copy and exit | `y` | Copies to clipboard |
| Exit mode | `Esc` or `q` | |

## Session

| Action | Key |
|--------|-----|
| Detach | `Prefix + d` |

## Zellij plugins

| Action | Key | Description |
|--------|-----|-------------|
| Monocle | `Prefix + f` | Fuzzy finder for panes/tabs |
| zellij-pane-picker | `Prefix + b` | Starred panes |

## Zellij session management

```bash
# List sessions
zellij list-sessions

# Attach to a session
zellij attach <session-name>

# Detach with Prefix + d

# Delete a session
zellij delete-session <session-name>
```

Sessions persist until you explicitly delete them.
