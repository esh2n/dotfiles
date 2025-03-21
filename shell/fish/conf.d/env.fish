# Initialize mise
if command -v mise >/dev/null 2>&1
    mise activate fish | source
end

# Path
fish_add_path /opt/homebrew/bin
fish_add_path $HOME/.local/share/mise/shims
fish_add_path $HOME/.cargo/bin
fish_add_path $HOME/go/bin

# Go
set -gx GOPATH $HOME/go
set -gx GO111MODULE on

# Node
set -gx NODE_ENV development

# Rust
set -gx RUSTUP_HOME $HOME/.rustup
set -gx CARGO_HOME $HOME/.cargo

# Python
set -gx PYTHONDONTWRITEBYTECODE 1

# FZF
set -gx FZF_DEFAULT_OPTS "--height 40% --layout=reverse --border --inline-info"
set -gx FZF_DEFAULT_COMMAND "fd --type f --hidden --follow --exclude .git"

# Homebrew
set -gx HOMEBREW_NO_AUTO_UPDATE 1
set -gx HOMEBREW_NO_ANALYTICS 1

# GPG
set -gx GPG_TTY (tty)

# Starship config
set -gx STARSHIP_CONFIG $HOME/.config/starship/starship.toml

# ghq
set -gx GHQ_ROOT $HOME/go/github.com 