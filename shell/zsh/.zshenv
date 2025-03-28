# XDG Base Directory
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"

# Initialize mise early to ensure all tools are available
if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate zsh)"
fi

# Load profile if exists
[ -f "$HOME/.profile" ] && source "$HOME/.profile"

# Homebrew
if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# PNPM
export PNPM_HOME="$HOME/Library/pnpm"

# Path
typeset -U path PATH
path=(
    /opt/homebrew/bin
    /opt/homebrew/sbin
    /usr/local/bin
    /usr/bin
    /bin
    /usr/sbin
    /sbin
    /opt/homebrew/opt/libpq/bin
    /Applications/WezTerm.app/Contents/MacOS
    "$HOME/.local/share/mise/shims"
    "$HOME/.cargo/bin"
    "$PNPM_HOME"
    $path
)
export PATH

# FNM (Fast Node Manager)
export FNM_VERSION_FILE_STRATEGY="local"
export FNM_DIR="$HOME/Library/Application Support/fnm"
export FNM_LOGLEVEL="info"
export FNM_ARCH="arm64"
export FNM_NODE_DIST_MIRROR="https://nodejs.org/dist"
export FNM_MULTISHELL_PATH="$HOME/Library/Caches/fnm_multishells/64317_1686306935786"

# Editor
export EDITOR="nvim"
export VISUAL="nvim"

# Language
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"

# Less
export LESS="-R"
export LESSHISTFILE="-"

# OrbStack integration
[ -f "$HOME/.orbstack/shell/init.zsh" ] && source "$HOME/.orbstack/shell/init.zsh" 2>/dev/null || : 