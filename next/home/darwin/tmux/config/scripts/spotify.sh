#!/usr/bin/env bash

# Interactive Spotify controller for tmux status bar
# Shows currently playing track with playback controls

# Handle commands
case "${1:-status}" in
    "play")
        if pgrep -x "Spotify" > /dev/null; then
            osascript -e 'tell application "Spotify" to play' 2>/dev/null
        fi
        exit 0
        ;;
    "pause")
        if pgrep -x "Spotify" > /dev/null; then
            osascript -e 'tell application "Spotify" to pause' 2>/dev/null
        fi
        exit 0
        ;;
    "toggle")
        if pgrep -x "Spotify" > /dev/null; then
            toggle_state=$(osascript -e 'tell application "Spotify" to return player state as string' 2>/dev/null)
            if [[ "$toggle_state" == "playing" ]]; then
                osascript -e 'tell application "Spotify" to pause' 2>/dev/null
            else
                osascript -e 'tell application "Spotify" to play' 2>/dev/null
            fi
        fi
        exit 0
        ;;
    "next")
        if pgrep -x "Spotify" > /dev/null; then
            osascript -e 'tell application "Spotify" to next track' 2>/dev/null
        fi
        exit 0
        ;;
    "prev")
        if pgrep -x "Spotify" > /dev/null; then
            osascript -e 'tell application "Spotify" to previous track' 2>/dev/null
        fi
        exit 0
        ;;
esac

# Check if Spotify is running
if ! pgrep -x "Spotify" > /dev/null; then
    echo "♪ --"
    exit 0
fi

# Get current track info and state using AppleScript on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Get player state
    state=$(osascript -e 'tell application "Spotify" to return player state as string' 2>/dev/null)

    if [[ "$state" == "playing" ]]; then
        # Get track info when playing
        track_info=$(osascript 2>/dev/null << 'EOF'
tell application "Spotify"
    set track_name to name of current track
    set artist_name to artist of current track
    return artist_name & " - " & track_name
end tell
EOF
        )
        if [[ -n "$track_info" && "$track_info" != "" ]]; then
            echo "#[fg=#a6e3a1]♪#[default] $(echo "$track_info" | cut -c1-35)"
        else
            echo "#[fg=#a6e3a1]♪#[default] Playing"
        fi
    elif [[ "$state" == "paused" ]]; then
        # Get track info when paused
        track_info=$(osascript 2>/dev/null << 'EOF'
tell application "Spotify"
    set track_name to name of current track
    set artist_name to artist of current track
    return artist_name & " - " & track_name
end tell
EOF
        )
        if [[ -n "$track_info" && "$track_info" != "" ]]; then
            echo "#[fg=#6c7086]♪#[default] $(echo "$track_info" | cut -c1-35) #[dim](paused)#[default]"
        else
            echo "#[fg=#6c7086]♪#[default] Paused"
        fi
    else
        echo "#[fg=#6c7086]♪#[default] Stopped"
    fi
else
    # Linux/other systems - use dbus
    if command -v playerctl >/dev/null 2>&1; then
        if playerctl status 2>/dev/null | grep -q "Playing"; then
            artist=$(playerctl metadata artist 2>/dev/null)
            title=$(playerctl metadata title 2>/dev/null)
            if [[ -n "$artist" && -n "$title" ]]; then
                echo "⏮ ⏯ ⏭ $artist - $title" | cut -c1-50
            else
                echo "⏮ ⏯ ⏭ Stopped"
            fi
        else
            echo "⏮ ⏯ ⏭ Stopped"
        fi
    else
        echo "⏮ ⏯ ⏭ --"
    fi
fi