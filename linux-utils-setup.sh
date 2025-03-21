#!/bin/bash
# Linux and WSL Environment Utilities Setup Script
# Fixes common issues in Linux/WSL environments:
# - Locale settings
# - "open" command functionality
# - WSL-Windows integration

set -e

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check if we're running in WSL
is_wsl() {
  grep -qi microsoft /proc/version 2>/dev/null || grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null
}

# Check if a package is installed
is_installed() {
  dpkg -l "$1" &> /dev/null
}

# Function to detect package manager
get_pkg_manager() {
  if command -v apt-get &> /dev/null; then
    echo "apt"
  elif command -v dnf &> /dev/null; then
    echo "dnf"
  elif command -v yum &> /dev/null; then
    echo "yum"
  elif command -v pacman &> /dev/null; then
    echo "pacman"
  else
    echo "unknown"
  fi
}

# Header
echo -e "${BLUE}${BOLD}Linux/WSL Environment Utilities Setup${NC}"
echo -e "${BLUE}${BOLD}====================================${NC}\n"

# Detect environment
if is_wsl; then
  echo -e "${YELLOW}WSL environment detected${NC}"
  ENV_TYPE="WSL"
else
  echo -e "${YELLOW}Standard Linux environment detected${NC}"
  ENV_TYPE="Linux"
fi

# Detect package manager
PKG_MANAGER=$(get_pkg_manager)
echo -e "Package manager: ${YELLOW}${PKG_MANAGER}${NC}\n"

# Step 1: Fix locale settings
echo -e "${BLUE}${BOLD}Step 1: Fixing locale settings${NC}"

if [[ "$PKG_MANAGER" == "apt" ]]; then
  echo -e "Installing locales package..."
  sudo apt-get update
  sudo apt-get install -y locales

  # Generate and set locale
  echo -e "Generating en_US.UTF-8 locale..."
  sudo locale-gen en_US.UTF-8
  
  # Configure locale in environment files
  echo -e "Configuring locale environment settings..."
  
  # Update /etc/environment if it doesn't already have the locale settings
  if ! grep -q "LANG=en_US.UTF-8" /etc/environment; then
    echo 'LANG=en_US.UTF-8' | sudo tee -a /etc/environment > /dev/null
  fi
  
  if ! grep -q "LC_ALL=en_US.UTF-8" /etc/environment; then
    echo 'LC_ALL=en_US.UTF-8' | sudo tee -a /etc/environment > /dev/null
  fi
  
  # Update /etc/default/locale
  echo -e "LANG=en_US.UTF-8\nLC_ALL=en_US.UTF-8" | sudo tee /etc/default/locale > /dev/null
  
  # Export for current session
  export LANG=en_US.UTF-8
  export LC_ALL=en_US.UTF-8
  
  echo -e "${GREEN}✓ Locale setup completed${NC}\n"
elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
  echo -e "Setting up locales for Fedora/RHEL-based system..."
  sudo $PKG_MANAGER install -y glibc-langpack-en
  
  # Configure locale in environment files
  echo -e "Configuring locale environment settings..."
  echo 'LANG=en_US.UTF-8' | sudo tee -a /etc/environment > /dev/null
  echo 'LC_ALL=en_US.UTF-8' | sudo tee -a /etc/environment > /dev/null
  
  # Export for current session
  export LANG=en_US.UTF-8
  export LC_ALL=en_US.UTF-8
  
  echo -e "${GREEN}✓ Locale setup completed${NC}\n"
elif [[ "$PKG_MANAGER" == "pacman" ]]; then
  echo -e "Setting up locales for Arch-based system..."
  sudo $PKG_MANAGER -Sy --noconfirm glibc
  
  # Uncomment en_US.UTF-8 in /etc/locale.gen
  sudo sed -i 's/#en_US.UTF-8/en_US.UTF-8/g' /etc/locale.gen
  
  # Generate locales
  sudo locale-gen
  
  # Set LANG in locale.conf
  echo 'LANG=en_US.UTF-8' | sudo tee /etc/locale.conf > /dev/null
  
  # Export for current session
  export LANG=en_US.UTF-8
  export LC_ALL=en_US.UTF-8
  
  echo -e "${GREEN}✓ Locale setup completed${NC}\n"
else
  echo -e "${YELLOW}⚠️ Unsupported package manager. Skipping automatic locale setup.${NC}"
  echo -e "${YELLOW}Please set up en_US.UTF-8 locale manually for your distribution.${NC}\n"
fi

