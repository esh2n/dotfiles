# Kiro shell integration
if [[ "$TERM_PROGRAM" == "kiro" ]]; then
  if command -v kiro &>/dev/null; then
    . "$(kiro --locate-shell-integration-path zsh)" 2>/dev/null || true
  fi
fi