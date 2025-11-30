# Tool Integrations

# Zoxide (Smart Directory Jumper)
if command -v zoxide &>/dev/null; then
  export _ZO_EXCLUDE_DIRS="$HOME/.Trash:$HOME/Library:$HOME/.cache:$HOME/.aws:*/.git:*/node_modules:*/vendor:*/.venv"
  eval "$(zoxide init zsh)"
fi

# Starship (Prompt)
if command -v starship &>/dev/null; then
  # Copy template to local config if not exists
  starship_local="$HOME/.config/starship.toml"
  starship_template="${DOTFILES_ROOT:-${HOME}}/domains/dev/config/starship/starship.toml.template"
  if [[ ! -f "$starship_local" ]] && [[ -f "$starship_template" ]]; then
    mkdir -p "$HOME/.config"
    cp "$starship_template" "$starship_local"
  fi
  unset starship_local starship_template
  # Use default config path (~/.config/starship.toml)
  eval "$(starship init zsh)"
fi

# Mise (Version Manager)
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
fi
