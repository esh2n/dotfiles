#!/usr/bin/env bash

# Weather information script for tmux status bar
# OpenWeatherMap API integration

CACHE_FILE="/tmp/tmux_weather_cache"
CACHE_DURATION=1800  # 30 minutes
CITY="Tokyo"
UNITS="metric"

# Find .env file
find_env_file() {
    # Priority 1: DOTFILES_ROOT environment variable
    if [[ -n "${DOTFILES_ROOT:-}" && -f "${DOTFILES_ROOT}/.env" ]]; then
        echo "${DOTFILES_ROOT}/.env"
        return
    fi

    # Priority 2: Current script's parent directories
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local dotfiles_root

    # Walk up from tmux config directory to find dotfiles root
    dotfiles_root="$(cd "${script_dir}/../../.." && pwd)"
    if [[ -f "${dotfiles_root}/.env" ]]; then
        echo "${dotfiles_root}/.env"
        return
    fi

    # Priority 3: ghq path fallback - find any dotfiles repo
    if command -v ghq >/dev/null 2>&1; then
        local ghq_root="$(ghq root 2>/dev/null)"
        if [[ -n "$ghq_root" ]]; then
            # Look for any dotfiles repo in github.com
            local env_file=$(find "${ghq_root}/github.com" -name dotfiles -type d -exec test -f {}/.env \; -print -quit 2>/dev/null)
            if [[ -n "$env_file" && -f "${env_file}/.env" ]]; then
                echo "${env_file}/.env"
                return
            fi
        fi
    fi

    echo ""
}

# Load API key
ENV_FILE="$(find_env_file)"
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE"
fi

API_KEY="${OPENWEATHER_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
    echo "N/A"
    exit 1
fi

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

# Fetch weather data
fetch_weather() {
    local url="http://api.openweathermap.org/data/2.5/weather?q=${CITY}&appid=${API_KEY}&units=${UNITS}"
    curl -s "$url" > "$CACHE_FILE" 2>/dev/null
}

# Analyze pressure for weather patterns
analyze_pressure() {
    local pressure="$1"
    if [[ "$pressure" == "N/A" ]]; then
        echo "N/A"
        return
    fi

    local press_num=$(echo "$pressure" | tr -d 'hPa')
    # 標準気圧: 1013.25hPa基準
    # 1020hPa以上: 高気圧 (標準)
    # 995hPa未満: 低気圧 (注意)
    # 980hPa未満: 爆弾低気圧 (爆弾)
    if [[ "$press_num" -lt 980 ]]; then
        echo "爆弾"
    elif [[ "$press_num" -lt 995 ]]; then
        echo "注意"
    else
        echo "標準"
    fi
}

# Get full pressure info with status
get_pressure_full() {
    local pressure=$(get_weather_info "pressure")
    local status=$(analyze_pressure "$pressure")
    echo "${pressure}(${status})"
}

# Get weather icon based on condition
get_weather_icon() {
    case "$1" in
        "Clear") echo "☀️" ;;
        "Clouds") echo "☁️" ;;
        "Rain") echo "🌧️" ;;
        "Snow") echo "❄️" ;;
        "Thunderstorm") echo "⛈️" ;;
        "Drizzle") echo "🌦️" ;;
        "Mist"|"Fog") echo "🌫️" ;;
        *) echo "🌤️" ;;
    esac
}

# Get weather info
get_weather_info() {
    if ! is_cache_valid; then
        fetch_weather
    fi

    if [[ -f "$CACHE_FILE" ]]; then
        local data=$(cat "$CACHE_FILE")
        local temp=$(echo "$data" | jq -r '.main.temp // "N/A"' 2>/dev/null)
        local feels_like=$(echo "$data" | jq -r '.main.feels_like // "N/A"' 2>/dev/null)
        local pressure=$(echo "$data" | jq -r '.main.pressure // "N/A"' 2>/dev/null)
        local humidity=$(echo "$data" | jq -r '.main.humidity // "N/A"' 2>/dev/null)
        local sunrise=$(echo "$data" | jq -r '.sys.sunrise // "N/A"' 2>/dev/null)
        local condition=$(echo "$data" | jq -r '.weather[0].main // "N/A"' 2>/dev/null)
        local icon=$(get_weather_icon "$condition")
        local pressure_trend=$(analyze_pressure "${pressure}hPa")

        # Get precipitation probability (rain.1h or rain.3h)
        local rain_1h=$(echo "$data" | jq -r '.rain."1h" // 0' 2>/dev/null)
        local rain_3h=$(echo "$data" | jq -r '.rain."3h" // 0' 2>/dev/null)
        local precipitation="0%"

        # Simple precipitation probability estimation
        if [[ "$rain_1h" != "0" ]] && [[ "$rain_1h" != "null" ]]; then
            precipitation="90%"
        elif [[ "$rain_3h" != "0" ]] && [[ "$rain_3h" != "null" ]]; then
            precipitation="60%"
        elif [[ "$condition" == "Rain" ]]; then
            precipitation="80%"
        elif [[ "$condition" == "Drizzle" ]]; then
            precipitation="40%"
        elif [[ "$condition" == "Clouds" ]]; then
            precipitation="20%"
        fi

        # Convert sunrise to local time
        if [[ "$sunrise" != "N/A" ]]; then
            sunrise=$(date -r "$sunrise" "+%H:%M" 2>/dev/null || echo "N/A")
        fi

        # Format temperatures
        if [[ "$temp" != "N/A" ]]; then
            temp=$(printf "%.0f°" "$temp")
        fi
        if [[ "$feels_like" != "N/A" ]]; then
            feels_like=$(printf "%.0f°" "$feels_like")
        fi

        case "$1" in
            "temperature") echo "$temp" ;;
            "feels_like") echo "$feels_like" ;;
            "pressure") echo "${pressure}hPa" ;;
            "pressure_full") get_pressure_full ;;
            "pressure_trend") echo "$pressure_trend" ;;
            "precipitation"|"rain") echo "$precipitation" ;;
            "humidity") echo "${humidity}%" ;;
            "sunrise") echo "🌅$sunrise" ;;
            "condition") echo "$condition" ;;
            "icon") echo "$icon" ;;
            "full") echo "$icon $temp($feels_like)" ;;
            *) echo "$temp" ;;
        esac
    else
        echo "N/A"
    fi
}

# Main
case "${1:-temperature}" in
    "temperature"|"temp") get_weather_info "temperature" ;;
    "feels_like"|"feels") get_weather_info "feels_like" ;;
    "pressure") get_weather_info "pressure" ;;
    "pressure_full") get_weather_info "pressure_full" ;;
    "pressure_trend"|"trend") get_weather_info "pressure_trend" ;;
    "precipitation"|"rain") get_weather_info "precipitation" ;;
    "humidity") get_weather_info "humidity" ;;
    "sunrise") get_weather_info "sunrise" ;;
    "condition") get_weather_info "condition" ;;
    "icon") get_weather_info "icon" ;;
    "full") get_weather_info "full" ;;
    *) get_weather_info "temperature" ;;
esac