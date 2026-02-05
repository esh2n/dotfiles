---
title: Ghostty
description: GPU-accelerated terminal emulator with background blur and transparency.
---

Ghostty is a GPU-accelerated terminal emulator. Configured with background transparency, blur, ligature fonts, quick terminal, and more.

## Appearance

| Setting | Value |
|---------|-------|
| Font | JetBrainsMono Nerd Font (15pt) |
| Background opacity | 0.6 |
| Blur radius | 30 |
| Cursor | Block, blink |
| Window theme | Dark |
| Color space | Display P3 |
| Titlebar | Hidden (macOS) |
| Window shadow | Enabled |

### Font ligatures

Ligatures are enabled for better code aesthetics.

```ini
font-feature = +liga
font-feature = +calt
font-feature = +ss01 ~ +ss05
```

### Cell adjustments

Line height and underline position are tuned for readability.

```ini
font-thicken = true
adjust-cell-height = 20%
adjust-underline-position = 10%
```

## Quick terminal

`Cmd+Shift+Space` opens a dropdown terminal from the top of the screen. Auto-hides when unfocused.

```ini
quick-terminal-position = top
quick-terminal-animation-duration = 200ms
quick-terminal-autohide = true
```

## Shell integration

Fish shell integration is enabled with cursor, title, and sudo features.

```ini
shell-integration = fish
shell-integration-features = cursor,title,sudo
```

## Keybindings

### Tabs and windows

| Key | Action |
|-----|--------|
| `Cmd+T` | New tab |
| `Cmd+Shift+T` | New window |
| `Cmd+W` | Close tab |
| `Cmd+1-9` | Go to tab 1-9 |
| `Cmd+Tab` / `Cmd+Shift+Tab` | Next/previous tab |

### Splits

| Key | Action |
|-----|--------|
| `Cmd+D` | Split right |
| `Cmd+Shift+D` | Split down |
| `Cmd+Shift+Arrow` | Navigate splits |
| `Cmd+Alt+Arrow` | Resize split |
| `Cmd+Shift+Enter` | Toggle split zoom |

### Navigation

| Key | Action |
|-----|--------|
| `Cmd+Left/Right` | Previous/next tab |
| `Cmd+Up/Down` | Page scroll |
| `Shift+PageUp/Down` | Page scroll |
| `Cmd+Home/End` | Scroll to top/bottom |

### Other

| Key | Action |
|-----|--------|
| `Cmd+K` | Clear screen |
| `Cmd+Enter` | Toggle fullscreen |
| `Cmd+Plus/Minus/0` | Font size change/reset |
| `Cmd+Shift+,` | Reload config |
| `Shift+Enter` | Newline (Claude Code fix) |

## Zellij compatibility

Ghostty's `Alt+Left/Right` are unbound to avoid conflicts with Zellij keybindings.

```ini
keybind = alt+left=unbind
keybind = alt+right=unbind
```

## Theme integration

Running `theme-switch` updates the `~/.config/ghostty/theme` file.

## Other settings

| Setting | Value |
|---------|-------|
| Scrollback | 50,000 lines |
| Mouse scroll multiplier | 3x |
| Clipboard read/write | Allowed |
| Mouse hide while typing | Enabled |
| Image storage | 320MB |
| Window save state | Always |
