#!/bin/bash

# Weather plugin for Sketchybar
# Uses OpenWeatherMap API

ITEM_NAME="${1:-widgets.weather}"
CITY_ID="1850147"  # Tokyo

# Resolve script's real directory through symlinks
# (~/.config/sketchybar -> dotfiles/domains/workspace/config/sketchybar)
resolve_script_dir() {
    local src="${BASH_SOURCE[0]}"
    while [[ -h "$src" ]]; do
        local target
        target="$(readlink "$src")"
        if [[ "$target" = /* ]]; then
            src="$target"
        else
            src="$(cd "$(dirname "$src")" && pwd)/$target"
        fi
    done
    # -P resolves any remaining symlinks in the directory portion
    # (~/.config/sketchybar -> dotfiles/...), so the relative walk below lands
    # at the actual repo root rather than $HOME.
    cd "$(dirname "$src")" && pwd -P
}

# Walk up from .../domains/workspace/config/sketchybar/plugins to dotfiles root
SCRIPT_DIR="$(resolve_script_dir)"
SCRIPT_DOTFILES_ROOT="$(cd "$SCRIPT_DIR/../../../../.." 2>/dev/null && pwd -P)"

# Get API key from environment or .env file
get_api_key() {
    if [[ -n "$OPENWEATHER_API_KEY" ]]; then
        echo "$OPENWEATHER_API_KEY"
        return
    fi

    # Try to find .env file (script-relative path covers any clone location)
    local env_files=(
        "${DOTFILES_ROOT:+${DOTFILES_ROOT}/.env}"
        "${SCRIPT_DOTFILES_ROOT:+${SCRIPT_DOTFILES_ROOT}/.env}"
        "$HOME/dotfiles/.env"
        "$HOME/.env"
    )

    for env_file in "${env_files[@]}"; do
        if [[ -n "$env_file" && -f "$env_file" ]]; then
            local key=$(grep "^OPENWEATHER_API_KEY=" "$env_file" | cut -d= -f2 | tr -d '"' | tr -d "'")
            if [[ -n "$key" ]]; then
                echo "$key"
                return
            fi
        fi
    done
}

API_KEY=$(get_api_key)

if [[ -z "$API_KEY" ]]; then
    sketchybar --set "$ITEM_NAME" label="API KEY"
    exit 0
fi

# Fetch weather data
WEATHER_JSON=$(curl -s --connect-timeout 3 --max-time 5 "http://api.openweathermap.org/data/2.5/weather?id=${CITY_ID}&appid=${API_KEY}&units=metric")

if [[ -z "$WEATHER_JSON" ]]; then
    sketchybar --set "$ITEM_NAME" label="N/A"
    exit 0
fi

# Parse JSON
TEMP=$(echo "$WEATHER_JSON" | jq -r '.main.temp // empty' 2>/dev/null)
CONDITION=$(echo "$WEATHER_JSON" | jq -r '.weather[0].main // empty' 2>/dev/null)
PRESSURE=$(echo "$WEATHER_JSON" | jq -r '.main.pressure // empty' 2>/dev/null)

if [[ -z "$TEMP" ]]; then
    sketchybar --set "$ITEM_NAME" label="N/A"
    exit 0
fi

# Weather icons
case "$CONDITION" in
    "Clear") ICON="☀" ;;
    "Clouds") ICON="☁" ;;
    "Rain") ICON="☂" ;;
    "Snow") ICON="❄" ;;
    "Thunderstorm") ICON="⚡" ;;
    "Drizzle") ICON="☔" ;;
    "Mist"|"Fog"|"Haze") ICON="≡" ;;
    *) ICON="○" ;;
esac

# Pressure state with icon
if [[ "$PRESSURE" -le 980 ]]; then
    PRESSURE_LABEL="⚠${PRESSURE}"
elif [[ "$PRESSURE" -le 1010 ]]; then
    PRESSURE_LABEL="↓${PRESSURE}"
elif [[ "$PRESSURE" -le 1020 ]]; then
    PRESSURE_LABEL="−${PRESSURE}"
else
    PRESSURE_LABEL="↑${PRESSURE}"
fi

# Fetch forecast for precipitation probability
FORECAST_JSON=$(curl -s --connect-timeout 3 --max-time 5 "http://api.openweathermap.org/data/2.5/forecast?id=${CITY_ID}&appid=${API_KEY}&units=metric&cnt=1")
POP=$(echo "$FORECAST_JSON" | jq -r '.list[0].pop // 0' 2>/dev/null)
POP_PCT=$(echo "$POP * 100" | bc 2>/dev/null | cut -d. -f1)
[[ -z "$POP_PCT" ]] && POP_PCT="0"

# Format: Temp PrecipProb Pressure
LABEL=$(printf "%.0f° ☔%s%% %s" "$TEMP" "$POP_PCT" "$PRESSURE_LABEL")

sketchybar --set "$ITEM_NAME" icon="$ICON" label="$LABEL"

