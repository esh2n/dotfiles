# Terminal detection functions
function is_warp_terminal() {
  [[ -n "$WARP_SESSION_ID" ]] || [[ "$TERM_PROGRAM" = "WarpTerminal" ]]
}

function is_vscode_terminal() {
  [[ "$TERM_PROGRAM" = "vscode" ]]
}

function is_wezterm() {
  [[ "$TERM_PROGRAM" = "WezTerm" ]]
}

# 共通の除外パターン定義（zoxide用）
# 隠しディレクトリ（.で始まる）も除外
export DOTFILES_EXCLUDE_PATTERN='(^\.|/\.|\.Trash|OrbStack|\.cache|\.aws|\.devin|config/claude|\.vscode|__pycache__|node_modules|vendor|\.idea|build|dist|target|\.next|\.nuxt|coverage|\.pytest_cache|\.mypy_cache|venv|\.venv|Library/Caches|Library/Logs|\.npm|\.yarn|\.pnpm)'

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


# Fuzzy finder functions
function sk_select_history() {
  # Warpターミナルの場合はZLEが使えないため、直接実行モードにフォールバック
  if is_warp_terminal; then
    local selected=$(history -n -r 1 | sk --ansi --reverse --height '50%')
    if [ -n "$selected" ]; then
      echo "Selected: $selected"
      echo "Run this command manually or copy it to your clipboard"
    fi
    return
  fi
  
  BUFFER=$(history -n -r 1 | sk --ansi --reverse --height '50%' --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle clear-screen
}

function sk_select_src () {
  # ghqで管理されているプロジェクトディレクトリを選択して移動
  # Warpターミナルの場合は直接実行モードを強制
  if is_warp_terminal; then
    sk_select_src --direct
    return $?
  fi

  # 無限ループ防止のフラグチェック
  if [[ "$1" = "--force-direct" ]]; then
    local direct_mode=1
  fi

  # 直接実行とウィジェット呼び出しの両方に対応
  if [[ "$1" = "--direct" || "$1" = "--force-direct" ]]; then
    # 直接コマンドとして実行（ZLE非依存）
    local direct_mode=1
  elif [[ ! -o zle ]]; then
    # ZLEが無効で、かつ直接コマンドとしても実行されていない場合
    echo "sk_select_srcを直接実行します（ZLEが無効なため）"
    sk_select_src --force-direct
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
  
  # ghqコマンドの存在確認
  if ! command -v ghq &>/dev/null; then
    echo "エラー: ghqコマンドがインストールされていません"
    echo "インストール: brew install ghq"
    if [[ "$direct_mode" != "1" && -o zle ]]; then
      zle reset-prompt
    fi
    return 1
  fi
  
  # skコマンドの存在確認
  if ! command -v sk &>/dev/null; then
    echo "エラー: skコマンドがインストールされていません"
    echo "インストール: brew install skim"
    if [[ "$direct_mode" != "1" && -o zle ]]; then
      zle reset-prompt
    fi
    return 1
  fi
  
  # キャッシュファイルのパス
  local cache_file="$HOME/.cache/ghq_list_cache"
  local cache_age=3600  # 1時間（秒）
  local use_cache=0
  
  # キャッシュディレクトリが存在しない場合は作成
  mkdir -p "$HOME/.cache"
  
  # キャッシュファイルの有効性をチェック
  if [[ -f "$cache_file" ]]; then
    local cache_modified=$(stat -f "%m" "$cache_file" 2>/dev/null || stat -c "%Y" "$cache_file" 2>/dev/null)
    local current_time=$(date +%s)
    local cache_diff=$((current_time - cache_modified))
    
    if [[ $cache_diff -lt $cache_age ]]; then
      use_cache=1
    fi
  fi
  
  # pacificaでghqリストを取得してgithub.com配下のみフィルタリングしてskで選択
  local folder_icon=$'\uF07C'
  selected_dir=$(pacifica | grep "/github\.com/" | sed "s/^/$folder_icon /" | sk --ansi --reverse --height '100%' \
    --query "$LBUFFER" 2>/dev/null | sed "s/^$folder_icon //")

  # 直接モードの場合は、単純にghqリストを表示
  if [[ "$direct_mode" = "1" ]]; then
    echo "Available projects:"
    if [[ $use_cache -eq 1 && -f "$cache_file" ]]; then
      cat "$cache_file" | nl
    else
      ghq list -p | nl
    fi
    echo "Use 'cd <path>' to navigate to a project"
    return
  fi

  # 選択したディレクトリが存在すれば移動
  if [ -n "$selected_dir" ]; then
    # ZLEモード: ウィジェットとして実行（修正版）
    # バッファを設定（パスをクォート）
    BUFFER="cd ${(q)selected_dir}"
    # カーソル位置を行末に移動
    zle end-of-line
    # コマンドを確実に実行
    zle accept-line
  else
    if [[ -o zle ]]; then
      zle reset-prompt
    else
      echo "ディレクトリが選択されませんでした"
    fi
  fi
}

function sk_change_directory() {
  # 引数で--directが指定された場合、またはWarpターミナルの場合は直接実行モード
  local direct_mode=0
  if [[ "$1" = "--direct" ]] || is_warp_terminal; then
    direct_mode=1
  fi
  
  # zoxideコマンドが存在するかチェック
  if ! command -v zoxide &>/dev/null; then
    echo "エラー: zoxideがインストールされていません。"
    return 1
  fi
  
  # 直接実行モード、またはZLEが無効な場合
  if [[ "$direct_mode" = "1" ]] || [[ ! -o zle ]]; then
    # zoxideから履歴を取得し、不要なパスをフィルタリング
    local output=$(zoxide query -l | grep -v -E "$DOTFILES_EXCLUDE_PATTERN")
    local selected_dir=""
    
    if [[ -n "$output" ]]; then
      selected_dir=$(echo "$output" | sk --ansi --reverse --height '50%' 2>/dev/null)
    fi
    
    if [ -n "$selected_dir" ]; then
      cd "${selected_dir}"
      echo "✓ 移動先: ${selected_dir}"
    else
      echo "ディレクトリが選択されませんでした"
    fi
    return
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

  # zoxideから履歴を取得し、不要なパスをフィルタリング
  local output=$(zoxide query -l | grep -v -E "$DOTFILES_EXCLUDE_PATTERN")
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
  # Warpターミナルの場合は別の処理
  if is_warp_terminal; then
    if [ ! `pwd | grep "$(ghq root)"` ]; then
      echo "you are not in ghq path"
      return 0
    fi
    
    local selected_path=""
    local files_list=$(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor 2>/dev/null)
    
    if [[ -n "$files_list" ]]; then
      selected_path=$(echo "$files_list" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}' 2>/dev/null)
    fi
    
    if [ -n "$selected_path" ]; then
      if [ -f "$selected_path" ]; then
        nvim "$selected_path"
        dir_path=$(dirname "$selected_path")
        cd "$dir_path"
        echo "✓ 移動先: $dir_path"
      fi
    fi
    return
  fi
  
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
  # Warpターミナルの場合は別の処理
  if is_warp_terminal; then
    local base_path=$(pwd | grep -o "$(ghq root)/[^/]*/[^/]*/[^/]*")
    if [ -z "$base_path" ]; then
      echo "you are not in ghq project"
      return 0
    fi
    
    local paths=$(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor . "$base_path" 2>/dev/null)
    
    if [[ -n "$paths" ]]; then
      local selected_path="$(echo "(root)"$'\n'"$paths" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {} 2>/dev/null || echo "Preview not available"' 2>/dev/null)"
      
      if [ -n "$selected_path" ]; then
        if [[ "$selected_path" = "(root)" ]]; then
          cd "$base_path"
          echo "✓ 移動先: $base_path"
          return 0
        fi
        if [ -f "$selected_path" ]; then
          nvim "$selected_path"
          dir_path=$(dirname "$selected_path")
          cd "$dir_path"
          echo "✓ 移動先: $dir_path"
        elif [ -d "$selected_path" ]; then
          cd "$selected_path"
          echo "✓ 移動先: $selected_path"
        fi
      fi
    else
      echo "プロジェクト内にファイルが見つかりません"
    fi
    return
  fi
  
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
  
  # ZLEが有効かつWarpでない場合のみ、ウィジェット登録とキーバインド設定を行う
  if [[ -o zle ]] && ! is_warp_terminal; then
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
        
        # vimモードの各モードにもキーバインドを設定
        bindkey -M viins '^]' sk_select_src 2>/dev/null || true  # insertモード
        bindkey -M vicmd '^]' sk_select_src 2>/dev/null || true  # normalモード（コマンドモード）
        
        # normalモードでも代替キーを使えるようにする
        bindkey -M vicmd '^\' sk_select_src 2>/dev/null || true  # Ctrl+\
        bindkey -M vicmd '^p' sk_select_src 2>/dev/null || true  # Ctrl+P
        bindkey -M vicmd '\e]' sk_select_src 2>/dev/null || true # Alt+]
      }
      
      # 安全に初期設定を実行
      __setup_wsl_keybinds
      
      # 追加のキーバインド
      bindkey '^v' sk_select_file_within_project  # Ctrl+V
      bindkey '^b' sk_select_file_below_pwd       # Ctrl+B
      
      # WSL環境でのキーバインド一覧を表示
    else
      # macOS / 通常Linux環境用のキーバインド設定関数
      function __setup_macos_keybinds() {
        bindkey '^r' sk_select_history
        bindkey '^g' sk_change_directory
        bindkey '^v' sk_select_file_within_project
        bindkey '^b' sk_select_file_below_pwd
        
        # VSCodeターミナルではCtrl+]が使えないため、代替キーを提供
        if is_vscode_terminal; then
          bindkey '^\' sk_select_src       # Ctrl+\
          bindkey '^p' sk_select_src       # Ctrl+P
        else
          bindkey '^]' sk_select_src
          # vimモードでもキーバインドを設定
          bindkey -M viins '^]' sk_select_src 2>/dev/null || true
          bindkey -M vicmd '^]' sk_select_src 2>/dev/null || true
        fi
      }
      
      # 安全に初期設定を実行
      __setup_macos_keybinds
      
    fi
    
    # 端末起動時に実行する関数を追加（遅延初期化）
    function precmd_setup_keybinds() {
      # この関数はプロンプト表示前に毎回実行される
      # 必要に応じてキーバインドを再設定可能
      
      # ZLEがアクティブかつWarpでなければ、Vimモードでのキーバインドを試行
      if [[ -o zle ]] && ! is_warp_terminal; then
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
  elif is_warp_terminal; then
    # Warpターミナルの場合のヘルプメッセージ
    [[ -z "$WARP_HELP_SHOWN" ]] && {
      echo "📝 Warp terminal detected. Use these commands instead of keybindings:"
      echo "  src  - Select project directory (Ctrl+] alternative)"
      echo "  c    - Change directory with zoxide (Ctrl+G alternative)"
      echo "  b    - Browse files below current directory (Ctrl+B alternative)"
      echo "  v    - Browse files within project (Ctrl+V alternative)"
      echo ""
      echo "Note: Warp doesn't support ZLE widgets, so keybindings are disabled."
      export WARP_HELP_SHOWN=1
    }
  elif is_vscode_terminal; then
    # VSCodeターミナルの場合のヘルプメッセージ
    [[ -z "$VSCODE_HELP_SHOWN" ]] && {
      echo "📝 VSCode terminal detected. Alternative keybindings:"
      echo "  Ctrl+\\ or Ctrl+P - Select project directory (Ctrl+] alternative)"
      echo "  Ctrl+G - Change directory with zoxide"
      echo "  Ctrl+B - Browse files below current directory"
      echo "  Ctrl+V - Browse files within project"
      echo ""
      echo "Alternatively, use command aliases: src, c, b, v"
      export VSCODE_HELP_SHOWN=1
    }
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
- Ctrl+\
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

# 設定ファイルの再読み込み関数（詳細パフォーマンス分析付き）
function sz() {
  # 画面をクリアして新しく開始
  clear
  
  # LOAD ZSH ASCII Artを表示（正確に修正）
  echo ""
  echo -e "\033[38;5;196m██╗      \033[38;5;214m ██████╗  \033[38;5;226m █████╗  \033[38;5;46m██████╗  \033[38;5;51m███████╗\033[38;5;129m██╗  ██╗\033[0m"
  echo -e "\033[38;5;196m██║      \033[38;5;214m██╔═══██╗ \033[38;5;226m██╔══██╗ \033[38;5;46m██║  ██║ \033[38;5;51m██╔════╝\033[38;5;129m██║  ██║\033[0m"
  echo -e "\033[38;5;196m██║      \033[38;5;214m██║   ██║ \033[38;5;226m███████║ \033[38;5;46m██║  ██║ \033[38;5;51m███████╗\033[38;5;129m███████║\033[0m"
  echo -e "\033[38;5;196m██║      \033[38;5;214m██║   ██║ \033[38;5;226m██╔══██║ \033[38;5;46m██║  ██║ \033[38;5;51m╚════██║\033[38;5;129m██╔══██║\033[0m"
  echo -e "\033[38;5;196m███████╗ \033[38;5;214m╚██████╔╝ \033[38;5;226m██║  ██║ \033[38;5;46m██████╔╝ \033[38;5;51m███████║\033[38;5;129m██║  ██║\033[0m"
  echo -e "\033[38;5;196m╚══════╝ \033[38;5;214m ╚═════╝  \033[38;5;226m╚═╝  ╚═╝ \033[38;5;46m╚═════╝  \033[38;5;51m╚══════╝\033[38;5;129m╚═╝  ╚═╝\033[0m"
  echo ""
  
  # 現在のPATHを保存
  local OLD_PATH="$PATH"
  
  # OS検出（date用）
  local IS_MACOS=0
  if [[ "$(uname)" == "Darwin" ]]; then
    IS_MACOS=1
  fi
  
  # 時間を取得する関数（OS間の互換性を確保）
  function get_timestamp() {
    if [[ $IS_MACOS -eq 1 ]]; then
      # macOSではdateコマンドを使用（gdateは不要）
      date +%s.%N
    else
      # Linux/WSLではdateコマンドが%Nをサポート
      date +%s.%N
    fi
  }
  
  # ファイルのトレースとパフォーマンス計測をセットアップ
  local debug=${SZ_DEBUG:-0}
  local start_time end_time duration
  local spinner=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local spin_idx=0
  # 一時ファイルをクリーンアップ（前回の実行で残っている可能性があるため）
  # zshのglobパターンでファイルが見つからない場合のエラーを抑制
  setopt local_options no_nomatch
  /bin/rm -f /tmp/sz_loading_* /tmp/sz_times_* 2>/dev/null
  
  # パフォーマンス計測用の一時ディレクトリを作成
  mkdir -p /tmp/sz_times
  
  # ロードアニメーション関数
  function spin() {
    local step=$1
    local spinner_file="/tmp/sz_loading_${step}"
    while [ -e "$spinner_file" ]; do
      printf "\r\033[K [%s] %s Loading..." "$step" "${spinner[$spin_idx]}"
      spin_idx=$(( (spin_idx + 1) % 10 ))
      sleep 0.1
    done
    printf "\r\033[K"
  }
  
  # ソースファイル関数のオーバーライド（bcなどの外部コマンドに依存しない）
  function time_source() {
    local file=$1
    local file_name="${file##*/}"  # basename の代わりに zsh のパラメータ展開を使用
    local start=$(get_timestamp)
    
    # ファイル名が空でないか確認
    if [[ -z "$file" || "$file" == "-" ]]; then
      builtin source "$file" 2>/dev/null
      return
    fi
    
    # 元のsource関数を使用してファイルを読み込み
    builtin source "$file" 2>/dev/null
    
    local end=$(get_timestamp)
    
    # bc を使わずに計算（zsh の算術展開を使用）
    # end/startが数値でなければ計算しない
    if [[ "$end" =~ ^[0-9]+(\.[0-9]+)?$ && "$start" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
      local time_diff=$(( end - start ))
      
      # 時間を記録（ファイル名が妥当な場合のみ）
      if [[ -n "$file" && "$file" != "-" && "$file" != ":" ]]; then
        printf "%s:%.6f\n" "$file" $time_diff >> /tmp/sz_times/all_files.txt
      fi
    fi
  }
  
  # 元のsource関数を保存
  local original_source=$(which source)
  
  # デバッグモードの場合のみオーバーライド
  if [ "$debug" = "1" ]; then
    functions[source]="time_source"
  fi
  
  # DOTENV_ALWAYS_LOADを設定（.envファイルの自動読み込み）
  export DOTENV_ALWAYS_LOAD=1
  
  # === zshenv のロード ===
  touch /tmp/sz_loading_zshenv
  spin "zshenv" &
  local SPIN_PID=$!
  
  start_time=$(get_timestamp)
  if [ -f ~/.zshenv ]; then
    if [ "$debug" = "1" ]; then
      time_source ~/.zshenv
    else
      source ~/.zshenv 2>/dev/null
    fi
  fi
  end_time=$(get_timestamp)
  
  # 時間計算（数値チェック）
  local zshenv_time=0
  if [[ "$end_time" =~ ^[0-9]+(\.[0-9]+)?$ && "$start_time" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    zshenv_time=$(( end_time - start_time ))
  fi
  
  /bin/rm -f /tmp/sz_loading_zshenv
  wait $SPIN_PID 2>/dev/null
  
  # === zshrc のロード ===
  # 設定ファイルパスの保存（新しいディレクトリ構造に対応）
  local config_files=(
    "$ZDOTDIR/core/options.zsh"
    "$ZDOTDIR/core/plugins.zsh"
    "$ZDOTDIR/core/prompt.zsh"
    "$ZDOTDIR/core/functions.zsh"
    "$ZDOTDIR/core/aliases.zsh"
    "$ZDOTDIR/platform/macos/brew.zsh"
  )
  
  # External tools
  config_files+=(
    "$ZDOTDIR/external/cli/starship.zsh"
    "$ZDOTDIR/external/cli/mise.zsh"
    "$ZDOTDIR/external/cli/zoxide.zsh"
  )
  
  # Editor integrations
  for file in "$ZDOTDIR"/external/editors/*.zsh; do
    [ -r "$file" ] && config_files+=("$file")
  done
  
  # OS固有の設定ファイルを追加
  if [[ $IS_MACOS -eq 1 ]]; then
    config_files+=("$ZDOTDIR/external/ui/sketchybar.zsh")
  fi
  
  touch /tmp/sz_loading_zshrc
  spin "zshrc" &
  SPIN_PID=$!
  
  start_time=$(get_timestamp)
  if [ -f ~/.zshrc ]; then
    if [ "$debug" = "1" ]; then
      time_source ~/.zshrc
    else
      source ~/.zshrc 2>/dev/null
    fi
  fi
  end_time=$(get_timestamp)
  
  # 時間計算（数値チェック）
  local zshrc_time=0
  if [[ "$end_time" =~ ^[0-9]+(\.[0-9]+)?$ && "$start_time" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    zshrc_time=$(( end_time - start_time ))
  fi
  
  /bin/rm -f /tmp/sz_loading_zshrc
  wait $SPIN_PID 2>/dev/null
  
  # source関数を元に戻す
  if [ "$debug" = "1" ]; then
    functions[source]="$original_source"
  fi
  
  # DOTENV_ALWAYS_LOADをリセット
  unset DOTENV_ALWAYS_LOAD
  
  # PATHが壊れた場合、元に戻す安全装置
  if ! command -v ls &>/dev/null; then
    export PATH="$OLD_PATH"
    echo "⚠️ PATHが破損したため、元の状態に復元しました"
  fi
  
  # スタイリッシュな完了メッセージ
  echo -e "\033[38;5;39m╔════════════════════════════════════╗"
  echo -e "║\033[38;5;255m        CONFIGURATION RELOADED       \033[38;5;39m║"
  echo -e "╚════════════════════════════════════╝\033[0m"
  
  # デバッグ情報表示（オプション）
  if [ "$debug" = "1" ]; then
    # 外部コマンドへの依存を減らしたシンプルな表示
    echo -e "\n\033[38;5;214m== パフォーマンス情報 ==\033[0m"
    
    # 小数点以下6桁に制限（zshの組み込み機能のみを使用）
    printf "zshenv: \033[38;5;82m%.6f秒\033[0m\n" $zshenv_time
    printf "zshrc: \033[38;5;82m%.6f秒\033[0m\n" $zshrc_time
    
    # 簡易計算（bcを使用せず）
    local total_time=$(( zshenv_time + zshrc_time ))
    printf "合計: \033[38;5;82m%.6f秒\033[0m\n" $total_time
    
    # ファイルベースの分析結果
    if [ -f /tmp/sz_times/all_files.txt ]; then
      echo -e "\n\033[38;5;214m== ファイルの読み込み時間 ==\033[0m"
      
      # 最も時間のかかったファイルをzshの機能だけで処理
      echo -e "\033[38;5;226m最も時間のかかったファイル（上位10件）:\033[0m"
      
      # ファイルを読み込み、空のエントリを除外
      local files=()
      local times=()
      local idx=0
      
      while IFS=: read -r file time; do
        # 空でないファイル名のみを処理
        if [[ -n "$file" && "$file" != "-" && "$file" != ":" ]]; then
          files[$idx]="$file"
          times[$idx]="$time"
          ((idx++))
        fi
      done < /tmp/sz_times/all_files.txt
      
      # 簡易的なソート（bcなどの外部コマンドを完全に使わない）
      # 単純なバブルソート - 数値を小数点を除去して整数比較
      for ((i=0; i<${#times[@]}; i++)); do
        for ((j=0; j<${#times[@]}-i-1; j++)); do
          # 小数点を除去して整数に変換（単純な比較のため）
          local t1=$(printf "%.0f" $(( ${times[$j]} * 1000000 )))
          local t2=$(printf "%.0f" $(( ${times[$j+1]} * 1000000 )))
          
          if (( t1 < t2 )); then
            # 値の入れ替え
            local temp_time="${times[$j]}"
            local temp_file="${files[$j]}"
            times[$j]="${times[$j+1]}"
            files[$j]="${files[$j+1]}"
            times[$j+1]="$temp_time"
            files[$j+1]="$temp_file"
          fi
        done
      done
      
      # 上位10ファイルを表示
      local count=0
      for ((i=0; i<${#files[@]} && i<10; i++)); do
        local file="${files[$i]}"
        local time="${times[$i]}"
        
        # ファイル名を短縮（表示用）
        local short_file="$file"
        if [ ${#file} -gt 40 ]; then
          short_file="...${file: -40}"
        fi
        
        # 表示（シンプルな条件分岐）
        if (( time >= 1.0 )); then
          echo -e "  $((i+1)). \033[38;5;196m$short_file: \033[1m${time}秒\033[0m \033[38;5;196m⚠️ ボトルネック!\033[0m"
        else
          echo -e "  $((i+1)). \033[38;5;39m$short_file: ${time}秒\033[0m"
        fi
        
        count=$((count+1))
      done
      
      # 合計ファイル数
      echo -e "\n\033[38;5;226m合計 ${#files[@]} ファイルが読み込まれました\033[0m"
      
      # ボトルネックと改善提案
      echo -e "\n\033[38;5;214m== 改善提案 ==\033[0m"
      
      # 1秒以上かかるファイルがあるかチェック
      local has_bottleneck=0
      local bottleneck_count=0
      
      for ((i=0; i<${#files[@]} && bottleneck_count<5; i++)); do
        local file="${files[$i]}"
        local time="${times[$i]}"
        
        if (( time >= 1.0 )); then
          has_bottleneck=1
          bottleneck_count=$((bottleneck_count+1))
          
          # ファイル名から基本名を取得
          local base_file="${file##*/}"
          echo -e "\033[38;5;226m$base_file \033[38;5;196m(${time}秒)\033[0m \033[38;5;226mの改善方法:\033[0m"
          
          # ファイルタイプに基づく提案
          case "$base_file" in
            *plugin*.zsh)
              echo -e "  - プラグインの数を減らす"
              echo -e "  - zinitで遅延ロードを設定する"
              ;;
            *prompt*.zsh)
              echo -e "  - プロンプトをシンプルにする"
              echo -e "  - Git情報など動的な要素を減らす"
              ;;
            *sketchybar*.zsh)
              echo -e "  - sketchybarの設定を軽量化する"
              echo -e "  - 更新頻度を下げる"
              ;;
            *.zshrc|*.zshenv)
              echo -e "  - 起動時の処理を最小限にする"
              echo -e "  - 遅延初期化を導入する"
              ;;
            *)
              echo -e "  - 処理を最適化する"
              echo -e "  - 条件付き読み込みを検討する"
              ;;
          esac
        fi
      done
      
      if [ $has_bottleneck -eq 0 ]; then
        echo -e "\033[38;5;82m設定ファイルの読み込み速度は良好です！\033[0m"
      fi
    else
      echo -e "\033[38;5;196mファイル分析データがありません\033[0m"
    fi
    
    # クリーンアップ
    /bin/rm -rf /tmp/sz_times 2>/dev/null
  fi
}

