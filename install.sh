#!/bin/bash

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Ensure Homebrew is installed
ensure_homebrew() {
    if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is not installed. Would you like to install it? (y/N)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        else
            echo "Skipping Homebrew installation"
            return 1
        fi
    fi
    return 0
}

# Create symbolic links
create_symlinks() {
    echo "Creating symbolic links..."
    
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
    ln -sf "$DOTFILES_DIR/shell/zsh/.zshrc" "$HOME/.zshrc"
    ln -sf "$DOTFILES_DIR/shell/zsh/.zshenv" "$HOME/.zshenv"
    ln -sf "$DOTFILES_DIR/shell/zsh/.zprofile" "$HOME/.zprofile"
    ln -sf "$DOTFILES_DIR/shell/zsh/functions.zsh" "$HOME/.zsh/functions.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/aliases.zsh" "$HOME/.zsh/aliases.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/prompt.zsh" "$HOME/.zsh/prompt.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/brew.zsh" "$HOME/.zsh/brew.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/options.zsh" "$HOME/.zsh/options.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/plugins.zsh" "$HOME/.zsh/plugins.zsh"
    
    # Fish shell
    mkdir -p "$HOME/.config/fish"
    ln -sf "$DOTFILES_DIR/shell/fish/config.fish" "$HOME/.config/fish/config.fish"
    ln -sf "$DOTFILES_DIR/shell/fish/functions" "$HOME/.config/fish/functions"
    ln -sf "$DOTFILES_DIR/shell/fish/conf.d" "$HOME/.config/fish/conf.d"
    ln -sf "$DOTFILES_DIR/shell/fish/completions" "$HOME/.config/fish/completions"
    
    # Git
    backup_existing_config "$HOME/.config/git"
    mkdir -p "$HOME/.config/git"
    ln -sf "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"
    ln -sf "$DOTFILES_DIR/git/.gitignore_global" "$HOME/.config/git/ignore"
    ln -sf "$DOTFILES_DIR/git/.gitmessage" "$HOME/.config/git/message"
    ln -sf "$DOTFILES_DIR/git/.gitmessage.emoji" "$HOME/.config/git/message.emoji"
    ln -sf "$DOTFILES_DIR/git/config.local" "$HOME/.config/git/config.local"
    ln -sf "$DOTFILES_DIR/git/config.sub" "$HOME/.config/git/config.sub"
    
    # Config files
    mkdir -p "$HOME/.config"
    backup_existing_config "$HOME/.config/nvim"
    backup_existing_config "$HOME/.config/wezterm"
    backup_existing_config "$HOME/.config/helix"
    backup_existing_config "$HOME/.config/starship.toml"
    backup_existing_config "$HOME/.config/mise/config.toml"
    backup_existing_config "$HOME/.config/tmux.conf"
    backup_existing_config "$HOME/.tigrc"
    backup_existing_config "$HOME/.config/aerospace"
    backup_existing_config "$HOME/.config/borders"
    backup_existing_config "$HOME/.config/sketchybar"
    
    ln -sf "$DOTFILES_DIR/config/nvim" "$HOME/.config/nvim"
    ln -sf "$DOTFILES_DIR/config/wezterm" "$HOME/.config/wezterm"
    ln -sf "$DOTFILES_DIR/config/helix" "$HOME/.config/helix"
    ln -sf "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
    ln -sf "$DOTFILES_DIR/config/mise" "$HOME/.config/mise"
    ln -sf "$DOTFILES_DIR/config/tmux/tmux.conf" "$HOME/.tmux.conf"
    ln -sf "$DOTFILES_DIR/config/tig/.tigrc" "$HOME/.tigrc"
    ln -sf "$DOTFILES_DIR/config/aerospace" "$HOME/.config/aerospace"
    ln -sf "$DOTFILES_DIR/config/borders" "$HOME/.config/borders"
    ln -sf "$DOTFILES_DIR/config/sketchybar" "$HOME/.config/sketchybar"
    
    # VSCode
    backup_existing_config "$HOME/Library/Application Support/Code/User/settings.json"
    mkdir -p "$HOME/Library/Application Support/Code/User"
    ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"

    # Cursor
    backup_existing_config "$HOME/Library/Application Support/Cursor/User/settings.json"
    mkdir -p "$HOME/Library/Application Support/Cursor/User"
    ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Cursor/User/settings.json"
}

# Install languages with mise
install_languages() {
    echo "Installing languages with mise..."
    
    # Install mise if not installed
    if ! command -v mise >/dev/null 2>&1; then
        echo "Installing mise..."
        if ! ensure_homebrew; then
            echo "Homebrew is required to install mise. Skipping language installation."
            return 1
        fi
        brew install mise
    fi

    # Initialize mise
    echo "Initializing mise..."
    mise install

    # Install languages
    echo "Installing languages..."
    mise use --global python@3.12
    mise use --global ruby@latest
    mise use --global node@latest
    mise use --global go@latest
    mise use --global rust@latest
    mise use --global bun@latest
    mise use --global deno@latest

    # Verify installations
    echo "Verifying installations..."
    mise list
}

