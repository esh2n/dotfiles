# XDG Base Directory / XDG ベースディレクトリ
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"

# Minimal PATH bootstrap so core utilities are always reachable
typeset -U path PATH
typeset -a _inherited_path=("${path[@]}")
path=(
    $HOME/bin
    /opt/homebrew/bin
    /opt/homebrew/sbin
    /usr/local/bin
    /usr/bin
    /bin
    /usr/sbin
    /sbin
)
if (( ${#_inherited_path[@]} )); then
    path+=("${_inherited_path[@]}")
fi
unset _inherited_path

# OS Detection / OS判定
# zsh sets $OSTYPE natively (e.g. darwin25.0, linux-gnu) — map it to the
# uname -s style names the rest of the config compares against, no fork.
case "$OSTYPE" in
    darwin*) OSTYPE="Darwin" ;;
    linux*)  OSTYPE="Linux" ;;
    Darwin|Linux) ;; # already mapped (re-sourced)
    *) OSTYPE=${OSTYPE:-unknown} ;;
esac
IS_WSL=0
if [ "$OSTYPE" = "Linux" ]; then
  if grep -qi microsoft /proc/version 2>/dev/null || grep -qi wsl /proc/version 2>/dev/null; then
    IS_WSL=1
  fi
fi

# Go/GHQ paths
export GOPATH="$HOME/go"
export GOBIN="$GOPATH/bin"
export GHQ_ROOT="$GOPATH"

# Load profile if exists
[ -f "$HOME/.profile" ] && source "$HOME/.profile"

# mise: activation lives in integrations.zsh (interactive shells only).
# Running `mise activate` here cost ~25ms on every zsh invocation for
# nothing — its hooks only fire at interactive prompts, and non-interactive
# shells are covered by the mise shims already on PATH below.

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
    
    # Bun
    export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
    
    # macOS Paths
    path=(
        "$HOME/bin"
        /opt/homebrew/opt/libpq/bin
        /Applications/WezTerm.app/Contents/MacOS
        "$HOME/.local/share/mise/shims"
        "$HOME/.cargo/bin"
        "$PNPM_HOME"
        "$BUN_INSTALL/bin"
        "${path[@]}"
    )
elif [ "$IS_WSL" = "1" ]; then
    # === WSL ===
    
    # PNPM
    export PNPM_HOME="$HOME/.local/share/pnpm"

    # WSL Paths
    path=(
        "$HOME/.local/bin"
        "$HOME/.cargo/bin"
        "$PNPM_HOME"
        "${path[@]}"
    )
else
    # === Linux ===
    
    # PNPM
    export PNPM_HOME="$HOME/.local/share/pnpm"
    
    # Linux Paths
    path=(
        "$HOME/.local/bin"
        "$HOME/.cargo/bin"
        "$PNPM_HOME"
        "${path[@]}"
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