# パフォーマンスデバッグを有効にする関数
function sz_debug() {
  export SZ_DEBUG=1
  sz
}

# Zoxideデータベースのクリーンアップ
function zoxide_cleanup() {
  echo "🧹 Zoxideデータベースをクリーンアップしています..."
  
  # 除外パターンに該当するディレクトリを削除
  local patterns=(
    "\.Trash"
    "\.cache"
    "\.aws"
    "\.devin"
    "config/claude"
    "\.vscode"
    "__pycache__"
    "node_modules"
    "vendor"
    "\.idea"
    "build"
    "dist"
    "target"
    "\.next"
    "\.nuxt"
    "coverage"
    "\.pytest_cache"
    "\.mypy_cache"
    "venv"
    "\.venv"
  )
  
  local removed_count=0
  for pattern in "${patterns[@]}"; do
    # zoxide query -lでリストを取得し、パターンにマッチするものを削除
    local dirs_to_remove=$(zoxide query -l | grep -E "$pattern" || true)
    if [[ -n "$dirs_to_remove" ]]; then
      echo "$dirs_to_remove" | while read -r dir; do
        zoxide remove "$dir" 2>/dev/null && {
          echo "  ✓ 削除: $dir"
          ((removed_count++))
        }
      done
    fi
  done
  
  echo "🎉 完了: ${removed_count}個のディレクトリを削除しました"
  echo "💡 ヒント: 今後これらのディレクトリは自動的に除外されます"
}

# ghqリストのキャッシュを更新する関数
function update_ghq_cache() {
  local cache_file="$HOME/.cache/ghq_list_cache"
  echo "ghqプロジェクトリストのキャッシュを更新中..."
  
  # キャッシュディレクトリが存在しない場合は作成
  mkdir -p "$HOME/.cache"
  
  # バックグラウンドで更新
  (ghq list -p > "$cache_file.tmp" && mv "$cache_file.tmp" "$cache_file" && echo "✓ キャッシュ更新完了") &
  
  echo "バックグラウンドで更新を開始しました"
}

# エイリアス
alias ghq-update='update_ghq_cache'
alias ghq-cache-update='update_ghq_cache'

