# Dotfiles Configuration

Domain-driven dotfiles with multi-shell support and theme switching.

## Features

### Multi-Shell Support
- **Zsh & Fish**: Full support for both shells
- **Shared configs**: Centralized aliases and environment variables
- **Modern tools**: skim, eza, bat, zoxide, atuin, yazi

### Neovim Distribution Switcher
Switch between multiple Neovim distributions:

| Distribution | Description |
|--------------|-------------|
| Custom | Personal configuration |
| LazyVim | Fast and minimal |
| NvChad | Beautiful UI |
| AstroVim | Feature-rich |

```bash
nvim-switch lazyvim
nvim-switch custom
```

### Theme Switcher
Quick theme switching for all tools:

| Theme | Base Colors |
|-------|-------------|
| Catppuccin Mocha | Warm, soft pastels |
| Nord | Cool, arctic palette |
| Tokyo Night | Dark, vibrant |

Applies to: WezTerm, Ghostty, Sketchybar, Borders, Zellij

```bash
theme-switch nord
theme-switch catppuccin
```

### Wallpaper Integration
Download and set wallpapers from Wallhaven.cc:

```bash
wallpaper search "cyberpunk"
```

## Directory Structure

```
dotfiles/
├── core/          # Installer, config manager, utilities
├── domains/       # Domain-specific configurations
│   ├── creative/  # Media tools, wallpaper scripts
│   ├── dev/       # Neovim, terminals, shells, languages
│   ├── infra/     # Network, security
│   ├── system/    # Fonts, colors, themes
│   └── workspace/ # Window managers, status bars
└── specs/         # Architecture documentation
```

## Installation

```bash
cd dotfiles
./core/install/installer.sh
```

The installer will:
1. Install Homebrew (if needed)
2. Install packages from Brewfiles
3. Setup language runtimes (mise)
4. Create symlinks to configurations
5. Backup existing files

## Configuration

### Package Management

| Location | Purpose |
|----------|---------|
| `domains/*/packages/Brewfile` | Homebrew packages |
| `domains/dev/packages/cargo.txt` | Rust packages |
| `domains/dev/packages/go.txt` | Go packages |
| `domains/dev/packages/bun.txt` | Bun packages |

### Symlink Management

```bash
# Re-apply symlinks
./core/config/manager.sh link

# Process templates
./core/config/manager.sh template
```

### Template System

Some config files (VSCode `settings.json`, Mise `config.toml`) cannot use environment variables. Use `.template` files with `{{HOME}}` placeholders:

```bash
# Generate config files from templates
./core/config/manager.sh template
```

This replaces `{{HOME}}` with your actual home directory. Generated files are ignored by git; only `.template` files are tracked.

### Environment Variables

WezTerm weather widget requires OpenWeather API key. Set it via:


**`.env` file**
Create `.env` in dotfiles root:
```bash
OPENWEATHER_API_KEY=your-api-key
```

The widget checks `OPENWEATHER_API_KEY` env var first, then looks for `.env` in:
- `$DOTFILES_ROOT/.env`
- `~/dotfiles/.env`
- Config directory relative paths

For Lua-based configs (WezTerm), set `DOTFILES_ROOT` in your shell config:
```bash
export DOTFILES_ROOT="$HOME/go/github.com/esh2n/dotfiles/dotfiles"
```

## Included Tools

### Terminal & Shell
- WezTerm, Ghostty, Warp
- Zellij (terminal multiplexer with rich plugins)
- Zsh, Fish
- Starship prompt

### CLI Tools
- **eza** - Modern `ls` with colors and icons
- **bat** - Syntax-highlighted `cat`
- **sk** - Fuzzy finder (skim)
- **zoxide** - Smart `cd`
- **atuin** - Shell history search with sync
- **yazi** - Terminal file manager
- **vivid** - LS_COLORS generator
- **btop** - Modern system monitor
- **thefuck** - Command correction

#### Usage
- `Ctrl+R` - History search (atuin)
- `y` - File manager with auto-cd (yazi)
- `z <dir>` - Smart directory jumping (zoxide)
- `zi` - Interactive directory selection (zoxide)
- `btop` - Interactive system monitor
- `fuck` - Fix previous command (thefuck)
- Auto-suggestions appear in gray text (zsh-autosuggestions)

#### Zellij Multiplexer
- `Alt+f` - File finder (Monocle plugin)
- `Alt+h` - Pane bookmarks (Harpoon plugin)
- `Alt+n` - New pane
- `Alt+t` - New tab
- Rich status bar with Git branch, time, system info

#### AeroSpace Window Manager
**Window Navigation:**
- `Alt+h/j/k/l` - Focus window (left/down/up/right)
- `Alt+Shift+h/j/k/l` - Move window
- `Alt+f` - Fullscreen toggle
- `Alt+r` - Rotate layout (horizontal/vertical)
- `Alt+t` - Toggle floating/tiling

**Workspaces:**
- `Alt+1-5` - Switch to workspace 1-5
- `Alt+Tab` - Previous workspace
- `Alt+Shift+1-5` - Move window to workspace
- `Alt+n/s/d` - Notion/Slack/Discord workspace

**Window Resizing:**
- `Alt+-` - Decrease size
- `Alt+=` - Increase size

#### Workspace Services Management
**Individual Services:**
- `brdr/brds/brdk` - Borders restart/start/stop
- `sbr/sbs/sbk` - Sketchybar restart/start/stop

**All Services:**
- `wsls` - List all workspace services status
- `wsrestart` - Restart all (Sketchybar, Borders, AeroSpace)
- `wsstart` - Start all services
- `wsstop` - Stop all services

#### Known Issues
When prompted "Ignore insecure directories and continue [y] or abort compinit [n]?", choose `y`. This is a permissions warning for brew-installed completions.

### Editor
- Neovim (4 distributions)
- VSCode, Cursor

### Window Management
- AeroSpace
- Borders
- Sketchybar
- Raycast

### Development
- Git, Docker
- mise (version manager)
- Language toolchains (Rust, Go, Node, Python)

## Safety

All existing configurations are backed up:
- Format: `{filename}.backup.{timestamp}`
- Example: `.zshrc.backup.20250123_012345`

## Custom Configuration

User-specific settings go in:
- `~/.config/git/config.local` - Git settings
- Shell environment: Modify `domains/dev/home/.zshenv`

## License

MIT
