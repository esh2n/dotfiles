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
- **zellij-pane-picker** - Starred panes (`Ctrl+q` → `b`)

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
- `b` - **zellij-pane-picker** - paneの一覧。よく使うpaneに星を付けて即座に切り替え。paneが多い時に便利

**zellij-pane-picker Commands:**

| Key | Action |
|-----|--------|
| 文字入力 | paneを絞り込む |
| `↑`/`↓` | リスト内を移動 |
| `Space` | 選択したpaneに星を付ける/外す |
| `Enter` | 選択したpaneにジャンプ |
| `Esc` | 閉じる |

プラグイン自身の Alt キー（`Alt l` など）は AeroSpace の `alt-hjkl` とぶつかるため切ってある。

> **Tip:** paneが2〜3個なら `Ctrl+q` → `h/j/k/l` のpane移動で十分。paneが5個以上になる運用で真価を発揮する。

## 🚀 Installation

### Plugins

zjstatus and monocle are downloaded by `make up` (the `zellij-plugins` setup step). zellij-pane-picker is pinned by Nix (`next/home/shared/zellij`) and placed at `~/.local/share/zellij/plugins/`.

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
    └── monocle.wasm     # File finder plugin
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