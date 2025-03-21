#!/bin/bash
# Comprehensive Linux and WSL Environment Utilities Setup Script
# This unified script combines functionality from:
# - Basic utility setup
# - WSL-specific locale fixes
# - Enhanced application handling for the 'open' command

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
  if command -v dpkg &> /dev/null; then
    dpkg -l "$1" &> /dev/null
  elif command -v rpm &> /dev/null; then
    rpm -q "$1" &> /dev/null
  elif command -v pacman &> /dev/null; then
    pacman -Q "$1" &> /dev/null
  else
    command -v "$1" &> /dev/null
  fi
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

# Check if there's a desktop environment
has_desktop_environment() {
  [ -n "$DISPLAY" ] || [ -n "$WAYLAND_DISPLAY" ] || [ -n "$XDG_SESSION_TYPE" ]
}

# Install a package with the appropriate package manager
install_package() {
  local pkg="$1"
  
  echo -e "Installing ${YELLOW}$pkg${NC}..."
  
  case "$PKG_MANAGER" in
    apt)
      sudo apt-get update -qq
      sudo apt-get install -y "$pkg"
      ;;
    dnf)
      sudo dnf install -y "$pkg"
      ;;
    yum)
      sudo yum install -y "$pkg"
      ;;
    pacman)
      sudo pacman -Sy --noconfirm "$pkg"
      ;;
    *)
      echo -e "${RED}✗ Cannot install packages: Unsupported package manager${NC}"
      return 1
      ;;
  esac
  
  echo -e "${GREEN}✓ Installed $pkg${NC}"
}

# Header
echo -e "${BLUE}${BOLD}Comprehensive Linux/WSL Environment Setup${NC}"
echo -e "${BLUE}${BOLD}=======================================${NC}\n"

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

# Detect desktop environment
if has_desktop_environment; then
  echo -e "${GREEN}Desktop environment detected${NC}"
  HAS_DESKTOP="yes"
else
  echo -e "${YELLOW}No desktop environment detected${NC}"
  HAS_DESKTOP="no"
fi
echo -e ""

# Step 1: Fix locale settings
echo -e "${BLUE}${BOLD}Step 1: Fixing locale settings${NC}"

if [[ "$PKG_MANAGER" == "apt" ]]; then
  echo -e "Installing locales package..."
  sudo apt-get update -qq
  sudo apt-get install -y locales
  
  # Generate and set locale
  echo -e "Generating en_US.UTF-8 locale..."
  sudo sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen
  sudo locale-gen en_US.UTF-8
  sudo update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
  
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

# Add locale settings to shell config files
for rcfile in ~/.bashrc ~/.zshrc; do
  if [ -f "$rcfile" ]; then
    if ! grep -q "export LANG=en_US.UTF-8" "$rcfile"; then
      echo "Adding locale settings to $rcfile..."
      echo "" >> "$rcfile"
      echo "# Locale settings" >> "$rcfile"
      echo "export LANG=en_US.UTF-8" >> "$rcfile"
      echo "export LC_ALL=en_US.UTF-8" >> "$rcfile"
    fi
  fi
done

# Step 2: Install WSL utilities if in WSL environment
if [[ "$ENV_TYPE" == "WSL" ]]; then
  echo -e "${BLUE}${BOLD}Step 2: Installing WSL integration utilities${NC}"
  
  if [[ "$PKG_MANAGER" == "apt" ]]; then
    # Install wslu (Windows Subsystem for Linux Utilities) if not installed
    if ! is_installed wslu; then
      echo -e "Installing wslu (WSL utilities)..."
      sudo apt-get update -qq
      sudo apt-get install -y wslu
      echo -e "${GREEN}✓ wslu installed${NC}"
    else
      echo -e "${GREEN}✓ wslu already installed${NC}"
    fi
  elif [[ "$PKG_MANAGER" == "dnf" || "$PKG_MANAGER" == "yum" ]]; then
    # For Fedora/RHEL WSL
    echo -e "Installing wslu for Fedora/RHEL WSL..."
    if ! is_installed wslu; then
      sudo $PKG_MANAGER install -y wslu
      echo -e "${GREEN}✓ wslu installed${NC}"
    else
      echo -e "${GREEN}✓ wslu already installed${NC}"
    fi
  elif [[ "$PKG_MANAGER" == "pacman" ]]; then
    # For Arch WSL
    echo -e "Installing wslu for Arch WSL..."
    if ! is_installed wslu; then
      # May need AUR helper like yay
      if command -v yay &> /dev/null; then
        yay -S --noconfirm wslu
        echo -e "${GREEN}✓ wslu installed${NC}"
      else
        echo -e "${YELLOW}⚠️ Please install wslu manually using AUR${NC}"
      fi
    else
      echo -e "${GREEN}✓ wslu already installed${NC}"
    fi
  else
    echo -e "${YELLOW}⚠️ Automatic wslu installation is only supported for known distributions.${NC}"
    echo -e "${YELLOW}Please install WSL utilities manually for your distribution.${NC}"
  fi
  echo -e ""
