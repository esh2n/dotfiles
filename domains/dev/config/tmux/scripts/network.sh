#!/usr/bin/env bash

# Network information script for tmux status bar
# Shows network speed and connectivity status

# Get primary network interface
get_primary_interface() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        route get default 2>/dev/null | awk '/interface:/ { print $2 }' | head -1
    else
        # Linux
        ip route | awk '/default/ { print $5 }' | head -1
    fi
}

# Get IP address
get_ip_address() {
    local interface="${1:-$(get_primary_interface)}"

    if [[ -z "$interface" ]]; then
        echo "N/A"
        return
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        ifconfig "$interface" 2>/dev/null | awk '/inet / { print $2 }' | head -1
    else
        # Linux
        ip addr show "$interface" 2>/dev/null | awk '/inet / { gsub(/\/.*/, "", $2); print $2 }' | head -1
    fi
}

# Get network speed (simplified version)
get_network_speed() {
    local interface="${1:-$(get_primary_interface)}"

    if [[ -z "$interface" ]]; then
        echo "📡 N/A"
        return
    fi

    local ip=$(get_ip_address "$interface")
    local status=""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS - get basic network stats
        local stats=$(netstat -ib -I "$interface" 2>/dev/null | tail -1)
        if [[ -n "$stats" ]]; then
            status="Connected"
        else
            status="Disconnected"
        fi
    else
        # Linux
        if [[ -f "/sys/class/net/$interface/operstate" ]]; then
            local state=$(cat "/sys/class/net/$interface/operstate")
            if [[ "$state" == "up" ]]; then
                status="Connected"
            else
                status="Down"
            fi
        else
            status="N/A"
        fi
    fi

    if [[ -n "$ip" ]]; then
        echo "📡 $ip"
    else
        echo "📡 $status"
    fi
}

# Get WiFi signal strength (macOS)
get_wifi_signal() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        local rssi=$(airport -I 2>/dev/null | awk '/agrCtlRSSI/ { print $2 }')
        if [[ -n "$rssi" && "$rssi" != "" ]]; then
            if [[ "$rssi" -gt -50 ]]; then
                echo "📶 Excellent"
            elif [[ "$rssi" -gt -60 ]]; then
                echo "📶 Good"
            elif [[ "$rssi" -gt -70 ]]; then
                echo "📶 Fair"
            else
                echo "📶 Poor"
            fi
        else
            get_network_speed
        fi
    else
        get_network_speed
    fi
}

case "${1:-wifi}" in
    "speed") get_network_speed ;;
    "wifi"|*) get_wifi_signal ;;
esac