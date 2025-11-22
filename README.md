# Dotfiles Configuration

Domain-driven dotfiles with multi-shell support and theme switching.

## Features

### Multi-Shell Support
- **Zsh & Fish**: Full support for both shells
- **Shared configs**: Centralized aliases and environment variables
- **Modern tools**: skim, eza, bat, zoxide

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

Applies to: WezTerm, Ghostty, Sketchybar, Borders

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

## Included Tools

### Terminal & Shell
- WezTerm, Ghostty, Warp
- Zsh, Fish
- Starship prompt

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
