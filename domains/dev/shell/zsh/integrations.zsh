# Tool Integrations
# Init scripts are static per tool version, so source them via cached_eval
# (loader.sh) instead of spawning each binary on every shell (~15-25ms each).

# Zoxide (Smart Directory Jumper)
if command -v zoxide &>/dev/null; then
  export _ZO_EXCLUDE_DIRS="$HOME/.Trash:$HOME/Library:$HOME/.cache:$HOME/.aws:*/.git:*/node_modules:*/vendor:*/.venv"
  cached_eval zoxide-init zoxide init zsh
fi

# Prompt: starship. capsule stays installed (daemon + ~/.config/capsule) —
# to try it again, swap this branch order back to capsule-first.
if command -v starship &>/dev/null; then
  # Use generated config from dotfiles (via symlink)
  export STARSHIP_CONFIG="${HOME}/.config/starship/starship.toml"
  cached_eval starship-init starship init zsh
elif command -v capsule &>/dev/null; then
  eval "$(capsule init zsh)"
fi

# Mise (Version Manager)
# NOT cacheable: `mise activate` embeds a snapshot of the generation-time
# PATH (`export PATH='...'`) in its output, so sourcing a cache would roll
# PATH back to whatever it was when the cache was written.
if command -v mise &>/dev/null; then
  eval "$(mise activate zsh)"
fi

# Direnv (Environment Switcher)
if command -v direnv &>/dev/null; then
  cached_eval direnv-hook direnv hook zsh
fi

# Claude Code
export ENABLE_TOOL_SEARCH=true
