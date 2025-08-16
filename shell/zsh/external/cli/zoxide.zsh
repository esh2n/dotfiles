# Initialize zoxide
if command -v zoxide &>/dev/null; then
  if [ -z "$DISABLE_ZOXIDE" ] && [ -z "$CLAUDECODE" ]; then
    eval "$(zoxide init --cmd cd zsh)"
  fi
fi