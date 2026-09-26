# sketchybar initialization and aliases
if (( ${+commands[sketchybar]} )); then
    # Skip permission check if SKETCHYBAR_SKIP_PERMISSION_CHECK is set
    if [[ -z "$SKETCHYBAR_SKIP_PERMISSION_CHECK" ]]; then
        () {
            # pgrep costs ~30ms per shell; once sketchybar was seen running,
            # skip the check for 24h via a marker file (mh-24 = <24h old)
            local marker="${XDG_CACHE_HOME:-$HOME/.cache}/zsh/sketchybar-running"
            local -a fresh=( "$marker"(N.mh-24) )
            (( ${#fresh} )) && return

            local pgrep_cmd="/usr/bin/pgrep"
            if [[ ! -x "$pgrep_cmd" ]]; then
                pgrep_cmd=${commands[pgrep]:-}
            fi
            # Check if sketchybar is running successfully instead of using tccutil
            if [[ -n "$pgrep_cmd" ]]; then
                if "$pgrep_cmd" -q sketchybar 2>/dev/null; then
                    mkdir -p "${marker:h}" && touch "$marker"
                else
                    # Only show warning if sketchybar is not running
                    echo "Warning: sketchybar needs screen recording permission"
                    echo "Please enable it in System Settings > Privacy & Security > Screen Recording"
                    echo "If you've already granted permission, restart sketchybar with 'sbr'"
                    echo "To suppress this message, add 'export SKETCHYBAR_SKIP_PERMISSION_CHECK=1' to your ~/.zshrc.local"
                fi
            fi
        }
    fi

    # Aliases for sketchybar management
    alias sbr='brew services restart sketchybar'
    alias sbs='brew services start sketchybar'
    alias sbk='brew services stop sketchybar'
fi
