#!/bin/bash

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Create symbolic links
create_symlinks() {
    echo "Creating symbolic links..."
    
    # Shell
    ln -sf "$DOTFILES_DIR/shell/zsh/.zshrc" "$HOME/.zshrc"
    ln -sf "$DOTFILES_DIR/shell/zsh/.zshenv" "$HOME/.zshenv"
    ln -sf "$DOTFILES_DIR/shell/zsh/.zprofile" "$HOME/.zprofile"
    
    # Git
    mkdir -p "$HOME/.config/git"
    ln -sf "$DOTFILES_DIR/git/.gitconfig" "$HOME/.gitconfig"
    ln -sf "$DOTFILES_DIR/git/.gitignore_global" "$HOME/.config/git/ignore"
    ln -sf "$DOTFILES_DIR/git/.gitmessage" "$HOME/.config/git/message"
    ln -sf "$DOTFILES_DIR/git/.gitmessage.emoji" "$HOME/.config/git/message.emoji"
    ln -sf "$DOTFILES_DIR/git/config.local" "$HOME/.config/git/config.local"
    ln -sf "$DOTFILES_DIR/git/config.sub" "$HOME/.config/git/config.sub"
    
    # Config files
    mkdir -p "$HOME/.config"
    ln -sf "$DOTFILES_DIR/config/nvim" "$HOME/.config/nvim"
    ln -sf "$DOTFILES_DIR/config/wezterm" "$HOME/.config/wezterm"
    ln -sf "$DOTFILES_DIR/config/helix" "$HOME/.config/helix"
    ln -sf "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
    ln -sf "$DOTFILES_DIR/config/tmux/tmux.conf" "$HOME/.tmux.conf"
    ln -sf "$DOTFILES_DIR/config/tig/.tigrc" "$HOME/.tigrc"

    # VSCode
    mkdir -p "$HOME/Library/Application Support/Code/User"
    ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"

    # Cursor
    mkdir -p "$HOME/Library/Application Support/Cursor/User"
    ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Cursor/User/settings.json"
}

# Install packages
install_packages() {
    echo "Installing packages..."
    
    # Homebrew
    if ! command -v brew >/dev/null 2>&1; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    brew bundle --file="$DOTFILES_DIR/packages/Brewfile"
    
    # Rust packages
    if [ -f "$DOTFILES_DIR/packages/cargo.txt" ]; then
        cat "$DOTFILES_DIR/packages/cargo.txt" | xargs cargo install
    fi
    
    # Go packages
    if [ -f "$DOTFILES_DIR/packages/go.txt" ]; then
        cat "$DOTFILES_DIR/packages/go.txt" | xargs -I {} go install {}
    fi
    
    # Ruby gems
    if [ -f "$DOTFILES_DIR/packages/gem.txt" ]; then
        cat "$DOTFILES_DIR/packages/gem.txt" | xargs gem install
    fi
    
    # NPM packages
    if [ -f "$DOTFILES_DIR/packages/npm.txt" ]; then
        cat "$DOTFILES_DIR/packages/npm.txt" | xargs npm install -g
    fi
}

# Install VSCode extensions
install_vscode_extensions() {
    echo "Installing VSCode extensions..."
    if ! command -v code >/dev/null 2>&1; then
        echo "VSCode command line tool not found. Please install VSCode first."
        return 1
    fi

    if [ -f "$DOTFILES_DIR/config/vscode/extensions.txt" ]; then
        cat "$DOTFILES_DIR/config/vscode/extensions.txt" | while read extension; do
            code --install-extension "$extension" --force
        done
    fi
}

# Install Cursor extensions
install_cursor_extensions() {
    echo "Installing Cursor extensions..."
    if ! command -v cursor >/dev/null 2>&1; then
        echo "Cursor command line tool not found. Please install Cursor first."
        return 1
    fi

    if [ -f "$DOTFILES_DIR/config/vscode/extensions.txt" ]; then
        cat "$DOTFILES_DIR/config/vscode/extensions.txt" | while read extension; do
            cursor --install-extension "$extension" --force
        done
    fi
}

main() {
    echo "Setting up dotfiles..."
    create_symlinks
    install_packages
    install_vscode_extensions
    install_cursor_extensions
    echo "Done! Please restart your shell."
}

main 