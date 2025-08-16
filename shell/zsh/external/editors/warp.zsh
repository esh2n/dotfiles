# Warp Terminal specific configurations

if [[ "$TERM_PROGRAM" == "WarpTerminal" ]]; then
  # Warpは独自の補完UIとキーバインディングを持っているため、
  # 特別な設定は基本的に不要
  
  # Warpの内部関数との競合を避けるためのフラグ
  export WARP_TERMINAL_COMPAT=1
fi