fi

# Step 3: Install xdg-utils and desktop-file-utils (needed for 'open' command)
echo -e "${BLUE}${BOLD}Step 3: Installing utilities for 'open' command${NC}"

if [[ "$PKG_MANAGER" != "unknown" ]]; then
  # Install xdg-utils
  if ! is_installed xdg-utils; then
    install_package xdg-utils
  else
    echo -e "${GREEN}✓ xdg-utils already installed${NC}"
  fi
  
  # Install desktop-file-utils
  if ! is_installed desktop-file-utils; then
    install_package desktop-file-utils
  else
    echo -e "${GREEN}✓ desktop-file-utils already installed${NC}"
  fi
  
  echo -e ""
else
  echo -e "${YELLOW}⚠️ Unsupported package manager. Skipping utility installation.${NC}"
  echo -e "${YELLOW}Please install xdg-utils and desktop-file-utils manually.${NC}\n"
fi

# Step 4: Install a browser if needed
echo -e "${BLUE}${BOLD}Step 4: Checking for web browser${NC}"

# Check if any common browsers are installed
browser_installed=false
for browser in firefox chromium chromium-browser google-chrome brave-browser epiphany midori; do
  if command -v $browser &> /dev/null; then
    browser_installed=true
    echo -e "${GREEN}✓ Browser found: $browser${NC}"
    break
  fi
done

# Install a browser if none is found and we have a package manager and desktop
if [[ "$browser_installed" == "false" && "$PKG_MANAGER" != "unknown" && "$HAS_DESKTOP" == "yes" ]]; then
  echo -e "${YELLOW}No browser found. Installing a lightweight browser...${NC}"
  
  # Try to install a lightweight browser based on the package manager
  case "$PKG_MANAGER" in
    apt)
      if apt-cache search --names-only "^firefox$" | grep -q firefox; then
        install_package firefox
      elif apt-cache search --names-only "^firefox-esr$" | grep -q firefox-esr; then
        install_package firefox-esr
      else
        install_package epiphany-browser
      fi
      ;;
    dnf|yum)
      if dnf list firefox &>/dev/null; then
        install_package firefox
      else
        install_package epiphany
      fi
      ;;
    pacman)
      if pacman -Ss "^firefox$" | grep -q "^core/firefox"; then
        install_package firefox
      else
        install_package epiphany
      fi
      ;;
  esac
elif [[ "$HAS_DESKTOP" == "no" ]]; then
  echo -e "${YELLOW}No desktop environment detected. Installing text-based browser...${NC}"
  # Install a text-based browser for headless environments
  browser_installed=false
  for browser in w3m links lynx; do
    if command -v $browser &> /dev/null; then
      browser_installed=true
      echo -e "${GREEN}✓ Text browser found: $browser${NC}"
      break
    fi
  done
  
  if [[ "$browser_installed" == "false" && "$PKG_MANAGER" != "unknown" ]]; then
    install_package w3m
  fi
fi
echo -e ""

# Step 5: Install file browser on Linux if needed
if [[ "$ENV_TYPE" == "Linux" && "$PKG_MANAGER" != "unknown" && "$HAS_DESKTOP" == "yes" ]]; then
  echo -e "${BLUE}${BOLD}Step 5: Checking for file browser${NC}"
  
  # Check if any common file browsers are installed
  file_browser_installed=false
  for browser in nautilus thunar dolphin pcmanfm caja nemo xfe; do
    if command -v $browser &> /dev/null; then
      file_browser_installed=true
      echo -e "${GREEN}✓ File browser found: $browser${NC}"
      break
    fi
  done
  
  # Install a file browser if none is found
  if [[ "$file_browser_installed" == "false" ]]; then
    echo -e "${YELLOW}No file browser found. Installing a lightweight file browser...${NC}"
    install_package pcmanfm
  fi
  echo -e ""
fi

# Step 6: Create explicit MIME associations
echo -e "${BLUE}${BOLD}Step 6: Setting up MIME associations${NC}"

if [[ "$HAS_DESKTOP" == "yes" && "$ENV_TYPE" == "Linux" ]]; then
  # Create directory for local MIME associations if it doesn't exist
  if [ ! -d ~/.local/share/applications ]; then
    mkdir -p ~/.local/share/applications
  fi
  
  # Create a MIME handler for directories
  echo -e "Creating MIME handler for directories..."
  cat > ~/.local/share/applications/directory-handler.desktop << EOF
