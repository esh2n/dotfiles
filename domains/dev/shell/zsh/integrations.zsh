# Tool Integrations

# Zoxide (Smart Directory Jumper)
if command -v zoxide &>/dev/null; then
  export _ZO_EXCLUDE_DIRS="$HOME/.Trash:$HOME/Library:$HOME/.cache:$HOME/.aws:*/.git:*/node_modules:*/vendor:*/.venv"
  eval "$(zoxide init zsh)"
fi

# Starship (Prompt)
if command -v starship &>/dev/null; then
  if [[ -z "${STARSHIP_CONFIG:-}" ]]; then
    starship_config_path="${DOTFILES_ROOT:-${HOME}}/domains/dev/config/starship/starship.toml"
    if [[ -f "$starship_config_path" ]]; then
      export STARSHIP_CONFIG="$starship_config_path"
    fi
    unset starship_config_path
  fi
  eval "$(starship init zsh)"
fi

# Mise (Version Manager)
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
fi
