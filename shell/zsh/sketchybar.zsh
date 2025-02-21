# sketchybar initialization and aliases
if [[ $(command -v sketchybar) ]]; then
    # Screen recording permission check
    if ! tccutil query ScreenCapture com.felixkratz.sketchybar >/dev/null 2>&1; then
        echo "Warning: sketchybar needs screen recording permission"
        echo "Please enable it in System Settings > Privacy & Security > Screen Recording"
    fi

    # Aliases for sketchybar management
    alias sbr='brew services restart sketchybar'
    alias sbs='brew services start sketchybar'
    alias sbk='brew services stop sketchybar'
fi 