[Desktop Entry]
Type=Application
Name=Directory Viewer
Comment=View directories
Exec=xdg-open %u
NoDisplay=true
MimeType=inode/directory;
EOF
  
  # Create a MIME handler for HTML files
  echo -e "Creating MIME handler for HTML files..."
  cat > ~/.local/share/applications/html-handler.desktop << EOF
[Desktop Entry]
Type=Application
Name=HTML Viewer
Comment=View HTML files
Exec=xdg-open %u
NoDisplay=true
MimeType=text/html;
EOF
  
  # Set default application for directories
  found_file_manager=""
  for fm in nautilus thunar pcmanfm dolphin caja nemo xfe; do
    if command -v $fm &> /dev/null; then
      found_file_manager=$fm
      break
    fi
  done
  
  if [ -n "$found_file_manager" ]; then
    echo -e "Setting $found_file_manager as default directory handler..."
    cat > ~/.local/share/applications/mimeapps.list << EOF
[Default Applications]
inode/directory=$found_file_manager.desktop;
EOF
  fi
  
  # Set default application for HTML files
  found_browser=""
  for browser in firefox chromium chromium-browser google-chrome brave-browser epiphany midori; do
    if command -v $browser &> /dev/null; then
      found_browser=$browser
      break
    fi
  done
  
  if [ -n "$found_browser" ]; then
    echo -e "Setting $found_browser as default HTML handler..."
    if [ -f ~/.local/share/applications/mimeapps.list ]; then
      echo "text/html=$found_browser.desktop;" >> ~/.local/share/applications/mimeapps.list
    else
      cat > ~/.local/share/applications/mimeapps.list << EOF
[Default Applications]
text/html=$found_browser.desktop;
EOF
    fi
  fi
  
  # Update desktop database
  if command -v update-desktop-database &> /dev/null; then
    echo -e "Updating desktop database..."
    update-desktop-database ~/.local/share/applications
  fi
  
  echo -e "${GREEN}✓ MIME associations set up${NC}\n"
elif [[ "$ENV_TYPE" == "WSL" ]]; then
  echo -e "${YELLOW}⚠️ Skipping MIME setup in WSL environment (Windows handles MIME associations)${NC}\n"
else
  echo -e "${YELLOW}⚠️ Skipping MIME setup (no desktop environment detected)${NC}\n"
fi

# Step 7: Set up browser environment variables
echo -e "${BLUE}${BOLD}Step 7: Setting up browser environment variables${NC}"

# Find a suitable browser
found_browser=""
for browser in firefox chromium chromium-browser google-chrome brave-browser epiphany midori w3m links lynx; do
  if command -v $browser &> /dev/null; then
    found_browser=$browser
    break
  fi
done

if [ -n "$found_browser" ]; then
  echo -e "Setting $found_browser as default browser in shell configs..."
  
  # Add to shell config files
  for rcfile in ~/.bashrc ~/.zshrc; do
    if [ -f "$rcfile" ]; then
      if ! grep -q "export BROWSER=" "$rcfile"; then
        echo "" >> "$rcfile"
        echo "# Default browser" >> "$rcfile"
        echo "export BROWSER=$found_browser" >> "$rcfile"
      fi
    fi
  done
  
  # Also set for current session
  export BROWSER=$found_browser
  echo -e "${GREEN}✓ Browser environment variable set${NC}\n"
else
  echo -e "${YELLOW}⚠️ No suitable browser found. Skipping browser environment setup.${NC}\n"
fi

# Final steps and recommendations
echo -e "${GREEN}${BOLD}=== Setup completed! ===${NC}"
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

# Troubleshooting information
echo -e "\n${BLUE}${BOLD}Troubleshooting${NC}"
echo -e "If you still have issues with the 'open' command:"

echo -e "1. HTML files open in Vim/text editor instead of browser:"
echo -e "   - This issue is solved by the BROWSER environment variable we set"
echo -e "   - Make sure to restart your shell or log out and back in"

echo -e "2. 'No application found for mimetype: inode/directory':"
echo -e "   - We've created MIME associations, but they might need further tweaking"
echo -e "   - Try installing a different file manager: ${BOLD}sudo apt install thunar${NC}"

echo -e "3. WSL-specific issues:"
echo -e "   - Make sure wslu is installed: ${BOLD}sudo apt install wslu${NC}"
echo -e "   - Use wslview directly: ${BOLD}wslview .${NC}"

echo -e "\nFor additional help, please submit an issue on GitHub."
echo -e ""