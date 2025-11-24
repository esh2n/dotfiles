# Zellij Ultimate Setup

Rich, modern terminal multiplexer configuration with theme integration and powerful plugins.

## ✨ Features

### 🎨 Theme Integration
- **Automatic theme switching** with `theme-switch` command
- **3 themes supported**: catppuccin, tokyonight, nord
- **Synchronized colors** across all applications

### 🔌 Plugins
- **Zjstatus** - Rich status bar with Git info, time, mode display
- **Monocle** - Fuzzy file finder (Alt+f)
- **Harpoon** - Favorite panes management (Alt+h)

### ⌨️ Keybindings

**Basic Navigation:**
- `Ctrl+h/j/k/l` - Move focus between panes
- `Alt+n` - New pane
- `Alt+w` - Close pane
- `Alt+t` - New tab
- `Alt+1-5` - Switch to tab 1-5

**Plugins:**
- `Alt+f` - **Monocle** fuzzy finder
- `Alt+h` - **Harpoon** pane bookmarks

**Harpoon Commands:**
- `a` - Add current pane to favorites
- `j/k` or `↑/↓` - Navigate pane list
- `Enter` - Jump to selected pane
- `d` - Remove from favorites
- `Esc` - Exit Harpoon

## 🚀 Installation

### Prerequisites
- Zellij 0.38.0+
- Rust with `wasm32-wasip1` target

```bash
rustup target add wasm32-wasip1
```

### Plugin Setup

Plugins are automatically downloaded and configured. If you need to rebuild Harpoon:

```bash
# Clone and build Harpoon from source
git clone https://github.com/Nacho114/harpoon.git /tmp/harpoon
cd /tmp/harpoon
cargo build --release --target wasm32-wasip1
cp target/wasm32-wasip1/release/harpoon.wasm ~/.config/zellij/plugins/
```

### Theme Integration

The configuration integrates with the global theme system:

```bash
# Switch themes (affects all applications)
theme-switch catppuccin
theme-switch tokyonight
theme-switch nord
```

## 📁 File Structure

```
~/.config/zellij/
├── config.kdl           # Main configuration
├── layouts/
│   ├── catppuccin.kdl   # Catppuccin theme layout
│   ├── tokyonight.kdl   # Tokyo Night theme layout
│   ├── nord.kdl         # Nord theme layout
│   └── default.kdl      # Default layout (symlinks to active theme)
└── plugins/
    ├── zjstatus.wasm    # Status bar plugin
    ├── monocle.wasm     # File finder plugin
    └── harpoon.wasm     # Pane management plugin
```

## 🎯 Status Bar Features

- **Mode indicator** with colored backgrounds
- **Session name** display
- **Git branch** with auto-refresh (10s interval)
- **Date/time** in Asia/Tokyo timezone
- **Notifications** with visual alerts
- **Tab display** with numbers and icons

## 🔧 Troubleshooting

### Plugin Errors
If plugins fail to load:

1. Check Zellij version: `zellij --version`
2. Rebuild plugins from source (see Installation section)
3. Clear cache: `rm -rf ~/.cache/zellij/`

### Theme Not Applying
If themes don't switch properly:

1. Check file permissions: `ls -la ~/.config/zellij/layouts/`
2. Restart Zellij sessions: `zellij kill-all-sessions`
3. Verify theme-switch script: `which theme-switch`

### Harpoon Crashes
If Harpoon shows "Error in plugin":

1. Ensure `wasm32-wasip1` target is installed
2. Rebuild from source (required for compatibility)
3. Check config has `move_to_focused_tab true`

## 🎨 Customization

### Adding New Themes
1. Create new layout in `layouts/theme-name.kdl`
2. Update `theme-switch` script to handle new theme
3. Add theme colors following existing pattern

### Custom Keybindings
Modify `config.kdl` to add or change keybindings:

```kdl
bind "Your Key" {
    LaunchOrFocusPlugin "file:~/.config/zellij/plugins/plugin.wasm" {
        floating true
    }
    SwitchToMode "normal"
}
```

---

**Part of the ultimate dotfiles ecosystem** 🚀