#!/bin/bash

# This script is responsible for creating symlinks for dotfiles
# It can be run independently or sourced by other scripts

set -euo pipefail

# If this script is being sourced, DOTFILES_DIR might already be set
# If run directly, we need to determine the dotfiles directory
if [[ -z "${DOTFILES_DIR:-}" ]]; then
    DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

# Detect OS
detect_os() {
    unameOut="$(uname -s)"
    case "${unameOut}" in
        Linux*)
            if grep -q Microsoft /proc/version 2>/dev/null; then
                echo "wsl"
            else
                echo "linux"
            fi
            ;;
        Darwin*)    echo "macos";;
        *)          echo "unknown";;
    esac
}

# If OS_TYPE is not already set by the parent script, detect it
if [[ -z "${OS_TYPE:-}" ]]; then
    OS_TYPE=$(detect_os)
    echo "Detected OS: $OS_TYPE"
fi

# Backup function
backup_existing_config() {
    local file="$1"
    if [ -e "$file" ]; then
        local backup_dir="$HOME/.dotfiles_backup/$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$backup_dir"
        cp -R "$file" "$backup_dir/"
        echo "Backed up $file to $backup_dir/"
    fi
}

# Install Zinit plugin manager for Zsh
install_zinit() {
    echo "Installing Zinit plugin manager for Zsh..."
    
    # Check if Zinit is already installed
    ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"
    if [ -f "$ZINIT_HOME/zinit.zsh" ]; then
        echo "Zinit is already installed at $ZINIT_HOME"
        return 0
    fi
    
    # Execute the Zinit installation script
    if [ -f "$DOTFILES_DIR/shell/install_zinit.sh" ]; then
        bash "$DOTFILES_DIR/shell/install_zinit.sh"
    else
        echo "Installing Zinit from GitHub..."
        mkdir -p "$(dirname $ZINIT_HOME)"
        git clone https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
    fi
    
    # Verify installation
    if [ -f "$ZINIT_HOME/zinit.zsh" ]; then
        echo "Zinit installed successfully"
    else
        echo "Warning: Failed to install Zinit. Some Zsh features may not work."
    fi
}

# Safe symlink creation function
safe_link() {
    local src="$1"
    local dest="$2"
    
    echo "Linking: $src -> $dest"
    
    # 最初に親ディレクトリをチェック
    local parent_dir=$(dirname "$dest")
    if [ ! -d "$parent_dir" ]; then
        echo "Creating parent directory: $parent_dir"
        mkdir -p "$parent_dir"
    fi
    
    # ディレクトリ内のシンボリックリンクをチェック
    if [ -d "$dest" ] && [ ! -L "$dest" ]; then
        echo "Checking for nested symlinks in: $dest"
        local base_name=$(basename "$dest")
        if [ -e "$dest/$base_name" ]; then
            echo "Removing nested symlink: $dest/$base_name"
            rm -f "$dest/$base_name"
        fi
    fi
    
    # 既存のシンボリックリンク、ファイル、またはディレクトリを削除
    if [ -e "$dest" ] || [ -L "$dest" ]; then
        if [ -L "$dest" ] || [ -f "$dest" ]; then
            echo "Removing existing symlink/file: $dest"
            rm -f "$dest"
        elif [ -d "$dest" ]; then
            echo "Removing existing directory recursively: $dest"
            rm -rf "$dest"
        fi
    fi
    
    # 新しいシンボリックリンクを作成
    echo "Creating symlink: $src -> $dest"
    ln -sf "$src" "$dest"
}

