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

# If OS_TYPE is not already set by the parent script, detect it
if [[ -z "${OS_TYPE:-}" ]]; then
    OS_TYPE=$(detect_os)
    echo "Detected OS: $OS_TYPE"
fi

# WSL環境の場合、Windows側のユーザープロファイルを早期に取得
windows_username=""
windows_userprofile=""
if [ "$OS_TYPE" = "wsl" ]; then
    # Windows側のユーザー名とプロファイルパスを取得
    if command -v powershell.exe >/dev/null 2>&1; then
        windows_username=$(powershell.exe -Command "\$env:USERNAME" 2>/dev/null | tr -d '\r')
        if [ -n "$windows_username" ]; then
            windows_userprofile="/mnt/c/Users/$windows_username"
            echo "Detected Windows username: $windows_username"
            echo "Windows user profile path: $windows_userprofile"
        fi
    fi
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
    # Starship設定 (OSに応じて異なるパスに配置)
    if [ "$OS_TYPE" = "wsl" ]; then
        # WSLの場合、Linux側とWindows側の両方に設定を配置する
        # Linux側
        safe_link "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
        
        # Windows側（複数の可能性のある場所を試す）
        echo "Setting up Starship config for Windows..."
        
        # Windows側の設定ファイルパスを確認
        if [ -n "$windows_username" ] && [ -d "$windows_userprofile" ]; then
            # 候補となる複数の設定パス
            win_config_paths=(
                "$windows_userprofile/.config"                    # 新しい標準的な場所
                "$windows_userprofile/AppData/Local/starship"     # 代替の場所1
                "$windows_userprofile/AppData/Roaming/starship"   # 代替の場所2
            )
            
            for win_config_dir in "${win_config_paths[@]}"; do
                win_starship_file="$win_config_dir/starship.toml"
                
                # ディレクトリを確実に作成
                echo "Creating Windows starship config directory: $win_config_dir"
                mkdir -p "$win_config_dir"
                
                if [ $? -eq 0 ]; then
                    # バックアップ
                    backup_existing_config "$win_starship_file"
                    
                    # 設定ファイルをコピー
                    echo "Copying Starship config to: $win_starship_file"
                    cp "$DOTFILES_DIR/config/starship/starship.toml" "$win_starship_file"
                    
                    if [ $? -eq 0 ]; then
                        echo "Successfully copied Starship config to Windows at $win_starship_file"
                        # 権限を確認して適切に設定
                        chmod 644 "$win_starship_file" 2>/dev/null
                        echo "Starship config permissions updated"
                    else
                        echo "Failed to copy Starship config to $win_starship_file - continuing with next location"
                    fi
                else
                    echo "Failed to create directory $win_config_dir - continuing with next location"
                fi
            done
            
            # PowerShell起動スクリプトにstarship初期化を追加する
            powershell_path="$windows_userprofile/Documents/PowerShell/Microsoft.PowerShell_profile.ps1"
            powershell_dir="$windows_userprofile/Documents/PowerShell"
            
            echo "Checking for PowerShell profile at $powershell_path"
            
            # PowerShellディレクトリを作成
            mkdir -p "$powershell_dir"
            
            # プロファイルが存在するか確認
            if [ -f "$powershell_path" ]; then
                # starship初期化が含まれているか確認
                if ! grep -q "starship init" "$powershell_path"; then
                    echo "Adding Starship initialization to PowerShell profile"
                    echo -e "\n# Starship プロンプト初期化\nInvoke-Expression (&starship init powershell)" >> "$powershell_path"
                    echo "Starship initialization added to PowerShell profile"
                else
                    echo "Starship initialization already exists in PowerShell profile"
                fi
            else
                # プロファイルがなければ新規作成
                echo "Creating new PowerShell profile with Starship initialization"
                echo -e "# PowerShell Profile\n\n# Starship プロンプト初期化\nInvoke-Expression (&starship init powershell)" > "$powershell_path"
                echo "Created new PowerShell profile with Starship initialization"
            fi
        else
            echo "Windows user profile not found. Skipping Windows Starship config setup."
        fi
    else
        # macOSまたは通常のLinuxの場合
        safe_link "$DOTFILES_DIR/config/starship/starship.toml" "$HOME/.config/starship.toml"
    fi
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
                        
                        # Try multiple potential WezTerm config locations
                        echo "Attempting to set up WezTerm config for Windows..."
                        
                        # 候補1: %USERPROFILE%\.config\wezterm (デフォルト)
                        windows_wezterm_dir="$windows_config_dir/wezterm"
                        
                        # 候補2: %USERPROFILE%\AppData\Local\wezterm (代替パス)
                        windows_wezterm_dir_alt="$windows_userprofile/AppData/Local/wezterm"
                        
                        # 両方の場所にコピーする (存在しない場合はディレクトリを作成)
                        for wezterm_target in "$windows_wezterm_dir" "$windows_wezterm_dir_alt"; do
                            # Backup existing WezTerm config if exists
                            backup_existing_config "$wezterm_target"
                            
                            # Create directory if it doesn't exist
                            if [ ! -d "$wezterm_target" ]; then
                                echo "Creating WezTerm directory: $wezterm_target"
                                mkdir -p "$wezterm_target"
                            fi
                            
                            # WezTermのファイルを個別にコピー（アクセス権限の問題を回避）
                            echo "Copying WezTerm config to: $wezterm_target"
                            
                            # まず基本設定ファイルをコピー
                            cp "$DOTFILES_DIR/config/wezterm/wezterm.lua" "$wezterm_target/"
                            if [ $? -ne 0 ]; then
                                echo "[ERROR] Failed to copy WezTerm main config to $wezterm_target"
                            else
                                echo "Successfully copied WezTerm main config to $wezterm_target"
                            fi
                            
                            # サブディレクトリを作成
                            mkdir -p "$wezterm_target/lua/core"
                            mkdir -p "$wezterm_target/lua/ui"
                            mkdir -p "$wezterm_target/lua/utils"
                            
                            # 各サブディレクトリのファイルをコピー
                            # core
                            for f in "$DOTFILES_DIR/config/wezterm/lua/core/"*.lua; do
                                base=$(basename "$f")
                                cp "$f" "$wezterm_target/lua/core/$base"
                                echo "Copied $base to lua/core/"
                            done
                            
                            # ui
                            for f in "$DOTFILES_DIR/config/wezterm/lua/ui/"*.lua; do
                                base=$(basename "$f")
                                cp "$f" "$wezterm_target/lua/ui/$base"
                                echo "Copied $base to lua/ui/"
                            done
                            
                            # utils
                            for f in "$DOTFILES_DIR/config/wezterm/lua/utils/"*.lua; do
                                base=$(basename "$f")
                                cp "$f" "$wezterm_target/lua/utils/$base"
                                echo "Copied $base to lua/utils/"
                            done
                            
                            echo "Finished copying WezTerm config to $wezterm_target"
                        done

                        # --- VSCode ---
                        echo "Attempting to set up VSCode config for Windows..."
                        
                        # VSCodeの設定ファイルパスの候補 (複数のインストール方法に対応)
                        vscode_paths=(
                            "$windows_userprofile/AppData/Roaming/Code/User"  # 通常のインストール
                            "$windows_userprofile/AppData/Local/Code/User"    # 代替パス
                            "$windows_userprofile/.vscode"                    # 旧バージョンや特殊なインストール
                        )
                        
                        # 各候補パスに対して設定ファイルをコピー
                        for vscode_user_dir in "${vscode_paths[@]}"; do
                            vscode_settings="$vscode_user_dir/settings.json"
                            
                            echo "Checking VSCode path: $vscode_user_dir"
                            
                            # Create directory if it doesn't exist
                            if [ ! -d "$vscode_user_dir" ]; then
                                echo "Creating VSCode User directory: $vscode_user_dir"
                                mkdir -p "$vscode_user_dir"
                                # ディレクトリの作成に失敗した場合は次の候補へ
                                if [ $? -ne 0 ]; then
                                    echo "Failed to create directory: $vscode_user_dir, trying next path..."
                                    continue
                                fi
                            fi
                            
                            # Backup existing settings
                            backup_existing_config "$vscode_settings"
                            
                            # Copy settings file
                            echo "Copying VSCode settings to: $vscode_settings"
                            cp "$DOTFILES_DIR/config/vscode/settings.json" "$vscode_settings"
                            if [ $? -eq 0 ]; then
                                echo "Successfully copied VSCode settings to $vscode_settings"
                            else
                                echo "Failed to copy VSCode settings to $vscode_settings"
                            fi
                        done

                        # --- Cursor ---
                        echo "Attempting to set up Cursor config for Windows..."
                        
                        # 複数のCursor設定パスの候補
                        cursor_paths=(
                            "$windows_userprofile/.cursor"
                            "$windows_userprofile/AppData/Roaming/Cursor"
                            "$windows_userprofile/AppData/Local/Cursor"
                        )
                        
                        # 各候補パスに対して設定ファイルをコピー
                        for cursor_base in "${cursor_paths[@]}"; do
                            cursor_user_dir="$cursor_base/User"
                            cursor_settings="$cursor_user_dir/settings.json"
                            cursor_mcp="$cursor_user_dir/mcp.json"
                            
                            echo "Checking Cursor path: $cursor_user_dir"
                            
                            # Create Cursor User directory if it doesn't exist
                            if [ ! -d "$cursor_user_dir" ]; then
                                echo "Creating Cursor User directory: $cursor_user_dir"
                                mkdir -p "$cursor_user_dir"
                                # ディレクトリの作成に失敗した場合は次の候補へ
                                if [ $? -ne 0 ]; then
                                    echo "Failed to create directory: $cursor_user_dir, trying next path..."
                                    continue
                                fi
                            fi
                            
                            # Backup existing Cursor settings
                            backup_existing_config "$cursor_settings"
                            backup_existing_config "$cursor_mcp"
                            
                            # Copy Cursor files
                            echo "Copying Cursor settings to: $cursor_settings"
                            cp "$DOTFILES_DIR/config/vscode/settings.json" "$cursor_settings"
                            if [ $? -eq 0 ]; then
                                echo "Successfully copied Cursor settings to $cursor_settings"
                            else
                                echo "Failed to copy Cursor settings to $cursor_settings"
                            fi
                            
                            echo "Copying Cursor MCP config to: $cursor_mcp"
                            cp "$DOTFILES_DIR/config/cursor/mcp.json" "$cursor_mcp"
                            if [ $? -eq 0 ]; then
                                echo "Successfully copied Cursor MCP config to $cursor_mcp"
                            else
                                echo "Failed to copy Cursor MCP config to $cursor_mcp"
                            fi
                        done

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