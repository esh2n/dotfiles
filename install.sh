#!/bin/bash

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect OS
detect_os() {
    unameOut="$(uname -s)"
    case "${unameOut}" in
        Linux*)
            # Check multiple indicators for WSL, case-insensitive
            if grep -qi Microsoft /proc/version 2>/dev/null || \
               grep -qi WSL /proc/sys/kernel/osrelease 2>/dev/null || \
               grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
                echo "wsl"
            else
                echo "linux"
            fi
            ;;
        Darwin*)    echo "macos";;
        *)          echo "unknown";;
    esac
}

OS_TYPE=$(detect_os)
echo "Detected OS: $OS_TYPE"

# Check if we're running in an unsupported environment
if [ "$OS_TYPE" = "unknown" ]; then
    echo "Error: Unsupported operating system."
    echo "This script supports macOS, Linux, and Windows Subsystem for Linux (WSL)."
    exit 1
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

# Ensure Homebrew is installed
ensure_homebrew() {
    if [ "$OS_TYPE" != "macos" ] && [ "$OS_TYPE" != "linux" ] && [ "$OS_TYPE" != "wsl" ]; then
        echo "Homebrew is only supported on macOS, Linux, and WSL. Skipping Homebrew installation."
        return 1
    fi

    # Check if running as root in Linux/WSL
    if [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        if [ "$(id -u)" = "0" ]; then
            echo "Error: Homebrew should not be installed as root. Please run this script as a regular user."
            echo "If you're in WSL, make sure to start WSL with a non-root user or create a new user first."
            return 1
        fi
    fi

    if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is not installed. Would you like to install it? (y/N)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            
            # Setup Homebrew environment for Linux
            if [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
                echo "Setting up Homebrew environment for Linux/WSL..."
                
                # Try to find the Homebrew installation
                BREW_PATH=""
                if [ -f ~/.linuxbrew/bin/brew ]; then
                    BREW_PATH=~/.linuxbrew/bin/brew
                elif [ -f /home/linuxbrew/.linuxbrew/bin/brew ]; then
                    BREW_PATH=/home/linuxbrew/.linuxbrew/bin/brew
                fi
                
                if [ -n "$BREW_PATH" ]; then
                    # Add to shell configuration files
                    for shell_rc in ~/.bashrc ~/.zshrc; do
                        if [ -f "$shell_rc" ]; then
                            if ! grep -q "brew shellenv" "$shell_rc"; then
                                echo "Adding Homebrew to $shell_rc..."
                                echo "" >> "$shell_rc"
                                echo "# Homebrew" >> "$shell_rc"
                                echo "eval \"\$($BREW_PATH shellenv)\"" >> "$shell_rc"
                            else
                                echo "Homebrew already configured in $shell_rc"
                            fi
                        else
                            echo "Creating $shell_rc with Homebrew configuration..."
                            echo "# Homebrew" > "$shell_rc"
                            echo "eval \"\$($BREW_PATH shellenv)\"" >> "$shell_rc"
                        fi
                    done
                    
                    # Set up for current session
                    eval "$($BREW_PATH shellenv)"
                    echo "Homebrew environment configured for Linux/WSL"
                else
                    echo "Homebrew was installed but brew executable not found in expected locations"
                    echo "You may need to manually configure Homebrew in your shell configuration"
                fi
            fi
        else
            echo "Skipping Homebrew installation"
            return 1
        fi
    fi
    
    # Double check brew command is available
    if command -v brew >/dev/null 2>&1; then
        echo "Homebrew is properly installed and in PATH"
        return 0
    else
        echo "Failed to make Homebrew available in current session"
        return 1
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
    ln -sf "$DOTFILES_DIR/shell/zsh/.zshrc" "$HOME/.zshrc"
    ln -sf "$DOTFILES_DIR/shell/zsh/.zshenv" "$HOME/.zshenv"
    ln -sf "$DOTFILES_DIR/shell/zsh/.zprofile" "$HOME/.zprofile"
    ln -sf "$DOTFILES_DIR/shell/zsh/functions.zsh" "$HOME/.zsh/functions.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/aliases.zsh" "$HOME/.zsh/aliases.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/prompt.zsh" "$HOME/.zsh/prompt.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/brew.zsh" "$HOME/.zsh/brew.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/options.zsh" "$HOME/.zsh/options.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/plugins.zsh" "$HOME/.zsh/plugins.zsh"
    ln -sf "$DOTFILES_DIR/shell/zsh/trash.zsh" "$HOME/.zsh/trash.zsh"
    
    # Only link sketchybar config on macOS
    if [ "$OS_TYPE" = "macos" ]; then
        ln -sf "$DOTFILES_DIR/shell/zsh/sketchybar.zsh" "$HOME/.zsh/sketchybar.zsh"
    fi
    
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
    
    ln -sf "$DOTFILES_DIR/config/nvim" "$HOME/.config/nvim"
    ln -sf "$DOTFILES_DIR/config/wezterm" "$HOME/.config/wezterm"
    ln -sf "$DOTFILES_DIR/config/helix" "$HOME/.config/helix"
    ln -sf "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
    ln -sf "$DOTFILES_DIR/config/mise" "$HOME/.config/mise"
    ln -sf "$DOTFILES_DIR/config/tmux/tmux.conf" "$HOME/.tmux.conf"
    ln -sf "$DOTFILES_DIR/config/tig/.tigrc" "$HOME/.tigrc"
    
    # MacOS specific configs
    if [ "$OS_TYPE" = "macos" ]; then
        backup_existing_config "$HOME/.config/aerospace"
        backup_existing_config "$HOME/.config/borders"
        backup_existing_config "$HOME/.config/sketchybar"
        
        ln -sf "$DOTFILES_DIR/config/aerospace" "$HOME/.config/aerospace"
        ln -sf "$DOTFILES_DIR/config/borders" "$HOME/.config/borders"
        ln -sf "$DOTFILES_DIR/config/sketchybar" "$HOME/.config/sketchybar"
        
        # VSCode for macOS
        backup_existing_config "$HOME/Library/Application Support/Code/User/settings.json"
        mkdir -p "$HOME/Library/Application Support/Code/User"
        ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"

        # Cursor for macOS
        backup_existing_config "$HOME/Library/Application Support/Cursor/User/settings.json"
        backup_existing_config "$HOME/Library/Application Support/Cursor/User/mcp.json"
        mkdir -p "$HOME/Library/Application Support/Cursor/User"
        ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/Library/Application Support/Cursor/User/settings.json"
        ln -sf "$DOTFILES_DIR/config/cursor/mcp.json" "$HOME/Library/Application Support/Cursor/User/mcp.json"
    elif [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        # VSCode for Linux
        backup_existing_config "$HOME/.config/Code/User/settings.json"
        mkdir -p "$HOME/.config/Code/User"
        ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/.config/Code/User/settings.json"
        
        # Cursor for Linux
        backup_existing_config "$HOME/.config/Cursor/User/settings.json"
        backup_existing_config "$HOME/.config/Cursor/User/mcp.json"
        mkdir -p "$HOME/.config/Cursor/User"
        ln -sf "$DOTFILES_DIR/config/vscode/settings.json" "$HOME/.config/Cursor/User/settings.json"
        ln -sf "$DOTFILES_DIR/config/cursor/mcp.json" "$HOME/.config/Cursor/User/mcp.json"
        
        # WSL specific configurations (if any)
        if [ "$OS_TYPE" = "wsl" ]; then
            echo "[DEBUG] Running WSL specific configurations..." # デバッグ追加
            # Any WSL specific configurations can go here

            # Create symlink for WezTerm config on Windows side
            echo "[DEBUG] Attempting to create WezTerm symlink on Windows side..." # デバッグ追加
            
            # Get Windows username and construct the profile path
            # Ensure powershell.exe is available before attempting to run it
            if command -v powershell.exe >/dev/null 2>&1; then
                echo "[DEBUG] powershell.exe found." # デバッグ追加
                windows_username=$(powershell.exe -Command "\$env:USERNAME" 2>/dev/null | tr -d '\r')
                echo "[DEBUG] Windows Username obtained: '$windows_username'" # デバッグ追加
                if [ -n "$windows_username" ]; then
                    windows_userprofile="/mnt/c/Users/$windows_username"
                    echo "[DEBUG] Windows User Profile Path: '$windows_userprofile'" # デバッグ追加
                    
                    if [ -d "$windows_userprofile" ]; then
                        echo "[DEBUG] Windows user profile directory exists." # デバッグ追加
                        windows_config_dir="$windows_userprofile/.config"
                        windows_wezterm_dir="$windows_config_dir/wezterm"
                        echo "[DEBUG] Target WezTerm Dir: '$windows_wezterm_dir'" # デバッグ追加
                        
                        # Create .config directory on Windows side if it doesn't exist
                        if [ ! -d "$windows_config_dir" ]; then
                            echo "[DEBUG] Creating Windows .config directory: '$windows_config_dir'" # デバッグ追加
                            mkdir -p "$windows_config_dir"
                            if [ $? -ne 0 ]; then echo "[ERROR] Failed to create directory: $windows_config_dir"; fi # エラーチェック追加
                        fi
                        
                        # Backup existing WezTerm config on Windows side
                        echo "[DEBUG] Checking for existing config at '$windows_wezterm_dir' for backup..." # デバッグ追加
                        if [ -e "$windows_wezterm_dir" ]; then
                            backup_date=$(date +%Y%m%d_%H%M%S)
                            echo "[DEBUG] Backing up existing WezTerm config at $windows_wezterm_dir to $windows_wezterm_dir.backup.$backup_date" # デバッグ追加
                            mv "$windows_wezterm_dir" "$windows_wezterm_dir.backup.$backup_date"
                            if [ $? -ne 0 ]; then echo "[ERROR] Failed to backup WezTerm config."; fi # エラーチェック追加
                        fi
                        
                        # Copy WezTerm config directory
                        echo "[DEBUG] Copying WezTerm config: '$DOTFILES_DIR/config/wezterm' -> '$windows_wezterm_dir'" # デバッグ変更
                        cp -R "$DOTFILES_DIR/config/wezterm" "$windows_wezterm_dir"
                        if [ $? -ne 0 ]; then echo "[ERROR] Failed to copy WezTerm config."; fi # エラーチェック変更
                        echo "[DEBUG] WezTerm config copy attempted." # デバッグ変更

                        # --- VSCode ---
                        echo "[DEBUG] Attempting to copy VSCode settings on Windows side..." # デバッグ変更
                        windows_vscode_user_dir="$windows_userprofile/AppData/Roaming/Code/User"
                        windows_vscode_settings="$windows_vscode_user_dir/settings.json"
                        echo "[DEBUG] Target VSCode Settings: '$windows_vscode_settings'" # デバッグ追加
                        
                        # Create VSCode User directory on Windows side if it doesn't exist
                        if [ ! -d "$windows_vscode_user_dir" ]; then
                            echo "[DEBUG] Creating Windows VSCode User directory: '$windows_vscode_user_dir'" # デバッグ追加
                            mkdir -p "$windows_vscode_user_dir"
                            if [ $? -ne 0 ]; then echo "[ERROR] Failed to create directory: $windows_vscode_user_dir"; fi # エラーチェック追加
                        fi

                        # Backup existing VSCode settings on Windows side
                        echo "[DEBUG] Checking for existing config at '$windows_vscode_settings' for backup..." # デバッグ追加
                        if [ -e "$windows_vscode_settings" ]; then
                             backup_date=$(date +%Y%m%d_%H%M%S)
                             echo "[DEBUG] Backing up existing VSCode settings at $windows_vscode_settings to $windows_vscode_settings.backup.$backup_date" # デバッグ追加
                             mv "$windows_vscode_settings" "$windows_vscode_settings.backup.$backup_date"
                             if [ $? -ne 0 ]; then echo "[ERROR] Failed to backup VSCode settings."; fi # エラーチェック追加
                        fi

                        # Copy VSCode settings file
                        echo "[DEBUG] Copying VSCode settings: '$DOTFILES_DIR/config/vscode/settings.json' -> '$windows_vscode_settings'" # デバッグ変更
                        cp "$DOTFILES_DIR/config/vscode/settings.json" "$windows_vscode_settings"
                        if [ $? -ne 0 ]; then echo "[ERROR] Failed to copy VSCode settings."; fi # エラーチェック変更
                        echo "[DEBUG] VSCode settings copy attempted." # デバッグ変更

                        # --- Cursor ---
                        echo "[DEBUG] Attempting to copy Cursor files on Windows side..." # デバッグ変更
                        windows_cursor_user_dir="$windows_userprofile/.cursor/User"
                        windows_cursor_settings="$windows_cursor_user_dir/settings.json"
                        windows_cursor_mcp="$windows_cursor_user_dir/mcp.json"
                        echo "[DEBUG] Target Cursor Settings: '$windows_cursor_settings'" # デバッグ追加
                        echo "[DEBUG] Target Cursor MCP: '$windows_cursor_mcp'" # デバッグ追加

                        # Create Cursor User directory on Windows side if it doesn't exist
                        if [ ! -d "$windows_cursor_user_dir" ]; then
                            echo "[DEBUG] Creating Windows Cursor User directory: '$windows_cursor_user_dir'" # デバッグ追加
                            mkdir -p "$windows_cursor_user_dir"
                            if [ $? -ne 0 ]; then echo "[ERROR] Failed to create directory: $windows_cursor_user_dir"; fi # エラーチェック追加
                        fi

                        # Backup existing Cursor settings on Windows side
                        echo "[DEBUG] Checking for existing config at '$windows_cursor_settings' for backup..." # デバッグ追加
                        if [ -e "$windows_cursor_settings" ]; then
                             backup_date=$(date +%Y%m%d_%H%M%S)
                             echo "[DEBUG] Backing up existing Cursor settings at $windows_cursor_settings to $windows_cursor_settings.backup.$backup_date" # デバッグ追加
                             mv "$windows_cursor_settings" "$windows_cursor_settings.backup.$backup_date"
                             if [ $? -ne 0 ]; then echo "[ERROR] Failed to backup Cursor settings."; fi # エラーチェック追加
                        fi
                        echo "[DEBUG] Checking for existing config at '$windows_cursor_mcp' for backup..." # デバッグ追加
                        if [ -e "$windows_cursor_mcp" ]; then
                             backup_date=$(date +%Y%m%d_%H%M%S)
                             echo "[DEBUG] Backing up existing Cursor mcp.json at $windows_cursor_mcp to $windows_cursor_mcp.backup.$backup_date" # デバッグ追加
                             mv "$windows_cursor_mcp" "$windows_cursor_mcp.backup.$backup_date"
                             if [ $? -ne 0 ]; then echo "[ERROR] Failed to backup Cursor mcp.json."; fi # エラーチェック追加
                        fi

                        # Copy Cursor files
                        echo "[DEBUG] Copying Cursor settings: '$DOTFILES_DIR/config/vscode/settings.json' -> '$windows_cursor_settings'" # デバッグ変更
                        cp "$DOTFILES_DIR/config/vscode/settings.json" "$windows_cursor_settings" # Use vscode settings for cursor
                        if [ $? -ne 0 ]; then echo "[ERROR] Failed to copy Cursor settings."; fi # エラーチェック変更
                        echo "[DEBUG] Copying Cursor mcp.json: '$DOTFILES_DIR/config/cursor/mcp.json' -> '$windows_cursor_mcp'" # デバッグ変更
                        cp "$DOTFILES_DIR/config/cursor/mcp.json" "$windows_cursor_mcp"
                        if [ $? -ne 0 ]; then echo "[ERROR] Failed to copy Cursor mcp.json."; fi # エラーチェック変更
                        echo "[DEBUG] Cursor files copy attempted." # デバッグ変更

                    else
                        echo "[ERROR] Windows user profile directory not found at '$windows_userprofile'. Skipping Windows side config copy." # エラーメッセージ変更
                    fi
                else
                    echo "[ERROR] Could not retrieve Windows username via PowerShell. Skipping Windows side config copy." # エラーメッセージ変更
                fi
            else
                echo "[ERROR] powershell.exe not found in PATH. Cannot determine Windows username. Skipping Windows side config copy." # エラーメッセージ変更
            fi
        fi
    fi
}

# Install Starship prompt
install_starship() {
    echo "Installing starship prompt..."
    
    # すでにインストールされているか確認
    if command -v starship >/dev/null 2>&1; then
        echo "Starship is already installed."
    else
        echo "Installing starship from the official installer..."
        curl -sS https://starship.rs/install.sh | sh -s -- --yes
        
        if [ $? -ne 0 ]; then
            echo "Failed to install starship. Please install it manually from https://starship.rs"
            return 1
        fi
    fi
    
    # starship設定ファイルをコピー
    echo "Setting up starship configuration..."
    mkdir -p "$HOME/.config"
    cp "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
    
    # WSL環境の場合、Windows側にも設定をコピー
    if [ "$OS_TYPE" = "wsl" ]; then
        echo "Detected WSL environment, configuring starship for Windows side as well..."
        
        # Windows環境変数の取得を試みる
        if command -v powershell.exe >/dev/null 2>&1; then
            windows_username=$(powershell.exe '$env:USERNAME' 2>/dev/null | tr -d '\r')
            
            if [ -n "$windows_username" ]; then
                # Windows側のユーザープロファイルパスを取得
                windows_userprofile=$(wslpath "$(powershell.exe '$env:USERPROFILE' 2>/dev/null | tr -d '\r')")
                
                if [ -d "$windows_userprofile" ]; then
                    echo "Setting up starship for Windows PowerShell..."
                    
                    # PowerShellのプロファイルディレクトリを確認
                    windows_powershell_dir="$windows_userprofile/Documents/PowerShell"
                    if [ ! -d "$windows_powershell_dir" ]; then
                        mkdir -p "$windows_powershell_dir"
                    fi
                    
                    # PowerShellプロファイルにstarship初期化を追加
                    powershell_profile="$windows_powershell_dir/Microsoft.PowerShell_profile.ps1"
                    
                    # プロファイルにstarship initがすでにあるか確認
                    if [ -f "$powershell_profile" ]; then
                        if ! grep -q "starship init" "$powershell_profile"; then
                            echo "Adding starship init to PowerShell profile..."
                            echo "" >> "$powershell_profile"
                            echo "# Initialize Starship prompt" >> "$powershell_profile"
                            echo "Invoke-Expression (&starship init powershell)" >> "$powershell_profile"
                        else
                            echo "Starship already configured in PowerShell profile"
                        fi
                    else
                        echo "Creating PowerShell profile with starship configuration..."
                        echo "# PowerShell profile created by dotfiles installer" > "$powershell_profile"
                        echo "# Initialize Starship prompt" >> "$powershell_profile"
                        echo "Invoke-Expression (&starship init powershell)" >> "$powershell_profile"
                    fi
                    
                    # Windows側にstarship設定をコピー
                    windows_starship_config="$windows_userprofile/.config"
                    mkdir -p "$windows_starship_config"
                    cp "$DOTFILES_DIR/config/starship/starship.toml" "$windows_starship_config/starship.toml"
                    echo "Copied starship configuration to Windows user profile"
                fi
            fi
        fi
    fi
    
    echo "Starship installation and configuration complete."
    return 0
}

# Install languages with mise
install_languages() {
    echo "Installing languages with mise..."
    
    # Install mise if not installed
    if ! command -v mise >/dev/null 2>&1; then
        echo "Installing mise..."
        if [ "$OS_TYPE" = "macos" ]; then
            if ! ensure_homebrew; then
                echo "Homebrew is required to install mise on macOS. Skipping language installation."
                return 1
            fi
            brew install mise
        elif [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
            echo "Installing mise on Linux/WSL..."
            curl https://mise.jdx.dev/install.sh | sh
            
            # Add mise to PATH for the current session
            export PATH="$HOME/.local/bin:$PATH"
        else
            echo "Unknown OS type. Cannot install mise. Skipping language installation."
            return 1
        fi
    fi

    # Install Ruby build dependencies for Linux/WSL
    if [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        echo "Installing Ruby build dependencies..."
        sudo apt-get update
        sudo apt-get install -y libssl-dev libreadline-dev zlib1g-dev autoconf bison \
            build-essential libyaml-dev libreadline-dev libncurses5-dev libffi-dev libgdbm-dev
    fi

    # Initialize mise
    echo "Initializing mise..."
    mise install

    # Install languages with error handling
    echo "Installing languages..."
    
    # Python
    mise use --global python@3.12 || echo "Warning: Failed to install Python"
    
    # Ruby - use specific version for better stability
    if [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        echo "Installing stable Ruby version for Linux/WSL..."
        mise use --global ruby@3.2.2 || echo "Warning: Failed to install Ruby"
    else
        mise use --global ruby@latest || echo "Warning: Failed to install Ruby"
    fi
    
    # Other languages
    mise use --global node@latest || echo "Warning: Failed to install Node.js"
    mise use --global go@latest || echo "Warning: Failed to install Go"
    mise use --global rust@latest || echo "Warning: Failed to install Rust"
    mise use --global bun@latest || echo "Warning: Failed to install Bun"
    mise use --global deno@latest || echo "Warning: Failed to install Deno"

    # Verify installations
    echo "Verifying installations..."
    mise list
}
# Select the appropriate Brewfile based on OS
select_brewfile() {
    if [ "$OS_TYPE" = "macos" ]; then
        echo "$DOTFILES_DIR/packages/Brewfile"
    elif [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        echo "$DOTFILES_DIR/packages/Brewfile.linux"
    else
        echo ""
    fi
}

# Install essential Linux packages
install_linux_essentials() {
    if [ "$OS_TYPE" != "linux" ] && [ "$OS_TYPE" != "wsl" ]; then
        return 0
    fi
    
    echo "Installing essential Linux packages with apt..."
    sudo apt update
    
    # Install absolute essentials first
    echo "Installing build essentials and core utilities..."
    sudo apt install -y build-essential || echo "Warning: Failed to install build-essential"
    sudo apt install -y curl file git unzip wget || echo "Warning: Failed to install core utilities"
    
    # Install zsh and shell utilities
    echo "Installing shell utilities..."
    sudo apt install -y zsh || echo "Warning: Failed to install zsh"
    sudo apt install -y tmux || echo "Warning: Failed to install tmux"
    
    # Install search utilities
    echo "Installing search utilities..."
    sudo apt install -y ripgrep fd-find fzf || echo "Warning: Failed to install search utilities"
    
    # Create symlinks for common tools
    if [ -f /usr/bin/fdfind ] && [ ! -f /usr/local/bin/fd ]; then
        sudo mkdir -p /usr/local/bin
        sudo ln -sf /usr/bin/fdfind /usr/local/bin/fd
        echo "Created symlink for fd command"
    fi

    echo "Linux essential packages installed."
}

# Install packages
install_packages() {
    echo "Installing packages..."
    
    # Install Linux essential packages first (required for Homebrew)
    if [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        install_linux_essentials
    fi
    
    # OS-specific package installations via Homebrew
    if [ "$OS_TYPE" = "macos" ] || [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
        # Install packages using Homebrew
        if ! ensure_homebrew; then
            echo "Homebrew is required to install packages. Skipping Homebrew package installation."
            # Continue with other package managers
        else
            # Make sure brew is in the PATH for the current session
            if [ "$OS_TYPE" = "linux" ] || [ "$OS_TYPE" = "wsl" ]; then
                # Try all possible Homebrew paths
                if [ -f "/home/linuxbrew/.linuxbrew/bin/brew" ]; then
                    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
                    echo "Sourced Homebrew environment from /home/linuxbrew/.linuxbrew"
                elif [ -f "$HOME/.linuxbrew/bin/brew" ]; then
                    eval "$($HOME/.linuxbrew/bin/brew shellenv)"
                    echo "Sourced Homebrew environment from $HOME/.linuxbrew"
                fi
            fi
            
            # Verify brew is available
            if ! command -v brew >/dev/null 2>&1; then
                echo "Warning: brew command not found in PATH. Skipping Homebrew package installation."
                echo "Current PATH: $PATH"
            else
                # Get the appropriate Brewfile
                BREWFILE=$(select_brewfile)
                
                if [ -n "$BREWFILE" ] && [ -f "$BREWFILE" ]; then
                    echo "Installing Homebrew packages using $BREWFILE..."
                    brew bundle --file="$BREWFILE" || echo "Warning: brew bundle failed"
                else
                    echo "No appropriate Brewfile found for $OS_TYPE."
                fi
            fi
        fi
    fi
    
    # Cross-platform packages
    
    # Rust packages
    if command -v cargo >/dev/null 2>&1 && [ -f "$DOTFILES_DIR/packages/cargo.txt" ]; then
        echo "Installing Rust packages..."
        # Set default toolchain to stable
        rustup default stable || echo "Warning: Failed to set default Rust toolchain"
        
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip comment lines
            [[ $line =~ ^#.*$ ]] && continue
            # Skip empty lines
            [[ -z $line ]] && continue
            
            # Extract package name (remove any inline comments)
            package_name=$(echo "$line" | sed 's/\s*#.*$//')
            
            echo "Installing Rust package: $package_name" # デバッグ追加
            if [[ $package_name == "pacifica" ]]; then
                cargo install --git https://github.com/serinuntius/pacifica.git || echo "Warning: Failed to install Rust package: $package_name (from git)" # エラーチェック追加
            else
                cargo install "$package_name" || echo "Warning: Failed to install Rust package: $package_name" # エラーチェック追加
            fi
        done < "$DOTFILES_DIR/packages/cargo.txt"
    fi
    
    # Go packages
    if command -v go >/dev/null 2>&1 && [ -f "$DOTFILES_DIR/packages/go.txt" ]; then
        echo "Installing Go packages..."
        # Make sure GOPATH is set with absolute path
        export GOPATH="$HOME/go"
        mkdir -p "$GOPATH"
        # Explicitly set GOBIN to an absolute path and export it
        export GOBIN="$GOPATH/bin"
        mkdir -p "$GOBIN"
        echo "Using GOPATH: $GOPATH"
        echo "Using GOBIN: $GOBIN" # デバッグ追加
        
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip comment lines and empty lines
            [[ $line =~ ^#.*$ ]] && continue
            [[ -z $line ]] && continue
            
            
            echo "Installing Go package: ${line}@latest" # バージョン指定を追加
            go install "${line}@latest" || echo "Warning: Failed to install Go package: ${line}@latest"
        done < "$DOTFILES_DIR/packages/go.txt"
    fi
    
    if command -v gem >/dev/null 2>&1 && [ -f "$DOTFILES_DIR/packages/gem.txt" ]; then
        echo "Installing Ruby gems..."
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip comment lines and empty lines
            [[ $line =~ ^#.*$ ]] && continue
            [[ -z $line ]] && continue
            
            # Extract package name (remove any inline comments)
            package_name=$(echo "$line" | sed 's/\s*#.*$//')
            echo "Installing Ruby gem: $package_name"
            gem install "$package_name" || echo "Warning: Failed to install Ruby gem: $package_name"
        done < "$DOTFILES_DIR/packages/gem.txt"
    fi
    
    # NPM packages
    if command -v npm >/dev/null 2>&1 && [ -f "$DOTFILES_DIR/packages/npm.txt" ]; then
        echo "Installing NPM packages..."
        while IFS= read -r line || [ -n "$line" ]; do
            # Skip comment lines and empty lines
            [[ $line =~ ^#.*$ ]] && continue
            [[ -z $line ]] && continue
            
            # Extract package name (remove any inline comments)
            package_name=$(echo "$line" | sed 's/\s*#.*$//')
            echo "Installing NPM package: $package_name"
            npm install -g "$package_name" || echo "Warning: Failed to install NPM package: $package_name"
        done < "$DOTFILES_DIR/packages/npm.txt"
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

# Install starship prompt
install_starship() {
    echo "Checking for starship installation..."
    
    if command -v starship >/dev/null 2>&1; then
        echo "Starship is already installed"
        return 0
    fi
    
    echo "Installing starship prompt..."
    curl -sS https://starship.rs/install.sh | sh
    
    if command -v starship >/dev/null 2>&1; then
        echo "Starship installed successfully"
        
        # Setup WSL specific configuration if needed
        if [ "$OS_TYPE" = "wsl" ]; then
            echo "Configuring starship for Windows PowerShell..."
            
            # Get Windows username
            if command -v powershell.exe >/dev/null 2>&1; then
                windows_username=$(powershell.exe -Command "\$env:USERNAME" 2>/dev/null | tr -d '\r')
                
                if [ -n "$windows_username" ]; then
                    windows_userprofile="/mnt/c/Users/$windows_username"
                    
                    if [ -d "$windows_userprofile" ]; then
                        # Create PowerShell profile directory if it doesn't exist
                        windows_powershell_dir="$windows_userprofile/Documents/PowerShell"
                        
                        if [ ! -d "$windows_powershell_dir" ]; then
                            mkdir -p "$windows_powershell_dir"
                        fi
                        
                        # Add starship init to PowerShell profile
                        powershell_profile="$windows_powershell_dir/Microsoft.PowerShell_profile.ps1"
                        
                        # Check if starship init is already in the profile
                        if [ -f "$powershell_profile" ]; then
                            if ! grep -q "starship init" "$powershell_profile"; then
                                echo "Adding starship init to PowerShell profile..."
                                echo "" >> "$powershell_profile"
                                echo "# Initialize Starship prompt" >> "$powershell_profile"
                                echo "Invoke-Expression (&starship init powershell)" >> "$powershell_profile"
                            else
                                echo "Starship already configured in PowerShell profile"
                            fi
                        else
                            echo "Creating PowerShell profile with starship configuration..."
                            echo "# PowerShell profile created by dotfiles installer" > "$powershell_profile"
                            echo "# Initialize Starship prompt" >> "$powershell_profile"
                            echo "Invoke-Expression (&starship init powershell)" >> "$powershell_profile"
                        fi
                        
                        # Copy starship configuration to Windows side
                        windows_starship_config="$windows_userprofile/.config"
                        mkdir -p "$windows_starship_config"
                        cp "$DOTFILES_DIR/config/starship/starship.toml" "$windows_starship_config/starship.toml"
                        echo "Copied starship configuration to Windows user profile"
                    fi
                fi
            fi
        fi
    else
        echo "Failed to install starship. Please install it manually from https://starship.rs"
    fi
}
}

# Setup sketchybar (macOS only)
setup_sketchybar() {
    # Only run on macOS
    if [ "$OS_TYPE" != "macos" ]; then
        echo "Skipping sketchybar setup (not macOS)"
        return 0
    fi
    
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
    echo "Detected OS: $OS_TYPE"
    echo "The following operations will be performed:"
    echo "1. Backup and create symbolic links for configuration files"
    echo "2. Install starship prompt"
    echo "3. Install mise and required languages"
    echo "4. Install OS-appropriate packages"
    echo "5. Install VSCode/Cursor extensions"
    
    # Show OS-specific operations
    if [ "$OS_TYPE" = "macos" ]; then
        echo "6. Setup macOS-specific tools (sketchybar, etc.)"
    elif [ "$OS_TYPE" = "wsl" ]; then
        echo "6. Configure WSL-specific settings"
    fi
    
    read -p "Do you want to continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 1
    fi

    echo "Setting up dotfiles for $OS_TYPE..."
    create_symlinks
    install_starship
    install_languages
    install_packages
    install_vscode_extensions
    install_cursor_extensions
    
    # Run OS-specific setups
    if [ "$OS_TYPE" = "macos" ]; then
        setup_sketchybar
    elif [ "$OS_TYPE" = "wsl" ]; then
        echo "Configuring WSL-specific settings..."
        # Additional WSL-specific setup could go here
    fi
    
    echo "Done! Please restart your shell to apply all changes."
    echo "Your old configurations have been backed up to ~/.dotfiles_backup/"
    
    # OS-specific final messages
    if [ "$OS_TYPE" = "macos" ]; then
        echo "Important: Don't forget to enable screen recording permission for sketchybar!"
    elif [ "$OS_TYPE" = "wsl" ]; then
        echo "Your WSL environment is now configured. You may want to run 'chsh -s /bin/zsh' to set zsh as your default shell."
    fi
}

main 