# Step 2: Install WSL utilities if in WSL environment
if [[ "$ENV_TYPE" == "WSL" ]]; then
  echo -e "${BLUE}${BOLD}Step 2: Installing WSL integration utilities${NC}"
  
  if [[ "$PKG_MANAGER" == "apt" ]]; then
    # Install wslu (Windows Subsystem for Linux Utilities) if not installed
    if ! is_installed wslu; then
      echo -e "Installing wslu (WSL utilities)..."
      sudo apt-get update
      sudo apt-get install -y wslu
      echo -e "${GREEN}✓ wslu installed${NC}"
    else
      echo -e "${GREEN}✓ wslu already installed${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️ Automatic wslu installation is only supported for apt-based distributions.${NC}"
    echo -e "${YELLOW}Please install WSL utilities manually for your distribution.${NC}"
  fi
  echo -e ""
fi

# Step 3: Install xdg-utils and desktop-file-utils (needed for 'open' command)
echo -e "${BLUE}${BOLD}Step 3: Installing utilities for 'open' command${NC}"

if [[ "$PKG_MANAGER" == "apt" ]]; then
  # Install required utilities
  echo -e "Installing xdg-utils and desktop-file-utils..."
  sudo apt-get update
  sudo apt-get install -y xdg-utils desktop-file-utils
  echo -e "${GREEN}✓ Utilities installed${NC}\n"
  
elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
  echo -e "Installing xdg-utils and desktop-file-utils..."
  sudo $PKG_MANAGER install -y xdg-utils desktop-file-utils
  echo -e "${GREEN}✓ Utilities installed${NC}\n"
  
elif [[ "$PKG_MANAGER" == "pacman" ]]; then
  echo -e "Installing xdg-utils and desktop-file-utils..."
  sudo $PKG_MANAGER -Sy --noconfirm xdg-utils desktop-file-utils
  echo -e "${GREEN}✓ Utilities installed${NC}\n"
  
else
  echo -e "${YELLOW}⚠️ Unsupported package manager. Skipping utility installation.${NC}"
  echo -e "${YELLOW}Please install xdg-utils and desktop-file-utils manually.${NC}\n"
fi

# Step 4: Install file browser on Linux if needed (not in WSL)
if [[ "$ENV_TYPE" == "Linux" && "$PKG_MANAGER" != "unknown" ]]; then
  echo -e "${BLUE}${BOLD}Step 4: Checking for file browser${NC}"
  
  # Check if any common file browsers are installed
  file_browser_installed=false
  for browser in nautilus thunar dolphin pcmanfm caja nemo; do
    if command -v $browser &> /dev/null; then
      file_browser_installed=true
      echo -e "${GREEN}✓ File browser found: $browser${NC}"
      break
    fi
  done
  
  # Install a file browser if none is found
  if [[ "$file_browser_installed" == "false" ]]; then
    echo -e "${YELLOW}No file browser found. Installing a lightweight file browser...${NC}"
    
    if [[ "$PKG_MANAGER" == "apt" ]]; then
      sudo apt-get update
      sudo apt-get install -y pcmanfm
      echo -e "${GREEN}✓ PCManFM installed${NC}"
    elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
      sudo $PKG_MANAGER install -y pcmanfm
      echo -e "${GREEN}✓ PCManFM installed${NC}"
    elif [[ "$PKG_MANAGER" == "pacman" ]]; then
      sudo $PKG_MANAGER -Sy --noconfirm pcmanfm
      echo -e "${GREEN}✓ PCManFM installed${NC}"
    fi
  fi
  echo -e ""
fi

# Step 5: Update desktop database
echo -e "${BLUE}${BOLD}Step 5: Updating desktop database${NC}"
if command -v update-desktop-database &> /dev/null; then
  sudo update-desktop-database
  echo -e "${GREEN}✓ Desktop database updated${NC}\n"
else
  echo -e "${YELLOW}⚠️ update-desktop-database command not found. Skipping this step.${NC}\n"
fi

# Final steps and recommendations
echo -e "${GREEN}${BOLD}Setup completed!${NC}"
echo -e "${YELLOW}To apply all changes, you should:${NC}"

if [[ "$ENV_TYPE" == "WSL" ]]; then
  echo -e " 1. Close this terminal window"
  echo -e " 2. From PowerShell, run: ${BOLD}wsl --shutdown${NC}"
  echo -e " 3. Start WSL again"
else
  echo -e " 1. Log out and log back in"
  echo -e " - or -"
  echo -e " 1. Restart your shell with: ${BOLD}exec \$SHELL -l${NC}"
fi

echo -e "\n${BLUE}${BOLD}Testing the 'open' command${NC}"
echo -e "After restarting your shell, you can test the 'open' command with:"
echo -e "${BOLD}./test-open-command.sh${NC}"
echo -e ""