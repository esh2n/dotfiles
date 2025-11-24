#!/usr/bin/env zsh

# Window management services aliases

# Borders management
alias brdr='brew services restart borders'
alias brds='brew services start borders'
alias brdk='brew services stop borders'

# Sketchybar management (already in sketchybar.zsh)
# alias sbr='brew services restart sketchybar'
# alias sbs='brew services start sketchybar'
# alias sbk='brew services stop sketchybar'

# Check all workspace services
alias wsls='brew services list | grep -E "sketchybar|borders" && echo "\nAeroSpace:" && pgrep -l AeroSpace'

# Restart all workspace services
wsrestart() {
    echo "Restarting workspace services..."
    brew services restart sketchybar
    brew services restart borders
    killall AeroSpace 2>/dev/null; open -a AeroSpace
    echo "All workspace services restarted!"
}

# Start all workspace services
wsstart() {
    echo "Starting workspace services..."
    brew services start sketchybar
    brew services start borders
    open -a AeroSpace
    echo "All workspace services started!"
}

# Stop all workspace services
wsstop() {
    echo "Stopping workspace services..."
    brew services stop sketchybar
    brew services stop borders
    killall AeroSpace 2>/dev/null
    echo "All workspace services stopped!"
}