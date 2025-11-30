#!/bin/bash

# Weather plugin for Sketchybar
# Uses OpenWeatherMap API

ITEM_NAME="${1:-widgets.weather}"
CITY_ID="1850147"  # Tokyo

# Get API key from environment or .env file
get_api_key() {
    if [[ -n "$OPENWEATHER_API_KEY" ]]; then
        echo "$OPENWEATHER_API_KEY"
        return
    fi
    
    # Try to find .env file
    local env_files=(
        "$DOTFILES_ROOT/.env"
        "$HOME/go/github.com/esh2n/dotfiles/.env"
        "$HOME/dotfiles/.env"
        "$HOME/.env"
    )
    
    for env_file in "${env_files[@]}"; do
        if [[ -f "$env_file" ]]; then
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
WEATHER_JSON=$(curl -s "http://api.openweathermap.org/data/2.5/weather?id=${CITY_ID}&appid=${API_KEY}&units=metric")

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
FORECAST_JSON=$(curl -s "http://api.openweathermap.org/data/2.5/forecast?id=${CITY_ID}&appid=${API_KEY}&units=metric&cnt=1")
POP=$(echo "$FORECAST_JSON" | jq -r '.list[0].pop // 0' 2>/dev/null)
POP_PCT=$(echo "$POP * 100" | bc 2>/dev/null | cut -d. -f1)
[[ -z "$POP_PCT" ]] && POP_PCT="0"

# Format: Temp PrecipProb Pressure
LABEL=$(printf "%.0f° ☔%s%% %s" "$TEMP" "$POP_PCT" "$PRESSURE_LABEL")

sketchybar --set "$ITEM_NAME" icon="$ICON" label="$LABEL"

