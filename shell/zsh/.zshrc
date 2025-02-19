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

# Set ZDOTDIR to the dotfiles directory
ZDOTDIR="$HOME/.zsh"

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
eval "$(zoxide init zsh --cmd cd --hook pwd)"

# Load configurations
source "$ZDOTDIR/options.zsh"
source "$ZDOTDIR/plugins.zsh"
source "$ZDOTDIR/prompt.zsh"
source "$ZDOTDIR/aliases.zsh"
source "$ZDOTDIR/functions.zsh"
source "$ZDOTDIR/brew.zsh"

# Initialize starship prompt
eval "$(starship init zsh)"

# Load local config if exists
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# Initialize mise
eval "$(mise activate zsh)" 