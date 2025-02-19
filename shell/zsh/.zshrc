# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Source all zsh config files
for config_file ($ZDOTDIR/*.zsh) source $config_file

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

# Source plugins configuration
source "$ZDOTDIR/plugins.zsh"

# Source aliases
source "$ZDOTDIR/aliases.zsh"

# Source functions
source "$ZDOTDIR/functions.zsh"

# Source options
source "$ZDOTDIR/options.zsh"

# Initialize starship prompt
eval "$(starship init zsh)"

# Load local config if exists
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# Load environment variables
if [ -f "$HOME/.dotfiles/.env" ]; then
  set -a
  source "$HOME/.dotfiles/.env"
  set +a
fi

# Load configurations
source "$ZDOTDIR/options.zsh"
source "$ZDOTDIR/plugins.zsh"
source "$ZDOTDIR/prompt.zsh"
source "$ZDOTDIR/aliases.zsh"
source "$ZDOTDIR/functions.zsh"
source "$ZDOTDIR/brew.zsh"

# Initialize mise
eval "$(mise activate zsh)" 