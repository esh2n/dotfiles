# sketchybar initialization and aliases
if [[ $(command -v sketchybar) ]]; then
    # Skip permission check if SKETCHYBAR_SKIP_PERMISSION_CHECK is set
    if [[ -z "$SKETCHYBAR_SKIP_PERMISSION_CHECK" ]]; then
        # Check if sketchybar is running successfully instead of using tccutil
        if ! pgrep -q sketchybar; then
            # Only show warning if sketchybar is not running
            echo "Warning: sketchybar needs screen recording permission"
            echo "Please enable it in System Settings > Privacy & Security > Screen Recording"
            echo "If you've already granted permission, restart sketchybar with 'sbr'"
            echo "To suppress this message, add 'export SKETCHYBAR_SKIP_PERMISSION_CHECK=1' to your ~/.zshrc.local"
        fi
    fi

    # Aliases for sketchybar management
    alias sbr='brew services restart sketchybar'
    alias sbs='brew services start sketchybar'
    alias sbk='brew services stop sketchybar'
fi