# Install packages
install_packages() {
    echo "Installing packages..."
    
    # Ensure Homebrew is installed
    if ! ensure_homebrew; then
        echo "Homebrew is required to install packages. Skipping package installation."
        return 1
    fi
    
    if [ -f "$DOTFILES_DIR/packages/Brewfile" ]; then
        echo "Installing Homebrew packages..."
        brew bundle --file="$DOTFILES_DIR/packages/Brewfile"
    fi
    
    # Rust packages
    if [ -f "$DOTFILES_DIR/packages/cargo.txt" ]; then
        echo "Installing Rust packages..."
        while IFS= read -r line || [ -n "$line" ]; do
            # コメント行をスキップ
            [[ $line =~ ^#.*$ ]] && continue
            # 空行をスキップ
            [[ -z $line ]] && continue
            
            if [[ $line == "pacifica" ]]; then
                cargo install --git https://github.com/serinuntius/pacifica.git
            else
                cargo install "$line"
            fi
        done < "$DOTFILES_DIR/packages/cargo.txt"
    fi
    
    # Go packages
    if [ -f "$DOTFILES_DIR/packages/go.txt" ]; then
        echo "Installing Go packages..."
        cat "$DOTFILES_DIR/packages/go.txt" | xargs -n 1 go install
    fi
    
    # Ruby gems
    if [ -f "$DOTFILES_DIR/packages/gem.txt" ]; then
        echo "Installing Ruby gems..."
        cat "$DOTFILES_DIR/packages/gem.txt" | xargs gem install
    fi
    
    # NPM packages
    if [ -f "$DOTFILES_DIR/packages/npm.txt" ]; then
        echo "Installing NPM packages..."
        cat "$DOTFILES_DIR/packages/npm.txt" | xargs npm install -g
    fi
}

# Install VSCode extensions
install_vscode_extensions() {
    if ! command -v code >/dev/null 2>&1; then
        echo "VSCode command line tool not found. Skipping VSCode extensions installation."
        return 0
    fi

    echo "Installing VSCode extensions..."
    if [ -f "$DOTFILES_DIR/config/vscode/extensions.txt" ]; then
        cat "$DOTFILES_DIR/config/vscode/extensions.txt" | while read -r extension; do
            [ -n "$extension" ] && code --install-extension "$extension" --force
        done
    fi
}

# Install Cursor extensions
install_cursor_extensions() {
    if ! command -v cursor >/dev/null 2>&1; then
        echo "Cursor command line tool not found. Skipping Cursor extensions installation."
        return 0
    fi

    echo "Installing Cursor extensions..."
    if [ -f "$DOTFILES_DIR/config/vscode/extensions.txt" ]; then
        cat "$DOTFILES_DIR/config/vscode/extensions.txt" | while read -r extension; do
            [ -n "$extension" ] && cursor --install-extension "$extension" --force
        done
    fi
}

# Setup sketchybar
setup_sketchybar() {
    echo "Setting up sketchybar..."
    
    # Check if sketchybar is installed
    if ! command -v sketchybar >/dev/null 2>&1; then
        echo "Error: sketchybar is not installed. Please run brew bundle first."
        return 1
    fi
    
    # Install SbarLua
    if [ ! -d "$HOME/.local/share/sketchybar_lua" ]; then
        echo "Installing SbarLua..."
        (git clone https://github.com/FelixKratz/SbarLua.git /tmp/SbarLua && cd /tmp/SbarLua/ && make install && rm -rf /tmp/SbarLua/) || {
            echo "Error: Failed to install SbarLua"
            return 1
        }
    fi

    # Install sketchybar app font
    if [ ! -f "$HOME/Library/Fonts/sketchybar-app-font.ttf" ]; then
        echo "Installing sketchybar app font..."
        curl -L https://github.com/kvndrsslr/sketchybar-app-font/releases/download/v2.0.28/sketchybar-app-font.ttf -o "$HOME/Library/Fonts/sketchybar-app-font.ttf" || {
            echo "Error: Failed to download sketchybar app font"
            return 1
        }
    fi

    # Check screen recording permission
    if ! tccutil query ScreenCapture com.felixkratz.sketchybar >/dev/null 2>&1; then
        echo "Warning: sketchybar needs screen recording permission"
        echo "Please enable it in System Settings > Privacy & Security > Screen Recording"
        echo "After enabling the permission, run: brew services restart sketchybar"
    else
        # Restart sketchybar
        echo "Restarting sketchybar..."
        brew services restart sketchybar || {
            echo "Error: Failed to restart sketchybar"
            return 1
        }
    fi
}

main() {
    echo "This script will backup existing configurations and create new symlinks."
    echo "Your existing configurations will be backed up to ~/.dotfiles_backup/"
    echo "The following operations will be performed:"
    echo "1. Backup and create symbolic links for configuration files"
    echo "2. Install mise and required languages"
    echo "3. Install/update packages (Homebrew, Rust, Go, Ruby, NPM)"
    echo "4. Install VSCode/Cursor extensions"
    echo "5. Setup sketchybar"
    
    read -p "Do you want to continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 1
    fi

    echo "Setting up dotfiles..."
    create_symlinks
    install_languages
    install_packages
    install_vscode_extensions
    install_cursor_extensions
    setup_sketchybar
    echo "Done! Please restart your shell to apply all changes."
    echo "Your old configurations have been backed up to ~/.dotfiles_backup/"
    echo "Important: Don't forget to enable screen recording permission for sketchybar!"
}

main 