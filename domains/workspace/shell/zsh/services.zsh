#!/usr/bin/env zsh

# Window management services aliases
# Profile switching (WM + bar + borders as a set) is handled by `mado`.

# Borders management
alias brdr='brew services restart borders'
alias brds='brew services start borders'
alias brdk='brew services stop borders'

# Sketchybar management (already in sketchybar.zsh)
# alias sbr='brew services restart sketchybar'
# alias sbs='brew services start sketchybar'
# alias sbk='brew services stop sketchybar'

# Workspace set control — thin wrappers over mado (kept for muscle memory)
alias wsls='mado status'
alias wsstart='mado use'    # re-applies current profile (default: paneru)
alias wsrestart='mado use'  # idempotent: converges to the declared state
alias wsstop='mado stop'