# Create symbolic links
create_symlinks() {
    echo "Creating symbolic links..."
    
    # Install Zinit first (required for Zsh plugins)
    install_zinit
    
    # Shell
    backup_existing_config "$HOME/.zshrc"
    backup_existing_config "$HOME/.zshenv"
    backup_existing_config "$HOME/.zprofile"
    backup_existing_config "$HOME/.zsh"
    backup_existing_config "$HOME/.config/fish/config.fish"
    backup_existing_config "$HOME/.config/fish/functions"
    backup_existing_config "$HOME/.config/fish/conf.d"
    backup_existing_config "$HOME/.config/fish/completions"
    
    # Zsh
    if [ -L "$HOME/.zsh" ]; then
        rm "$HOME/.zsh"
    fi
    mkdir -p "$HOME/.zsh"
    # Ensure the directory exists before creating symlinks
    if [ ! -d "$HOME/.zsh" ]; then
        echo "Failed to create .zsh directory. Please check permissions."
        exit 1
    fi
    safe_link "$DOTFILES_DIR/shell/zsh/.zshrc" "$HOME/.zshrc"
    safe_link "$DOTFILES_DIR/shell/zsh/.zshenv" "$HOME/.zshenv"
    safe_link "$DOTFILES_DIR/shell/zsh/.zprofile" "$HOME/.zprofile"
    safe_link "$DOTFILES_DIR/shell/zsh/functions.zsh" "$HOME/.zsh/functions.zsh"
    safe_link "$DOTFILES_DIR/shell/zsh/aliases.zsh" "$HOME/.zsh/aliases.zsh"
    safe_link "$DOTFILES_DIR/shell/zsh/prompt.zsh" "$HOME/.zsh/prompt.zsh"
    safe_link "$DOTFILES_DIR/shell/zsh/brew.zsh" "$HOME/.zsh/brew.zsh"
    safe_link "$DOTFILES_DIR/shell/zsh/options.zsh" "$HOME/.zsh/options.zsh"
    safe_link "$DOTFILES_DIR/shell/zsh/plugins.zsh" "$HOME/.zsh/plugins.zsh"
    safe_link "$DOTFILES_DIR/shell/zsh/trash.zsh" "$HOME/.zsh/trash.zsh"
    
    # Only link sketchybar config on macOS
    if [ "$OS_TYPE" = "macos" ]; then
        safe_link "$DOTFILES_DIR/shell/zsh/sketchybar.zsh" "$HOME/.zsh/sketchybar.zsh"
    fi
    
    # Fish shell
    mkdir -p "$HOME/.config/fish"
    safe_link "$DOTFILES_DIR/shell/fish/config.fish" "$HOME/.config/fish/config.fish"
    safe_link "$DOTFILES_DIR/shell/fish/functions" "$HOME/.config/fish/functions"
    safe_link "$DOTFILES_DIR/shell/fish/conf.d" "$HOME/.config/fish/conf.d"
    safe_link "$DOTFILES_DIR/shell/fish/completions" "$HOME/.config/fish/completions"
    
    # Git
    backup_existing_config "$HOME/.config/git"
    mkdir -p "$HOME/.config/git"
    safe_link "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"
    safe_link "$DOTFILES_DIR/git/.gitignore_global" "$HOME/.config/git/ignore"
    safe_link "$DOTFILES_DIR/git/.gitmessage" "$HOME/.config/git/message"
    safe_link "$DOTFILES_DIR/git/.gitmessage.emoji" "$HOME/.config/git/message.emoji"
    safe_link "$DOTFILES_DIR/git/config.local" "$HOME/.config/git/config.local"
    safe_link "$DOTFILES_DIR/git/config.sub" "$HOME/.config/git/config.sub"
    
    # Config files
    mkdir -p "$HOME/.config"
    backup_existing_config "$HOME/.config/nvim"
    backup_existing_config "$HOME/.config/wezterm"
    backup_existing_config "$HOME/.config/helix"
    backup_existing_config "$HOME/.config/starship.toml"
    backup_existing_config "$HOME/.config/mise/config.toml"
    backup_existing_config "$HOME/.config/tmux.conf"
    backup_existing_config "$HOME/.tigrc"
    
    # Remove existing symlinks or directories before creating new ones
    [ -e "$HOME/.config/nvim" ] && rm -rf "$HOME/.config/nvim"
    [ -e "$HOME/.config/wezterm" ] && rm -rf "$HOME/.config/wezterm"
    [ -e "$HOME/.config/helix" ] && rm -rf "$HOME/.config/helix"
    [ -e "$HOME/.config/mise" ] && rm -rf "$HOME/.config/mise"
    
    # Create new symlinks
    safe_link "$DOTFILES_DIR/config/nvim" "$HOME/.config/nvim"
    safe_link "$DOTFILES_DIR/config/wezterm" "$HOME/.config/wezterm"
    safe_link "$DOTFILES_DIR/config/helix" "$HOME/.config/helix"
    safe_link "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
    safe_link "$DOTFILES_DIR/config/mise" "$HOME/.config/mise"
    safe_link "$DOTFILES_DIR/config/tmux/tmux.conf" "$HOME/.tmux.conf"
    safe_link "$DOTFILES_DIR/config/tig/.tigrc" "$HOME/.tigrc"
    
    # MacOS specific configs
    if [ "$OS_TYPE" = "macos" ]; then
        backup_existing_config "$HOME/.config/aerospace"
        backup_existing_config "$HOME/.config/borders"
        backup_existing_config "$HOME/.config/sketchybar"
        
        # Remove existing symlinks or directories before creating new ones
        [ -e "$HOME/.config/aerospace" ] && rm -rf "$HOME/.config/aerospace"
        [ -e "$HOME/.config/borders" ] && rm -rf "$HOME/.config/borders"
        [ -e "$HOME/.config/sketchybar" ] && rm -rf "$HOME/.config/sketchybar"
        
        # Create new symlinks for macOS specific configs
        safe_link "$DOTFILES_DIR/config/aerospace" "$HOME/.config/aerospace"
        safe_link "$DOTFILES_DIR/config/borders" "$HOME/.config/borders"
        safe_link "$DOTFILES_DIR/config/sketchybar" "$HOME/.config/sketchybar"
        
        # VSCode for macOS
        backup_existing_config "$HOME/Library/Application Support/Code/User/settings.json"
        mkdir -p "$HOME/Library/Application Support/Code/User"
        safe_link "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"

        # Cursor for macOS
        backup_existing_config "$HOME/Library/Application Support/Cursor/User/settings.json"
        backup_existing_config "$HOME/Library/Application Support/Cursor/User/mcp.json"
        mkdir -p "$HOME/Library/Application Support/Cursor/User"
        safe_link "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Cursor/User/settings.json"
        safe_link "$DOTFILES_DIR/config/cursor/mcp.json" "$HOME/Library/Application Support/Cursor/User/mcp.json"
    elif [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        # VSCode for Linux
        backup_existing_config "$HOME/.config/Code/User/settings.json"
        mkdir -p "$HOME/.config/Code/User"
        safe_link "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/.config/Code/User/settings.json"
        
        # Cursor for Linux
        backup_existing_config "$HOME/.config/Cursor/User/settings.json"
        backup_existing_config "$HOME/.config/Cursor/User/mcp.json"
        mkdir -p "$HOME/.config/Cursor/User"
        safe_link "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/.config/Cursor/User/settings.json"
        safe_link "$DOTFILES_DIR/config/cursor/mcp.json" "$HOME/.config/Cursor/User/mcp.json"
        
        # WSL specific configurations (if any)
        if [ "$OS_TYPE" = "wsl" ]; then
            echo "Setting up WSL specific configurations..."
            # Any WSL specific configurations can go here

            # Create symlink for WezTerm config on Windows side
            echo "Attempting to create WezTerm symlink on Windows side..."
            
            # Get Windows username and construct the profile path
            # Ensure powershell.exe is available before attempting to run it
            if command -v powershell.exe >/dev/null 2>&1; then
                windows_username=$(powershell.exe -Command "\$env:USERNAME" 2>/dev/null | tr -d '\r')
                if [ -n "$windows_username" ]; then
                    windows_userprofile="/mnt/c/Users/$windows_username"
                    
                    if [ -d "$windows_userprofile" ]; then
                        echo "Windows user profile found: $windows_userprofile"
                        windows_config_dir="$windows_userprofile/.config"
                        windows_wezterm_dir="$windows_config_dir/wezterm"
                        
                        # Create .config directory on Windows side if it doesn't exist
                        if [ ! -d "$windows_config_dir" ]; then
                            echo "Creating $windows_config_dir on Windows side..."
                            mkdir -p "$windows_config_dir"
                        fi
                        
                        # Backup existing WezTerm config on Windows side
                        if [ -e "$windows_wezterm_dir" ]; then
                            backup_date=$(date +%Y%m%d_%H%M%S)
                            echo "Backing up existing WezTerm config at $windows_wezterm_dir to $windows_wezterm_dir.backup.$backup_date"
                            mv "$windows_wezterm_dir" "$windows_wezterm_dir.backup.$backup_date"
                        fi
                        
                        # Create the symlink using safe_link function
                        echo "Creating symlink for WezTerm config at $windows_wezterm_dir"
                        safe_link "$DOTFILES_DIR/config/wezterm" "$windows_wezterm_dir"
                        echo "WezTerm symlink created on Windows side."
                    else
                        echo "Warning: Windows user profile directory not found at $windows_userprofile. Skipping WezTerm symlink creation on Windows side."
                    fi
                else
                    echo "Warning: Could not retrieve Windows username via PowerShell. Skipping WezTerm symlink creation on Windows side."
                fi
            else
                echo "Warning: powershell.exe not found in PATH. Cannot determine Windows username. Skipping WezTerm symlink creation on Windows side."
            fi
        fi
    fi
}

# Main function
main() {
    echo "Creating symlinks for dotfiles..."
    create_symlinks
    echo "Symlinks created successfully!"
}

# Only run the main function if this script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi