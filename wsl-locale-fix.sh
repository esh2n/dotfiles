#!/bin/bash
# WSL Locale Fix Script
# This script fixes the "warning: setlocale: LC_ALL: cannot change locale (en_US.UTF-8)" error in WSL

set -e

echo "WSL Locale Fix - Fixing en_US.UTF-8 locale"
echo "----------------------------------------"

# Check if running in WSL
if ! grep -q Microsoft /proc/version 2>/dev/null; then
    echo "Error: This script is intended for WSL environments only."
    exit 1
fi

# Install locales package if not already installed
if ! dpkg -l | grep -q "^ii.*locales"; then
    echo "Installing locales package..."
    sudo apt update
    sudo apt install -y locales
fi

# Uncomment en_US.UTF-8 locale in /etc/locale.gen
echo "Configuring en_US.UTF-8 locale..."
sudo sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen

# Generate the locale
echo "Generating locale..."
sudo locale-gen en_US.UTF-8

# Set system-wide locale
echo "Setting system-wide locale..."
sudo update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# Add locale settings to shell config files
for rcfile in ~/.bashrc ~/.zshrc; do
    if [ -f "$rcfile" ]; then
        if ! grep -q "export LANG=en_US.UTF-8" "$rcfile"; then
            echo "Adding locale settings to $rcfile..."
            echo "" >> "$rcfile"
            echo "# Locale settings for WSL" >> "$rcfile"
            echo "export LANG=en_US.UTF-8" >> "$rcfile"
            echo "export LC_ALL=en_US.UTF-8" >> "$rcfile"
        fi
    fi
done

echo ""
echo "Locale configuration complete."
echo "You need to restart your WSL session for changes to take effect."
echo "You can do this by closing your terminal and reopening it,"
echo "or by running 'wsl --shutdown' from PowerShell and then reopening WSL."