# XDG Base Directory
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"

# Path
export PNPM_HOME="~/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
export PATH="/Applications/WezTerm.app/Contents/MacOS:$PATH"

# FNM (Fast Node Manager)
export FNM_VERSION_FILE_STRATEGY="local"
export FNM_DIR="$HOME/Library/Application Support/fnm"
export FNM_LOGLEVEL="info"
export FNM_ARCH="arm64"
export FNM_NODE_DIST_MIRROR="https://nodejs.org/dist"
export FNM_MULTISHELL_PATH="$HOME/Library/Caches/fnm_multishells/64317_1686306935786"
export PATH="$HOME/Library/Caches/fnm_multishells/64317_1686306935786/bin:$PATH"

# Editor
export EDITOR="nvim"
export VISUAL="nvim"

# Language
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"

# Less
export LESS="-R"
export LESSHISTFILE="-" 