#!/usr/bin/env bash
# Generate a horizontal border line for tmux status bar
# Usage: status-border.sh top|bottom [color]
set -euo pipefail
type="${1:-top}"
width=$(tmux display-message -p '#{client_width}')
inner=$((width - 2))
line=""
for ((i=0; i<inner; i++)); do line+="─"; done
if [[ "$type" == "top" ]]; then
    echo "╭${line}╮"
else
    echo "╰${line}╯"
fi
