# Zellij Ultimate Setup

Rich, modern terminal multiplexer configuration with theme integration and powerful plugins.

## ✨ Features

### 🎨 Theme Integration
- **Automatic theme switching** with `theme-switch` command
- **3 themes supported**: catppuccin, tokyonight, nord
- **Synchronized colors** across all applications

### 🔌 Plugins
- **Zjstatus** - Rich status bar with Git info, time, mode display
- **Monocle** - Fuzzy file finder (`Ctrl+q` → `f`)
- **Harpoon** - Favorite panes management (`Ctrl+q` → `b`)

### ⌨️ Keybindings

Prefix key: `Ctrl+q` (enters locked/prefix mode)

**Normal Mode (no prefix):**
- `Ctrl+1-5` - Switch to tab 1-5

**Prefix Mode (`Ctrl+q` →):**

| Key | Action |
|-----|--------|
| `h`/`j`/`k`/`l` | Move focus between panes |
| `H`/`J`/`K`/`L` | Resize pane |
| `Tab` / `Shift+Tab` | Next / Previous tab |
| `t` | New tab |
| `\` | Split pane right |
| `-` | Split pane down |
| `x` | Close pane |
| `z` | Toggle pane fullscreen |
| `w` | Toggle floating panes |
| `e` | Toggle pane embed/float |
| `[` | Enter scroll/copy mode |
| `d` | Detach session |

**Plugins (prefix mode):**
- `f` - **Monocle** - zellij内のファジーファインダー。開いているpane/tabをインクリメンタル検索してジャンプ
- `b` - **Harpoon** - よく使うpaneをブックマークして即座に切り替え。paneが多い時に便利

**Harpoon Commands:**

| Key | Action |
|-----|--------|
| `a` | 現在のpaneをブックマークに追加 |
| `j`/`k` or `↑`/`↓` | リスト内を移動 |
| `Enter` | 選択したpaneにジャンプ |
| `d` | ブックマークから削除 |
| `Esc` | 閉じる |

> **Tip:** paneが2〜3個なら `Ctrl+q` → `h/j/k/l` のpane移動で十分。paneが5個以上になる運用でHarpoonが真価を発揮する。

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