# Cursor shell integration
if [[ "$TERM_PROGRAM" == "cursor" ]]; then
  if command -v cursor &>/dev/null; then
    . "$(cursor --locate-shell-integration-path zsh)" 2>/dev/null || true
  fi
fi# Kiro shell integration
if [[ "$TERM_PROGRAM" == "kiro" ]]; then
  if command -v kiro &>/dev/null; then
    . "$(kiro --locate-shell-integration-path zsh)" 2>/dev/null || true
  fi
fi# VSCode shell integration
if [[ "$TERM_PROGRAM" == "vscode" ]]; then
  if command -v code &>/dev/null; then
    . "$(code --locate-shell-integration-path zsh)" 2>/dev/null || true
  fi
fi# Warp Terminal specific configurations

if [[ "$TERM_PROGRAM" == "WarpTerminal" ]]; then
  # Warpは独自の補完UIとキーバインディングを持っているため、
  # 特別な設定は基本的に不要
  
  # Warpの内部関数との競合を避けるためのフラグ
  export WARP_TERMINAL_COMPAT=1
fi