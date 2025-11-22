# XDG Base Directory / XDG ベースディレクトリ
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"

# OS Detection / OS判定
OSTYPE=$(uname -s)
IS_WSL=0
if [ "$OSTYPE" = "Linux" ]; then
  if grep -qi microsoft /proc/version 2>/dev/null || grep -qi wsl /proc/version 2>/dev/null; then
    IS_WSL=1
  fi
fi

# Load profile if exists
[ -f "$HOME/.profile" ] && source "$HOME/.profile"

# mise (Conditional Initialization / 条件付き初期化)
if command -v mise >/dev/null 2>&1; then
    eval "$(mise activate zsh)"
fi

# OS Specific Settings / OS固有の設定
if [ "$OSTYPE" = "Darwin" ]; then
    # === macOS ===
    
    # PNPM
    export PNPM_HOME="$HOME/Library/pnpm"
    
    # FNM (Fast Node Manager)
    export FNM_VERSION_FILE_STRATEGY="local"
    export FNM_DIR="$HOME/Library/Application Support/fnm"
    export FNM_LOGLEVEL="info"
    export FNM_ARCH="arm64"
    export FNM_NODE_DIST_MIRROR="https://nodejs.org/dist"
    export FNM_MULTISHELL_PATH="$HOME/Library/Caches/fnm_multishells/64317_1686306935786"
    
    # macOS Paths
    typeset -U path PATH
    path=(
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
    # === WSL ===
    
    # PNPM
    export PNPM_HOME="$HOME/.local/share/pnpm"

    # WSL Paths
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
    # === Linux ===
    
    # PNPM
    export PNPM_HOME="$HOME/.local/share/pnpm"
    
    # Linux Paths
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

# Editor / エディタ設定
export EDITOR="nvim"
export VISUAL="nvim"

# Language / 言語設定
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"

# Less
export LESS="-R"
export LESSHISTFILE="-"

# OrbStack integration
[ -f "$HOME/.orbstack/shell/init.zsh" ] && source "$HOME/.orbstack/shell/init.zsh" 2>/dev/null || :
