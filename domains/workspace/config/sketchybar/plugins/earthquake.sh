#!/bin/bash

# Earthquake plugin for Sketchybar
# Uses P2P Earthquake API

ITEM_NAME="${1:-widgets.earthquake}"
EQ_API_URL="https://api.p2pquake.net/v2/history?codes=551&limit=1"

# Fetch earthquake data
EQ_JSON=$(curl -s "$EQ_API_URL")

if [[ -z "$EQ_JSON" ]] || [[ "$EQ_JSON" == "[]" ]]; then
    sketchybar --set "$ITEM_NAME" label="--"
    exit 0
fi

# Parse JSON
SCALE=$(echo "$EQ_JSON" | jq -r '.[0].earthquake.maxScale // -1' 2>/dev/null)
MAGNITUDE=$(echo "$EQ_JSON" | jq -r '.[0].earthquake.hypocenter.magnitude // 0' 2>/dev/null)
LOCATION=$(echo "$EQ_JSON" | jq -r '.[0].earthquake.hypocenter.name // "不明"' 2>/dev/null)
TIME=$(echo "$EQ_JSON" | jq -r '.[0].earthquake.time // ""' 2>/dev/null)

# Convert scale to Japanese notation
case "$SCALE" in
    10) SCALE_STR="1" ;;
    20) SCALE_STR="2" ;;
    30) SCALE_STR="3" ;;
    40) SCALE_STR="4" ;;
    45) SCALE_STR="5弱" ;;
    50) SCALE_STR="5強" ;;
    55) SCALE_STR="6弱" ;;
    60) SCALE_STR="6強" ;;
    70) SCALE_STR="7" ;;
    *) SCALE_STR="--" ;;
esac

# Check if earthquake is recent (within 24 hours)
if [[ -n "$TIME" ]]; then
    EQ_TIMESTAMP=$(date -j -f "%Y/%m/%d %H:%M:%S" "$TIME" "+%s" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    DIFF=$((NOW - EQ_TIMESTAMP))
    
    # If older than 24 hours, show minimal info
    if [[ $DIFF -gt 86400 ]]; then
        sketchybar --set "$ITEM_NAME" label="--"
        exit 0
    fi
fi

# Truncate location if too long
if [[ ${#LOCATION} -gt 6 ]]; then
    LOCATION="${LOCATION:0:6}"
fi

LABEL=$(printf "%s M%.1f %s" "$SCALE_STR" "$MAGNITUDE" "$LOCATION")

sketchybar --set "$ITEM_NAME" label="$LABEL"

