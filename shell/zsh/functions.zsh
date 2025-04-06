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
  # 直接実行とウィジェット呼び出しの両方に対応
  if [[ "$1" = "--direct" ]]; then
    # 直接コマンドとして実行（ZLE非依存）
    local direct_mode=1
  elif [[ ! -o zle ]]; then
    # ZLEが無効で、かつ直接コマンドとしても実行されていない場合
    echo "sk_select_srcを直接実行します（ZLEが無効なため）"
    sk_select_src --direct
    return $?
  fi

  # SIGINT（Ctrl+C）ハンドラを設定（中断時のゴミファイル処理を防止）
  # originalのハンドラを保存
  local original_sigint_handler=$(trap -p INT)
  
  # 関数終了時にSIGINTハンドラを元に戻す関数
  function cleanup() {
    # 元のSIGINTハンドラを復元（存在する場合）
    if [[ -n "$original_sigint_handler" ]]; then
      eval "$original_sigint_handler"
    else
      trap - INT
    fi
    # デバッグ用メッセージを無効化（必要に応じてコメント解除）
    # echo "sk_select_src: クリーンアップ完了"
  }
  
  # 終了時に必ずクリーンアップを実行
  trap cleanup EXIT
  
  # Ctrl+C押下時の独自処理（中断をきれいに処理）
  trap "cleanup; return 130" INT

  local selected_dir=""
  
  # pacificaを優先的に使用（WSL環境でも）
  if command -v pacifica &>/dev/null; then
    # skコマンドの存在確認
    if ! command -v sk &>/dev/null; then
      echo "エラー: skコマンドがインストールされていません"
      echo "WSL環境では: sudo apt install skim"
      zle reset-prompt
      return 1
    fi
    
    # 静かに実行（余計なメッセージを表示しない）
    local output
    output=$(pacifica 2>/dev/null)
    
    # 出力が空でないことを確認
    if [[ -n "$output" ]]; then
      # skに渡して選択
      selected_dir=$(echo "$output" | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
    else
      # 静かにフォールバック
      if command -v fd &>/dev/null; then
        selected_dir=$(fd --type d --hidden --exclude .git --exclude node_modules . "$HOME" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
      elif command -v find &>/dev/null; then
        selected_dir=$(find "$HOME" -type d -not -path "*/\.*" -not -path "*/node_modules/*" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
      fi
    fi
  else
    # pacificaがインストールされていない場合はfdまたはfindを使用（静かに）
    if command -v fd &>/dev/null; then
      selected_dir=$(fd --type d --hidden --exclude .git --exclude node_modules . "$HOME" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
    elif command -v find &>/dev/null; then
      selected_dir=$(find "$HOME" -type d -not -path "*/\.*" -not -path "*/node_modules/*" 2>/dev/null | sk --ansi --reverse --height '50%' --query "$LBUFFER" 2>/dev/null)
    else
      echo "エラー: pacifica、fd、findのいずれもインストールされていません"
      zle reset-prompt
      return 1
    fi
  fi

  # 選択したディレクトリが存在すれば移動
  if [ -n "$selected_dir" ]; then
    if [[ "$direct_mode" = "1" ]]; then
      # 直接モード: コマンドとして実行
      cd "${selected_dir}"
      echo "✓ 移動先: ${selected_dir}"
    else
      # ZLEモード: ウィジェットとして実行
      BUFFER="cd ${selected_dir}"
      zle accept-line
    fi
  else
    if [[ "$direct_mode" != "1" && -o zle ]]; then
      zle reset-prompt
    else
      echo "ディレクトリが選択されませんでした"
    fi
  fi
}

function sk_change_directory() {
  # ZLEが有効かどうかをチェック
  if [[ ! -o zle ]]; then
    echo "エラー: ライン編集が有効ではありません。インタラクティブシェルで実行してください。"
    return 1
  fi

  # SIGINT（Ctrl+C）ハンドラを設定
  local original_sigint_handler=$(trap -p INT)
  
  # 関数終了時にSIGINTハンドラを元に戻す関数
  function cleanup() {
    if [[ -n "$original_sigint_handler" ]]; then
      eval "$original_sigint_handler"
    else
      trap - INT
    fi
  }
  
  # 終了時に必ずクリーンアップを実行
  trap cleanup EXIT
  
  # Ctrl+C押下時の独自処理
  trap "cleanup; return 130" INT

  # zoxideコマンドが存在するかチェック
  if ! command -v zoxide &>/dev/null; then
    echo "エラー: zoxideがインストールされていません。"
    echo "install-wsl-packages.shを実行するか、以下のコマンドでインストールしてください："
    echo "sudo apt install zoxide"
    return 1
  fi

  local output=$(zoxide query -l)
  local selected_dir=""
  
  if [[ -n "$output" ]]; then
    selected_dir=$(echo "$output" | sk --ansi --reverse --height '50%' 2>/dev/null)
  fi
  
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  fi
}

function sk_select_file_below_pwd() {
  # ZLEが有効かどうかをチェック
  if [[ ! -o zle ]]; then
    echo "エラー: ライン編集が有効ではありません。インタラクティブシェルで実行してください。"
    return 1
  fi

  # SIGINT（Ctrl+C）ハンドラを設定
  local original_sigint_handler=$(trap -p INT)
  
  # 関数終了時にSIGINTハンドラを元に戻す関数
  function cleanup() {
    if [[ -n "$original_sigint_handler" ]]; then
      eval "$original_sigint_handler"
    else
      trap - INT
    fi
  }
  
  # 終了時に必ずクリーンアップを実行
  trap cleanup EXIT
  
  # Ctrl+C押下時の独自処理
  trap "cleanup; return 130" INT

  if [ ! `pwd | grep "$(ghq root)"` ]; then
    echo "you are not in ghq path"
    zle accept-line
    return 0
  fi
  
  local selected_path=""
  
  # fdコマンドの出力を変数に保存してからskに渡す
  local files_list=$(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor 2>/dev/null)
  
  if [[ -n "$files_list" ]]; then
    selected_path=$(echo "$files_list" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}' 2>/dev/null)
  fi
  
  if [ -n "$selected_path" ]; then
    go_to "$selected_path"
  fi
}

function sk_select_file_within_project() {
  # ZLEが有効かどうかをチェック
  if [[ ! -o zle ]]; then
    echo "エラー: ライン編集が有効ではありません。インタラクティブシェルで実行してください。"
    return 1
  fi

  # SIGINT（Ctrl+C）ハンドラを設定
  local original_sigint_handler=$(trap -p INT)
  
  # 関数終了時にSIGINTハンドラを元に戻す関数
  function cleanup() {
    if [[ -n "$original_sigint_handler" ]]; then
      eval "$original_sigint_handler"
    else
      trap - INT
    fi
  }
  
  # 終了時に必ずクリーンアップを実行
  trap cleanup EXIT
  
  # Ctrl+C押下時の独自処理
  trap "cleanup; return 130" INT

  local base_path=$(pwd | grep -o "$(ghq root)/[^/]*/[^/]*/[^/]*")
  if [ -z "$base_path" ]; then
    echo "you are not in ghq project"
    zle accept-line
    return 0
  fi
  
  # fdコマンドの出力を変数に保存
  local paths=$(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor . "$base_path" 2>/dev/null)
  
  # fdコマンドの出力が空でない場合のみskに渡す
  if [[ -n "$paths" ]]; then
    local selected_path="$(echo "(root)"$'\n'"$paths" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {} 2>/dev/null || echo "Preview not available"' 2>/dev/null)"
    
    if [ -n "$selected_path" ]; then
      if [[ "$selected_path" = "(root)" ]]; then
        go_to "$base_path"
        return 0
      fi
      go_to "$selected_path"
    fi
  else
    echo "プロジェクト内にファイルが見つかりません"
    zle reset-prompt
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

# Bind keys for fuzzy finder (環境適応型)
if [[ $- == *i* ]]; then
  # インタラクティブシェルの場合のみキーバインドを設定
  # インタラクティブシェルでもZLEが無効な場合のために、コマンドエイリアスも設定
  
  # ZLEが有効な場合のみ、ウィジェット登録とキーバインド設定を行う
  if [[ -o zle ]]; then
    # 全てのsk関連の関数をウィジェットとして登録
    zle -N sk_select_history 2>/dev/null
    zle -N sk_select_src 2>/dev/null
    zle -N sk_change_directory 2>/dev/null
    zle -N sk_select_file_within_project 2>/dev/null
    zle -N sk_select_file_below_pwd 2>/dev/null
    
    # WSL環境でのキーバインド設定
    if [ "$IS_WSL" = "1" ]; then
      echo "WSL環境用キーバインドを設定しています..."
      
      # 遅延キーバインド設定用の関数を定義
      function __setup_wsl_keybinds() {
        # 基本のキーバインド
        bindkey '^r' sk_select_history   # Ctrl+R: 履歴検索
        bindkey '^g' sk_change_directory # Ctrl+G: ディレクトリ変更
        
        # 代替キーバインド（Ctrl+]はnormalモードの切替に使用されるため）
        bindkey '^\' sk_select_src       # Ctrl+\
        bindkey '^p' sk_select_src       # Ctrl+P
        bindkey '\e]' sk_select_src      # Alt+]
        
        # 可能であれば、vimモードのinsertモードでもCtrl+]を設定
        bindkey -M viins '^]' sk_select_src 2>/dev/null || true
      }
      
      # 安全に初期設定を実行
      __setup_wsl_keybinds
      
      # 追加のキーバインド
      bindkey '^v' sk_select_file_within_project  # Ctrl+V
      bindkey '^b' sk_select_file_below_pwd       # Ctrl+B
      
      # WSL環境でのキーバインド一覧を表示
      cat <<EOF

======= WSL環境用キーバインド =======
Ctrl+R : 履歴検索
Ctrl+G : ディレクトリ変更
Ctrl+\\ : ソースディレクトリ選択
Alt+] : ソースディレクトリ選択
Ctrl+P : ソースディレクトリ選択
Ctrl+V : プロジェクト内ファイル選択
Ctrl+B : 現在ディレクトリ以下のファイル選択

コマンド: src → プロジェクトディレクトリ選択（ZLEエラー時）
コマンド: pd → カレントディレクトリ以下のファイル選択（ZLEエラー時）
================================

EOF
    else
      # macOS / 通常Linux環境用のキーバインド設定関数
      function __setup_macos_keybinds() {
        bindkey '^r' sk_select_history
        bindkey '^]' sk_select_src
        bindkey '^g' sk_change_directory
        bindkey '^v' sk_select_file_within_project
        bindkey '^b' sk_select_file_below_pwd
        
        # vimモードでもキーバインドを設定
        bindkey -M viins '^]' sk_select_src 2>/dev/null || true
        bindkey -M vicmd '^]' sk_select_src 2>/dev/null || true
      }
      
      # 安全に初期設定を実行
      __setup_macos_keybinds
      
      cat <<EOF

======= 標準キーバインド =======
Ctrl+R : 履歴検索
Ctrl+] : ソースディレクトリ選択
Ctrl+G : ディレクトリ変更
Ctrl+V : プロジェクト内ファイル選択
Ctrl+B : 現在ディレクトリ以下のファイル選択

コマンド: src → プロジェクトディレクトリ選択（ZLEエラー時）
コマンド: pd → カレントディレクトリ以下のファイル選択（ZLEエラー時）
================================

EOF
    fi
    
    # 端末起動時に実行する関数を追加（遅延初期化）
    function precmd_setup_keybinds() {
      # この関数はプロンプト表示前に毎回実行される
      # 必要に応じてキーバインドを再設定可能
      
      # ZLEがアクティブであれば、Vimモードでのキーバインドを試行
      if [[ -o zle ]]; then
        if [ "$IS_WSL" = "1" ]; then
          bindkey -M viins '^]' sk_select_src 2>/dev/null || true
        else
          bindkey -M viins '^]' sk_select_src 2>/dev/null || true
          bindkey -M vicmd '^]' sk_select_src 2>/dev/null || true
        fi
      fi
      
      # 一度実行したら、この関数をprecmdフックから削除
      add-zsh-hook -d precmd precmd_setup_keybinds
    }
    
    # プロンプト表示前に実行するフックを追加
    autoload -Uz add-zsh-hook
    add-zsh-hook precmd precmd_setup_keybinds
  else
    # ZLEが無効な場合は警告
    [[ -z "$WSL_KEYBINDS_WARNING" ]] && {
      echo "警告: ZLEが非アクティブなため、キーバインド設定の代わりにコマンドエイリアスを使用します:"
      echo "- src: プロジェクトディレクトリ選択"
      echo "- pd: カレントディレクトリ以下のファイル選択"
      export WSL_KEYBINDS_WARNING=1
    }
  fi
  
  # ZLEの状態に関わらず、コマンドとして実行できるようにエイリアスを設定
  alias src="sk_select_src --direct"
  alias pd="sk_select_file_below_pwd --direct"
  alias project="sk_select_src --direct"
  alias dirfind="sk_change_directory --direct"
else
  # 非インタラクティブシェルの場合は警告
  [[ -z "$WSL_KEYBINDS_WARNING" ]] && {
    echo "警告: 非インタラクティブシェルのため、キーバインドが使用できません。"
    export WSL_KEYBINDS_WARNING=1
  }
fi

# キーバインドをテストするヘルパー関数
function test_keybindings() {
  echo "キーバインドテストモードを開始します。キーを押して確認してください。"
  echo "終了するには Ctrl+D を2回押してください。"
  cat <<EOF
テストする主なキーバインド:
- Ctrl+]
- Ctrl+\\
- Ctrl+P
- Alt+]
EOF

  cat -v
}

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
