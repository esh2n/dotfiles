# Workspace set control — thin wrappers over mado (kept for muscle memory)
alias wsls='mado status'
alias wsstart='mado use'    # re-applies current profile (default: loop)
alias wsrestart='mado use'  # idempotent: converges to the declared state
alias wsstop='mado stop'

# Toggle Zen Mode (Hide UI elements)
function toggle_zen_mode() {
  if pgrep -x "sketchybar" >/dev/null; then
    run_with_spinner "Stopping Sketchybar" brew services stop sketchybar
    run_with_spinner "Stopping Borders" brew services stop borders
    log_info "🧘 Zen Mode: ON"
  else
    run_with_spinner "Starting Sketchybar" brew services start sketchybar
    run_with_spinner "Starting Borders" brew services start borders
    log_info "🖥️ Zen Mode: OFF"
  fi
}
alias zen='toggle_zen_mode'
