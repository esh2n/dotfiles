#!/usr/bin/env bash

# Key bindings help script for tmux status bar
# Shows essential tmux commands for beginners

# Show all essential commands in compact format
get_all_keybinds() {
    echo "c:new \":%:split hjkl:nav z:zoom s:♪ p:▶ ]:⏭ ?:help [:copy d:detach"
}

# Show compact key help with better formatting
get_compact_help() {
    local help_items=(
        "⌨️ new:c"
        "⌨️ split:\"|%"
        "⌨️ nav:hjkl"
        "⌨️ zoom:z"
        "⌨️ help:?"
        "⌨️ copy:["
        "⌨️ kill:x"
        "⌨️ detach:d"
    )

    local seconds=$(date +%S)
    local interval=$((seconds / 10))
    local index=$((interval % ${#help_items[@]}))

    echo "${help_items[$index]}"
}

# Show ultra compact version for space-constrained layouts
get_mini_help() {
    local mini_items=(
        "c:new"
        "\":split"
        "hjkl:nav"
        "z:zoom"
        "?:help"
    )

    local seconds=$(date +%S)
    local interval=$((seconds / 10))
    local index=$((interval % ${#mini_items[@]}))

    echo "${mini_items[$index]}"
}

case "${1:-all}" in
    "all") get_all_keybinds ;;
    "compact") get_compact_help ;;
    "mini") get_mini_help ;;
    *) get_all_keybinds ;;
esac