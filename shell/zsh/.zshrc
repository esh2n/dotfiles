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
# .zshenvで設定された値を使用
if [[ -z "${ZDOTDIR}" ]]; then
  echo "⚠️ ZDOTDIRが設定されていません。.zshenvで設定してください。"
  return 1
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
# WSL環境の検出
if grep -q -E "microsoft|wsl" /proc/version 2>/dev/null; then
  export IS_WSL=1
else
  export IS_WSL=0
fi

# Initialize zoxide with better matching and no command aliases
if type zoxide > /dev/null 2>&1; then
  if [ "$IS_WSL" = "1" ]; then
    # WSL環境用のシンプルな初期化（補完の問題を回避）
    eval "$(zoxide init zsh --no-cmd)"
    
    # z、ziコマンドを手動で定義（補完なしバージョン）
    function z() {
      __zoxide_z "$@"
    }
    
    function zi() {
      __zoxide_zi "$@"
    }
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

# Load sketchybar config (macOSのみ)
if [[ "$(uname)" == "Darwin" ]]; then
  source "$ZDOTDIR/sketchybar.zsh"
fi

# Load local config if exists
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# Initialize vscode shell integration
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"

# Initialize cursor shell integration
[[ "$TERM_PROGRAM" == "cursor" ]] && . "$(cursor --locate-shell-integration-path zsh)"

# Amazon Q post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh"
