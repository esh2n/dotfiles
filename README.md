# Cross-Platform Dotfiles

This repository contains my personal dotfiles configuration that works across macOS and Windows (via WSL2).

## Features

- Shell configurations (Zsh, Fish)
- Neovim, WezTerm, and Helix configurations
- Git configuration
- Package management for various languages
- VSCode/Cursor settings
- Cross-platform compatibility (macOS, Linux, WSL)
- Platform-specific optimizations (sketchybar for macOS, etc.)

## Installation

### macOS

1. Clone this repository:
   ```bash
   git clone https://github.com/esh2n/dotfiles.git
   cd dotfiles
   ```

2. Run the install script:
   ```bash
   ./install.sh
   ```

### Windows (via WSL2)

1. Clone this repository to your Windows machine

2. Run the Windows installation script as Administrator:
   - Right-click on `install-windows.ps1`
   - Select "Run with PowerShell as Administrator"
   
   This script will:
   - Install WSL2
   - Install Ubuntu distribution
   - Set up your dotfiles inside WSL

3. After installation, you can access your Linux environment by running "Ubuntu" from the Start menu

## Components

### Shell Setup

- **Zsh**: Modern shell with plugins and customizations
- **Fish**: User-friendly alternative shell with syntax highlighting and autosuggestions

### Development Tools

- **Neovim**: Modern, highly extensible text editor
- **WezTerm**: GPU-accelerated cross-platform terminal emulator
- **Helix**: Modal text editor with modern features
- **Git**: Customized Git configuration with useful aliases and settings
- **Tmux**: Terminal multiplexer configuration
- **Tig**: Text-mode interface for Git

### Language Support

Uses [mise](https://github.com/jdx/mise) (formerly rtx) for managing:
- Python
- Ruby
- Node.js
- Go
- Rust
- Bun
- Deno

### macOS Specific

- **sketchybar**: Highly customizable macOS status bar
- **borders**: Window border enhancement
- **aerospace**: Window management

### Package Management

- Homebrew packages (macOS/Linux)
- Cargo (Rust) packages
- Go packages
- Gem (Ruby) packages
- NPM packages

## Platform-Specific Considerations

### macOS

- Includes configurations for macOS-specific tools like sketchybar
- Uses Homebrew for package management
- Configures macOS-specific paths for applications

### Windows/WSL

- Automatically sets up WSL2 environment
- Installs essential Linux packages using apt
- Configures proper paths for cross-platform compatibility
- Skips macOS-specific configurations

## Updating

To update your dotfiles, pull the latest changes and run the install script again:

```bash
cd path/to/dotfiles
git pull
./install.sh
```

## Structure

```
dotfiles/
├── config/            # Application configurations
├── git/               # Git configuration
├── packages/          # Package lists for various package managers
├── shell/             # Shell configurations
│   ├── fish/          # Fish shell config
│   └── zsh/           # Zsh shell config
├── install.sh         # Main installation script
└── install-windows.ps1 # Windows/WSL installation script