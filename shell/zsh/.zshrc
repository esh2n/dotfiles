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
fi

# Starship is now loaded from external/cli/starship.zsh

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

# Amazon Q post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/amazon-q/shell/zshrc.post.zsh"

# Editor integrations and CLI tools are now loaded from external/