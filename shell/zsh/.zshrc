# Amazon Q pre block. Keep at the top of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.pre.zsh"

# Go binaries path
export PATH="$HOME/go/bin:$PATH"
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
<<<<<<< HEAD
# WSL環境の検出
if [[ -f /proc/version ]] && grep -q -E "microsoft|wsl" /proc/version 2>/dev/null; then
  export IS_WSL=1
else
  export IS_WSL=0
||||||| 892c8be
# WSL環境の検出
if grep -q -E "microsoft|wsl" /proc/version 2>/dev/null; then
  export IS_WSL=1
else
  export IS_WSL=0
=======
# WSL環境の検出はplatform/macos/brew.zshで実行

# Load core configurations
source "$ZDOTDIR/core/options.zsh"
source "$ZDOTDIR/core/plugins.zsh"
source "$ZDOTDIR/core/prompt.zsh"
source "$ZDOTDIR/core/functions.zsh"
source "$ZDOTDIR/core/aliases.zsh"

# Load platform-specific configurations
source "$ZDOTDIR/platform/macos/brew.zsh"

# Load external tool configurations
source "$ZDOTDIR/external/cli/starship.zsh"
source "$ZDOTDIR/external/cli/mise.zsh"
source "$ZDOTDIR/external/cli/zoxide.zsh"

# Load editor integrations
for file in "$ZDOTDIR"/external/editors/*.zsh; do
  [ -r "$file" ] && source "$file"
done

# Load UI tools (macOS only)
if [[ "$(uname)" == "Darwin" && -z "$DISABLE_SKETCHYBAR" ]]; then
  source "$ZDOTDIR/external/ui/sketchybar.zsh"
>>>>>>> main
fi

<<<<<<< HEAD
# Initialize zoxide with better matching and no command aliases
# if type zoxide > /dev/null 2>&1; then
#   if [ "$IS_WSL" = "1" ]; then
#     # WSL環境用のシンプルな初期化（補完の問題を回避）
#     eval "$(zoxide init zsh --no-cmd)"
    
#     # z、ziコマンドを手動で定義（補完なしバージョン）
#     function z() {
#       __zoxide_z "$@"
#     }
    
#     function zi() {
#       __zoxide_zi "$@"
#     }
#   else
#     # 通常環境用の高度な初期化
#     eval "$(zoxide init zsh --cmd cd --hook pwd)"
#   fi
# fi

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
||||||| 892c8be
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
=======
# Starship is now loaded from external/cli/starship.zsh
>>>>>>> main

# MARK: - Local Config

# Enable window borders (uncomment to use)
# if [ -x "$HOME/.config/borders/bordersrc" ]; then
#   $HOME/.config/borders/bordersrc &>/dev/null &
# fi

# Sketchybar is now loaded from external/ui/sketchybar.zsh

# Debug mode for terminal issues
if [[ "${ZSH_DEBUG_TERMINAL}" == "1" ]]; then
  echo "Terminal: $TERM_PROGRAM"
  echo "Current keybindings for Enter:"
  bindkey | grep -E "(\^M|\^J|accept-line)"
fi

# Load local config if exists
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

<<<<<<< HEAD
# Initialize vscode shell integration
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"

# Initialize cursor shell integration
[[ "$TERM_PROGRAM" == "cursor" ]] && . "$(cursor --locate-shell-integration-path zsh)"

# Amazon Q post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh"
alias claude="/Users/shunya.endo/.claude/local/claude"

export CLAUDE_CODE_USE_BEDROCK=
export AWS_REGION=us-east-1
# opus
# export ANTHROPIC_MODEL='arn:aws:bedrock:us-east-1:067079833497:application-inference-profile/yyzkigl6f11i'
# sonnet
# export ANTHROPIC_MODEL='arn:aws:bedrock:us-east-1:067079833497:application-inference-profile/01xyeak8m4yy'

[[ "$TERM_PROGRAM" == "kiro" ]] && . "$(kiro --locate-shell-integration-path zsh)"
export PATH="$(aqua root-dir)/bin:$PATH"

if [ -z "$DISABLE_ZOXIDE" ] && [ -z "$CLAUDECODE" ]; then
    eval "$(zoxide init --cmd cd zsh)"
fi

. "$HOME/.local/share/../bin/env"
export PATH=$PATH:$HOME/go/bin
export PATH=$HOME/go/bin:$PATH

# Docker GitHub Container Registry login alias
# 必要な時だけトークンを取得（キャッシュしない）
alias docker-ghcr-login='echo "$(gh auth token --active)" | docker login ghcr.io -u "$(git config user.name)" --password-stdin'

# 特定のアカウントでログインしたい場合のエイリアス
alias docker-ghcr-login-eightcard='echo "$(gh auth token -u esh3n)" | docker login ghcr.io -u esh3n --password-stdin'
alias docker-ghcr-login-sansan='echo "$(gh auth token -u shunya-endo_sansan)" | docker login ghcr.io -u shunya-endo_sansan --password-stdin'
||||||| 892c8be
# Amazon Q post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh"

# Initialize vscode shell integration
[[ "$TERM_PROGRAM" == "vscode" ]] && . "$(code --locate-shell-integration-path zsh)"

# Initialize cursor shell integration
[[ "$TERM_PROGRAM" == "cursor" ]] && . "$(cursor --locate-shell-integration-path zsh)"
=======
# Amazon Q post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh"

# Editor integrations and CLI tools are now loaded from external/
>>>>>>> main
