---
title: Zellij
description: Zellij configuration with theme integration and plugins.
---

A Zellij setup with automatic theme integration, a rich status bar, fuzzy finding, and pane bookmarks.

## Theme integration

Running `theme-switch` with Catppuccin, Tokyo Night, or Nord automatically updates the Zellij layout and status bar colors.

## Plugins

| Plugin | What it does |
|--------|-------------|
| Zjstatus | Status bar with git branch, time, and mode indicator |
| Monocle | Fuzzy finder for panes and tabs (`Ctrl+q` then `f`) |
| Harpoon | Pane bookmark manager (`Ctrl+q` then `b`) |

## Keybindings

Prefix key is `Ctrl+q`.

### Without prefix

| Key | Action |
|-----|--------|
| `Ctrl+1-5` | Switch to tab 1-5 |

### Prefix mode (`Ctrl+q` then)

| Key | Action |
|-----|--------|
| `h`/`j`/`k`/`l` | Move focus between panes |
| `H`/`J`/`K`/`L` | Resize pane |
| `Tab` / `Shift+Tab` | Next / Previous tab |
| `t` | New tab |
| `\` | Split right |
| `-` | Split down |
| `x` | Close pane |
| `z` | Toggle fullscreen |
| `w` | Toggle floating panes |
| `e` | Toggle embed/float |
| `[` | Scroll/copy mode |
| `d` | Detach |

### Plugin shortcuts

| Key | Plugin | What it does |
|-----|--------|-------------|
| `f` | Monocle | Search and jump to panes/tabs |
| `b` | Harpoon | Switch between bookmarked panes |

### Harpoon controls

| Key | Action |
|-----|--------|
| `a` | Add current pane to bookmarks |
| `j`/`k` or `↑`/`↓` | Navigate list |
| `Enter` | Jump to selected pane |
| `d` | Remove bookmark |
| `Esc` | Close |

:::tip
With 2-3 panes, `Ctrl+q` then `h/j/k/l` is enough. Harpoon becomes useful when you're juggling 5 or more.
:::

## Setup

Requires Zellij 0.38.0+ and the `wasm32-wasip1` Rust target.

```bash
rustup target add wasm32-wasip1
```

Plugins are downloaded automatically. To manually rebuild Harpoon:

```bash
git clone https://github.com/Nacho114/harpoon.git /tmp/harpoon
cd /tmp/harpoon
cargo build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/harpoon.wasm ~/.config/zellij/plugins/
```

## File layout

```
~/.config/zellij/
├── config.kdl           # Main config
├── layouts/
│   ├── catppuccin.kdl   # Catppuccin theme
│   ├── tokyonight.kdl   # Tokyo Night theme
│   ├── nord.kdl         # Nord theme
│   └── default.kdl      # Symlink to active theme
└── plugins/
    ├── zjstatus.wasm    # Status bar
    ├── monocle.wasm     # Fuzzy finder
    └── harpoon.wasm     # Pane management
```

## Status bar

Shows mode indicator (colored background), session name, git branch (refreshes every 10s), date/time (Asia/Tokyo), notification alerts, and tab numbers with icons.

## Troubleshooting

### Plugins won't load

1. Check version: `zellij --version`
2. Rebuild plugins from source
3. Clear cache: `rm -rf ~/.cache/zellij/`

### Theme not applying

1. Check permissions: `ls -la ~/.config/zellij/layouts/`
2. Restart sessions: `zellij kill-all-sessions`
3. Verify script: `which theme-switch`

### Harpoon crashes

1. Make sure `wasm32-wasip1` target is installed
2. Rebuild from source
3. Check that config has `move_to_focused_tab true`

## Customization

### Adding themes

1. Create `layouts/theme-name.kdl`
2. Add the theme to `theme-switch`
3. Follow the color pattern from existing themes

### Changing keybindings

Edit `config.kdl`:

```kdl
bind "Your Key" {
    LaunchOrFocusPlugin "file:~/.config/zellij/plugins/plugin.wasm" {
        floating true
    }
    SwitchToMode "normal"
}
```
