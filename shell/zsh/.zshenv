# XDG Base Directory
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"

# OS判定
OSTYPE=$(uname -s)
IS_WSL=0
if [ "$OSTYPE" = "Linux" ]; then
  if grep -qi microsoft /proc/version 2>/dev/null || grep -qi wsl /proc/version 2>/dev/null; then
    IS_WSL=1
  fi
fi

# Load profile if exists
[ -f "$HOME/.profile" ] && source "$HOME/.profile"

# mise (条件付き初期化)
if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate zsh)"
fi

# OS固有の設定
if [ "$OSTYPE" = "Darwin" ]; then
    # === macOS固有の設定 ===
    
    # Homebrew
    if [ -f "/opt/homebrew/bin/brew" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    
    # PNPM (macOS)
    export PNPM_HOME="$HOME/Library/pnpm"
    
    # FNM (Fast Node Manager) - macOS設定
    export FNM_VERSION_FILE_STRATEGY="local"
    export FNM_DIR="$HOME/Library/Application Support/fnm"
    export FNM_LOGLEVEL="info"
    export FNM_ARCH="arm64"
    export FNM_NODE_DIST_MIRROR="https://nodejs.org/dist"
    export FNM_MULTISHELL_PATH="$HOME/Library/Caches/fnm_multishells/64317_1686306935786"
    
    # macOS固有のパス
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
elif [ "$IS_WSL" = "1" ]; then
    # === WSL固有の設定 ===
    
    # PNPM (Linux/WSL)
    export PNPM_HOME="$HOME/.local/share/pnpm"

    # WSL固有のパス
    typeset -U path PATH
    path=(
        /usr/local/bin
        /usr/bin
        /bin
        /usr/sbin
        /sbin
        "$HOME/.local/bin"
        "$HOME/.cargo/bin"
        "$PNPM_HOME"
        $path
    )
else
    # === 通常Linux環境の設定 ===
    
    # PNPM (Linux)
    export PNPM_HOME="$HOME/.local/share/pnpm"
    
    # Linux固有のパス
    typeset -U path PATH
    path=(
        /usr/local/bin
        /usr/bin
        /bin
        /usr/sbin
        /sbin
        "$HOME/.local/bin"
        "$HOME/.cargo/bin"
        "$PNPM_HOME"
        $path
    )
fi

export PATH

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