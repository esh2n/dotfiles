#!/bin/bash
# WSL Utilities Setup Script
# This script fixes locale issues and installs necessary utilities
# for better WSL integration, particularly for the 'open' command

set -e

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check if running in WSL
if ! grep -q Microsoft /proc/version 2>/dev/null; then
    echo -e "${RED}${BOLD}Error:${NC} This script is intended for WSL environments only."
    exit 1
fi

echo -e "${BLUE}${BOLD}WSL Utilities Setup${NC}"
echo -e "${BLUE}${BOLD}===================${NC}\n"

echo -e "${YELLOW}This script will:${NC}"
echo -e "  1. Fix locale settings (en_US.UTF-8)"
echo -e "  2. Install WSL utilities (wslu)"
echo -e "  3. Install xdg-utils and desktop-file-utils"
echo -e "  4. Update desktop database\n"

read -p "Do you want to continue? [Y/n] " response
response=${response:-Y} # Default to Y if no input
if [[ ! "$response" =~ ^[Yy]$ ]]; then
    echo -e "\n${YELLOW}Setup cancelled.${NC}"
    exit 0
fi

# Update package lists
echo -e "\n${BLUE}${BOLD}Updating package lists...${NC}"
sudo apt update

# Fix locale settings
echo -e "\n${BLUE}${BOLD}Configuring locale...${NC}"

# Install locales package
echo -e "${GREEN}Installing locales package...${NC}"
sudo apt install -y locales

# Uncomment en_US.UTF-8 locale in /etc/locale.gen
echo -e "${GREEN}Configuring en_US.UTF-8 locale...${NC}"
sudo sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen

# Generate the locale
echo -e "${GREEN}Generating locale...${NC}"
sudo locale-gen en_US.UTF-8

# Set system-wide locale
echo -e "${GREEN}Setting system-wide locale...${NC}"
sudo update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# Install WSL utilities
echo -e "\n${BLUE}${BOLD}Installing WSL utilities...${NC}"
echo -e "${GREEN}Installing wslu package...${NC}"
sudo apt install -y wslu

# Install xdg-utils
echo -e "\n${BLUE}${BOLD}Installing utilities for the 'open' command...${NC}"
echo -e "${GREEN}Installing xdg-utils and desktop-file-utils...${NC}"
sudo apt install -y xdg-utils desktop-file-utils

# Update desktop database
echo -e "${GREEN}Updating desktop database...${NC}"
sudo update-desktop-database

# Add locale settings to shell config files if they don't exist
echo -e "\n${BLUE}${BOLD}Updating shell configuration...${NC}"
for rcfile in ~/.bashrc ~/.zshrc; do
    if [ -f "$rcfile" ]; then
        if ! grep -q "export LANG=en_US.UTF-8" "$rcfile"; then
            echo -e "${GREEN}Adding locale settings to ${rcfile}...${NC}"
            echo "" >> "$rcfile"
            echo "# Locale settings for WSL" >> "$rcfile"
            echo "export LANG=en_US.UTF-8" >> "$rcfile"
            echo "export LC_ALL=en_US.UTF-8" >> "$rcfile"
        else
            echo -e "${GREEN}Locale settings already exist in ${rcfile}${NC}"
        fi
    fi
done

# Add locale settings to Fish shell if it exists
if [ -d ~/.config/fish ]; then
    fishconfig=~/.config/fish/conf.d/wsl-locale.fish
    if [ ! -f "$fishconfig" ] || ! grep -q "set -x LANG en_US.UTF-8" "$fishconfig"; then
        echo -e "${GREEN}Adding locale settings for Fish shell...${NC}"
        mkdir -p ~/.config/fish/conf.d
        echo "# Locale settings for WSL" > "$fishconfig"
        echo "set -x LANG en_US.UTF-8" >> "$fishconfig"
        echo "set -x LC_ALL en_US.UTF-8" >> "$fishconfig"
    else
        echo -e "${GREEN}Locale settings already exist for Fish shell${NC}"
    fi
fi

echo -e "\n${BLUE}${BOLD}WSL Utilities Setup Complete!${NC}"
echo -e "${YELLOW}${BOLD}Next Steps:${NC}"
echo -e "  1. Restart your WSL session for locale changes to take effect:"
echo -e "     ${BOLD}wsl --shutdown${NC} (from PowerShell), then reopen WSL"
echo -e "  2. Try the 'open' command with a directory: ${BOLD}open .${NC}"
echo -e "  3. If directory browsing still fails, install a file manager on the Windows side"
echo -e "     (like Explorer or Files app)\n"