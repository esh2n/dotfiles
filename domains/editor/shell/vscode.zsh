# VSCode shell integration
if [[ "$TERM_PROGRAM" == "vscode" ]]; then
  if command -v code &>/dev/null; then
    . "$(code --locate-shell-integration-path zsh)" 2>/dev/null || true
  fi
fi