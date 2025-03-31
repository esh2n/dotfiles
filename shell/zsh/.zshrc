# Amazon Q pre block. Keep at the top of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.pre.zsh"

# Load environment variables
if [ -f "$HOME/go/github.com/esh2n/dotfiles/.env" ]; then
    set -a
    source "$HOME/go/github.com/esh2n/dotfiles/.env"
    set +a
fi

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# ZSH設定ディレクトリの設定
# 既にZDOTDIRが設定されていない場合のみ設定
if [[ -z "${ZDOTDIR}" ]]; then
  ZDOTDIR="$HOME/.zsh"
fi

# Initialize zinit
ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"
source "${ZINIT_HOME}/zinit.zsh"

# Load completion system
autoload -Uz compinit
compinit -d "${XDG_CACHE_HOME:-$HOME/.cache}/zcompdump-$ZSH_VERSION"

# Load required functions
autoload -Uz add-zsh-hook
autoload -Uz cdr
autoload -Uz chpwd_recent_dirs

# Initialize zoxide with better matching and no command aliases
if type zoxide > /dev/null 2>&1; then
  if [ "$IS_WSL" = "1" ]; then
    # WSL環境用のシンプルな初期化（オプションなし）
    eval "$(zoxide init zsh)"
  else
    # 通常環境用の高度な初期化
    eval "$(zoxide init zsh --cmd cd --hook pwd)"
  fi
fi

# Load configurations
source "$ZDOTDIR/options.zsh"
source "$ZDOTDIR/plugins.zsh"
source "$ZDOTDIR/prompt.zsh"
source "$ZDOTDIR/trash.zsh"
source "$ZDOTDIR/functions.zsh"
source "$ZDOTDIR/aliases.zsh"
source "$ZDOTDIR/brew.zsh"

# Initialize starship prompt
eval "$(starship init zsh)"

# MARK: - Local Config

# Enable window borders (uncomment to use)
# if [ -x "$HOME/.config/borders/bordersrc" ]; then
#   $HOME/.config/borders/bordersrc &>/dev/null &
# fi

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
    if [[ $IS_MACOS -eq 1 ]] && command -v gdate >/dev/null 2>&1; then
      gdate +%s.%N
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
  # 設定ファイルパスの保存
  local config_files=(
    "$ZDOTDIR/options.zsh"
    "$ZDOTDIR/plugins.zsh"
    "$ZDOTDIR/prompt.zsh"
    "$ZDOTDIR/trash.zsh"
    "$ZDOTDIR/functions.zsh"
    "$ZDOTDIR/aliases.zsh"
    "$ZDOTDIR/brew.zsh"
  )
  
  # OS固有の設定ファイルを追加
  if [[ $IS_MACOS -eq 1 ]]; then
    config_files+=("$ZDOTDIR/sketchybar.zsh")
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

# Load sketchybar config (macOSのみ)
if [[ "$(uname)" == "Darwin" ]]; then
  source "$ZDOTDIR/sketchybar.zsh"
fi

# Load local config if exists
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# Amazon Q post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh"

# Initialize vscode shell integration
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"

# Initialize cursor shell integration
[[ "$TERM_PROGRAM" == "cursor" ]] && . "$(cursor --locate-shell-integration-path zsh)"
