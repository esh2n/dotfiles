# Tool Integrations

# Zoxide (Smart Directory Jumper)
if command -v zoxide &>/dev/null; then
  export _ZO_EXCLUDE_DIRS="$HOME/.Trash:$HOME/Library:$HOME/.cache:$HOME/.aws:*/.git:*/node_modules:*/vendor:*/.venv"
  eval "$(zoxide init zsh)"
fi

# Starship (Prompt)
if command -v starship &>/dev/null; then
  # Use generated config from dotfiles (via symlink)
  export STARSHIP_CONFIG="${HOME}/.config/starship/starship.toml"
  eval "$(starship init zsh)"
fi

# Mise (Version Manager)
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
fi

# Direnv (Environment Switcher)
if command -v direnv &>/dev/null; then
  eval "$(direnv hook zsh)"
fi
