# Cursor shell integration
if [[ "$TERM_PROGRAM" == "cursor" ]]; then
  if command -v cursor &>/dev/null; then
    . "$(cursor --locate-shell-integration-path zsh)" 2>/dev/null || true
  fi
fi