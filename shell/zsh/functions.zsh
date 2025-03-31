# Directory management
function mkdir_and_change_directory() {
  if [ $# -eq 0 ]; then
    echo "❌ Error: Directory name required"
    echo "Usage: mkcd <directory>"
    return 1
  fi

  for dir in "$@"; do
    if [ -d "$dir" ]; then
      echo "⚠️  Directory '$dir' already exists"
      echo "➡️  Change to this directory? [Y/n]: "
      read -r response
      case "$response" in
        [nN]*)
          continue
          ;;
        *)
          cd "$dir" || return 1
          echo "✅ Changed to '$dir'"
          return 0
          ;;
      esac
    else
      if mkdir -p "$dir" 2>/dev/null; then
        echo "✨ Created directory '$dir'"
        cd "$dir" || return 1
        echo "✅ Changed to '$dir'"
        return 0
      else
        echo "❌ Error: Failed to create '$dir'"
        echo "💡 Check directory permissions"
        return 1
      fi
    fi
  done
}

# Vim mode indicator
function zle-line-init zle-keymap-select {
  RPS1="${${KEYMAP/vicmd/-- NORMAL --}/(main|viins)/-- INSERT --}"
  RPS2=${RPS1}
  zle reset-prompt
}

# Fuzzy finder functions
function sk_select_history() {
  BUFFER=$(history -n -r 1 | sk --ansi --reverse --height '50%' --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle clear-screen
}

function sk_select_src () {
  # ZLEが有効かどうかをチェック
  if [[ ! -o zle ]]; then
    echo "エラー: ライン編集が有効ではありません。インタラクティブシェルで実行してください。"
    return 1
  fi

  local selected_dir=""
  
  # pacificaを優先的に使用
  if command -v pacifica &>/dev/null; then
    # 一時ファイルを使用してエラーを捕捉
    pacifica 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null > /tmp/pacifica_result.$$ || true
    
    # 結果が存在し空でなければ使用
    if [ -s /tmp/pacifica_result.$$ ]; then
      selected_dir=$(cat /tmp/pacifica_result.$$)
      rm -f /tmp/pacifica_result.$$
    else
      # pacificaが失敗したか結果が空の場合
      rm -f /tmp/pacifica_result.$$ 2>/dev/null
      
      # メッセージ表示は省略してシームレスに代替手段を使用
      if command -v fd &>/dev/null; then
        selected_dir=$(fd --type d --hidden --exclude .git --exclude node_modules . "$HOME" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
      elif command -v find &>/dev/null; then
        selected_dir=$(find "$HOME" -type d -not -path "*/\.*" -not -path "*/node_modules/*" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
      fi
    fi
  else
    # pacificaがインストールされていない場合はfdまたはfindを使用
    if command -v fd &>/dev/null; then
      selected_dir=$(fd --type d --hidden --exclude .git --exclude node_modules . "$HOME" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
    elif command -v find &>/dev/null; then
      selected_dir=$(find "$HOME" -type d -not -path "*/\.*" -not -path "*/node_modules/*" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
    else
      echo "エラー: pacifica、fd、findのいずれもインストールされていません"
      return 1
    fi
  fi

  # 選択したディレクトリが存在すれば移動
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  else
    zle clear-screen
  fi
}

function sk_change_directory() {
  # ZLEが有効かどうかをチェック
  if [[ ! -o zle ]]; then
    echo "エラー: ライン編集が有効ではありません。インタラクティブシェルで実行してください。"
    return 1
  fi

  # zoxideコマンドが存在するかチェック
  if ! command -v zoxide &>/dev/null; then
    echo "エラー: zoxideがインストールされていません。"
    echo "install-wsl-packages.shを実行するか、以下のコマンドでインストールしてください："
    echo "sudo apt install zoxide"
    return 1
  fi

  local selected_dir=$(zoxide query -l | sk --ansi --reverse --height '50%')
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  fi
}

function sk_select_file_below_pwd() {
  if [ ! `pwd | grep "$(ghq root)"` ]; then
    echo "you are not in ghq path"
    zle accept-line
    return 0
  fi
  local selected_path="\
    $(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor | \
    sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')"
  if [ -n "$selected_path" ]; then
    go_to "$selected_path"
  fi
}

function sk_select_file_within_project() {
  local base_path=$(pwd | grep -o "$(ghq root)/[^/]*/[^/]*/[^/]*")
  if [ -z "$base_path" ]; then
    echo "you are not in ghq project"
    zle accept-line
    return 0
  fi
  local paths="\
    $(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor . "$base_path")"
  local selected_path="$(echo "(root)\n$paths" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {} 2>/dev/null || echo "Preview not available"')"
  if [ -n "$selected_path" ]; then
    if [[ "$selected_path" = "(root)" ]]; then
      go_to "$base_path"
      return 0
    fi
    go_to "$selected_path"
  fi
}

function go_to() {
  if [ -f "$1" ]; then
    nvim "$1"
    dir_path=$(dirname "$1")
    BUFFER="cd \"$dir_path\""
  elif [ -d "$1" ]; then
    BUFFER="cd \"$1\""
  else
    echo "selected path is neither file nor directory"
  fi
  zle accept-line
}

function sk_edit_file() {
  local selected_path=$(fd --type f --hidden --exclude .git | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')
  if [ -n "$selected_path" ]; then
    nvim "$selected_path"
  fi
}

# Git branch selection
function sk_select_branch_except_current() {
  git branch -a --sort=-authordate | \
    grep -v -e '->' -e '*' | \
    sed "s/remotes\/origin\///g" | \
    awk '!a[$0]++' | \
    sk --ansi --reverse --height '50%'
}

function sk_select_local_branch_except_current() {
  git branch | \
    grep -v -e '->' -e '*' | \
    sed "s/remotes\/origin\///g" | \
    awk '!a[$0]++' | \
    sk --ansi --reverse --height '50%'
}

function sk_select_branch_all() {
  git branch -a --sort=-authordate | \
    grep -v -e '->' | \
    sed "s/remotes\/origin\///g" | \
    sed "s/\*/ /g" | \
    awk '!a[$0]++' | \
    sk --ansi --reverse --height '50%'
}

# Tmux
function precmd() {
  if [ ! -z $TMUX ]; then
    tmux refresh-client -S
  fi
}

# Font installation
function nerd_fonts() {
  git clone --branch=master --depth 1 https://github.com/ryanoasis/nerd-fonts.git
  cd nerd-fonts
  ./install.sh $1
  cd ..
  rm -rf nerd-fonts
}

# Cross-platform open command (works in macOS, Linux, and WSL)
function open() {
  # Check if arguments were provided
  if [[ $# -eq 0 ]]; then
    echo "❌ Error: Missing argument"
    echo "Usage: open <file or URL>"
    return 1
  fi

  local target="$1"
  
  # Detect platform and use appropriate command
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - use native open command
    command open "$@"
  elif grep -q Microsoft /proc/version 2>/dev/null; then
    # WSL - handle with special care
    
    # Check for directory specifically
    if [[ -d "$target" ]]; then
      # Directory handling in WSL
      if command -v wslview >/dev/null 2>&1; then
        # Use wslview for directories (best option)
        wslview "$target"
      elif command -v wslpath >/dev/null 2>&1; then
        # Convert path to Windows and use explorer directly
        local winpath=$(wslpath -w "$target")
        explorer.exe "$winpath"
      else
        # Last resort - just try explorer with path
        explorer.exe "$target"
        echo "⚠️ Warning: For better directory handling, install wslu:"
        echo "    sudo apt install -y wslu"
      fi
    else
      # Files and URLs handling
      if command -v wslview >/dev/null 2>&1; then
        wslview "$target"
      else
        # Convert path to Windows format if it's a file path
        if [[ -e "$target" ]]; then
          local winpath=$(wslpath -w "$target")
          explorer.exe "$winpath"
        else
          # If it's a URL or doesn't exist as a file, pass directly
          explorer.exe "$target"
        fi
        echo "💡 Tip: Install wslu package for better Windows integration:"
        echo "    sudo apt install -y wslu"
      fi
    fi
    
    # Check for locale issues and provide helpful message
    if grep -q "warning: Setting locale failed" <<< "$(locale 2>&1)"; then
      echo ""
      echo "⚠️ Locale Warning: You have locale issues in your environment."
      echo "📝 Run the utility setup script to resolve these warnings:"
      echo "    sh ~/go/github.com/esh2n/dotfiles/linux-utils-setup.sh"
    fi
  else
    # Regular Linux - use xdg-open
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$target"
      
      # Check for specific directory error
      if [[ $? -ne 0 && -d "$target" ]]; then
        echo "⚠️ Warning: xdg-open failed to open directory."
        echo "💡 Install desktop-file-utils and required applications:"
        echo "    sudo apt install -y desktop-file-utils xdg-utils"
        echo "    sudo update-desktop-database"
        
        # Try to fall back to a file manager if available
        for fm in nautilus thunar dolphin pcmanfm caja nemo; do
          if command -v $fm >/dev/null 2>&1; then
            echo "🔄 Trying to open with $fm instead..."
            $fm "$target"
            return $?
          fi
        done
      fi
    else
      echo "❌ Error: No suitable 'open' command found"
      echo "💡 Install xdg-utils package:"
      echo "    sudo apt install -y xdg-utils"
      return 1
    fi
  fi
}

# GCloud functions
function gcloud-activate() {
  name="$1"
  project="$2"
  echo "gcloud config configurations activate \"${name}\""
  gcloud config configurations activate "${name}"
}

function gx-complete() {
  _values $(gcloud config configurations list | awk '{print $1}')
}

function gx() {
  name="$1"
  if [ -z "$name" ]; then
    line=$(gcloud config configurations list | sk --ansi --reverse --height '50%')
    name=$(echo "${line}" | awk '{print $1}')
  else
    line=$(gcloud config configurations list | grep "$name")
  fi
  project=$(echo "${line}" | awk '{print $4}')
  gcloud-activate "${name}" "${project}"
}
compdef gx-complete gx

# Bind keys for fuzzy finder (エラーチェック付き)
if [[ $- == *i* ]]; then
  # インタラクティブシェルの場合のみキーバインドを設定
  # sk関連の関数をウィジェットとして登録
  zle -N sk_select_history
  bindkey '^r' sk_select_history
  
  zle -N sk_select_src
  bindkey '^]' sk_select_src
  
  zle -N sk_change_directory
  bindkey '^g' sk_change_directory
else
  # 非インタラクティブシェルの場合は警告（ログイン時に一度だけ）
  [[ -z "$WSL_KEYBINDS_WARNING" ]] && {
    echo "警告: 非インタラクティブシェルのため、キーバインド（Ctrl+]など）が登録できません。"
    echo "対処法: ターミナルを再起動するか、exec zshで新しいセッションを開始してください。"
    export WSL_KEYBINDS_WARNING=1
  }
fi

# Enhanced search functions
function search_in_files() {
  local query="$1"
  if [ -z "$query" ]; then
    echo "Usage: search_in_files <query>"
    return 1
  fi
  rg --color=always --line-number --no-heading --smart-case "$query" | \
    sk --ansi --reverse --height '50%' --preview 'echo {}' \
    --preview-window 'up,60%,border-bottom,+{2}+3/3,~3'
}

function preview_file() {
  local file="$1"
  if [ -z "$file" ]; then
    echo "Usage: preview_file <file>"
    return 1
  fi
  bat --style=numbers --color=always "$file"
}

function search_and_edit() {
  local result=$(search_in_files "$1")
  if [ -n "$result" ]; then
    local file=$(echo "$result" | cut -d':' -f1)
    local line=$(echo "$result" | cut -d':' -f2)
    nvim "+$line" "$file"
  fi
}

# Zen Mode - Toggle sketchybar and borders
ZEN_MODE_ACTIVE=0

function toggle_zen_mode() {
  if [ $ZEN_MODE_ACTIVE -eq 0 ]; then
    # Turn on Zen mode (disable sketchybar and borders)
    brew services stop sketchybar
    brew services stop borders
    ZEN_MODE_ACTIVE=1
    echo "🧘 Zen Mode: ON - sketchybar and borders disabled"
  else
    # Turn off Zen mode (enable sketchybar and borders)
    brew services start sketchybar
    brew services start borders
    ZEN_MODE_ACTIVE=0
    echo "🖥️ Zen Mode: OFF - sketchybar and borders enabled"
  fi
}

# Create alias for Zen mode
alias zen='toggle_zen_mode'
