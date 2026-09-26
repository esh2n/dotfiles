#!/usr/bin/env bash

# Earthquake information script for tmux status bar
# Uses P2P地震情報 API (like WezTerm)

CACHE_FILE="/tmp/tmux_earthquake_cache"
CACHE_DURATION=300  # 5 minutes
EQ_API_URL="https://api.p2pquake.net/v2/history?codes=551&limit=1"

# Check if cache is valid
is_cache_valid() {
    if [[ -f "$CACHE_FILE" ]]; then
        local cache_time=$(stat -f "%m" "$CACHE_FILE" 2>/dev/null || stat -c "%Y" "$CACHE_FILE" 2>/dev/null)
        local current_time=$(date +%s)
        local age=$((current_time - cache_time))
        [[ $age -lt $CACHE_DURATION ]]
    else
        return 1
    fi
}

# Fetch earthquake data
fetch_earthquake() {
    curl -s "$EQ_API_URL" > "$CACHE_FILE" 2>/dev/null
}

# Convert scale to Japanese notation
convert_scale() {
    local scale="$1"
    case "$scale" in
        "-1") echo "不明" ;;
        "10") echo "1" ;;
        "20") echo "2" ;;
        "30") echo "3" ;;
        "40") echo "4" ;;
        "45") echo "5弱" ;;
        "50") echo "5強" ;;
        "55") echo "6弱" ;;
        "60") echo "6強" ;;
        "70") echo "7" ;;
        *) echo "$scale" ;;
    esac
}

# Get earthquake info
get_earthquake_info() {
    if ! is_cache_valid; then
        fetch_earthquake
    fi

    if [[ -f "$CACHE_FILE" ]]; then
        local data=$(cat "$CACHE_FILE")

        # Parse JSON using jq if available
        if command -v jq >/dev/null 2>&1; then
            local scale=$(echo "$data" | jq -r '.[0].earthquake.maxScale // -999' 2>/dev/null)
            local magnitude=$(echo "$data" | jq -r '.[0].earthquake.hypocenter.magnitude // 0' 2>/dev/null)
            local location=$(echo "$data" | jq -r '.[0].earthquake.hypocenter.name // "不明"' 2>/dev/null)

            if [[ "$scale" != "-999" && "$scale" != "null" ]]; then
                local scale_str=$(convert_scale "$scale")
                # Check if earthquake is recent (within 24 hours)
                local time=$(echo "$data" | jq -r '.[0].time // ""' 2>/dev/null)
                if [[ -n "$time" ]]; then
                    printf "◈ 震度%s M%.1f %s" "$scale_str" "$magnitude" "$location"
                else
                    echo "◈ データなし"
                fi
            else
                echo "◈ データなし"
            fi
        else
            echo "◈ 要jq"
        fi
    else
        echo "◈ N/A"
    fi
}

case "${1:-status}" in
    "status"|*) get_earthquake_info ;;
esac