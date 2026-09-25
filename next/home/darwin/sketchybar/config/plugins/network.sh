#!/bin/bash

# Network plugin for Sketchybar
# Shows LAN IP address

# Use argument or default
ITEM_NAME="${1:-widgets.network_ip}"

# Get LAN IP
get_lan_ip() {
    if [[ "$(uname)" == "Darwin" ]]; then
        ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1
    else
        ip addr show | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -n 1
    fi
}

LAN_IP=$(get_lan_ip)

if [[ -z "$LAN_IP" ]]; then
    LAN_IP="N/A"
fi

sketchybar --set "$ITEM_NAME" label="$LAN_IP"

