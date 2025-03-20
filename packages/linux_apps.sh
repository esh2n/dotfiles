#!/bin/bash
# Linux/WSL specific package installer
# This script installs native Linux packages that complement Homebrew installations

set -euo pipefail

# Detect if running in WSL
is_wsl() {
    grep -q Microsoft /proc/version 2>/dev/null
    return $?
}

# Check if script is running as root
check_not_root() {
    if [ "$(id -u)" = "0" ]; then
        echo "Error: This script should not be run as root."
        echo "Please run it as a regular user with sudo privileges."
        exit 1
    fi
}

# Update apt package lists
update_apt() {
    echo "Updating apt package lists..."
    sudo apt update
    echo "Done."
}

# Install essential build dependencies
install_build_deps() {
    echo "Installing essential build dependencies..."
    sudo apt install -y build-essential procps curl file git
    echo "Done."
}

# Install development libraries
install_dev_libs() {
    echo "Installing development libraries..."
    sudo apt install -y \
        libssl-dev \
        libreadline-dev \
        zlib1g-dev \
        autoconf \
        bison \
        libyaml-dev \
        libncurses5-dev \
        libffi-dev \
        libgdbm-dev \
        libsqlite3-dev \
        libxml2-dev \
        libxslt1-dev \
        libcurl4-openssl-dev \
        libjpeg-dev \
        libpng-dev
    echo "Done."
}

# Install shell tools
install_shell_tools() {
    echo "Installing shell tools..."
    sudo apt install -y \
        zsh \
        fish \
        tmux \
        fzf \
        ripgrep \
        fd-find \
        bat
        
    # Create symlinks for tools with different names on Ubuntu/Debian
    if [ ! -f /usr/local/bin/batcat ] && [ -f /usr/bin/batcat ]; then
        sudo ln -sf /usr/bin/batcat /usr/local/bin/bat
    fi
    
    if [ ! -f /usr/local/bin/fdfind ] && [ -f /usr/bin/fdfind ]; then
        sudo ln -sf /usr/bin/fdfind /usr/local/bin/fd
    fi
    
    echo "Done."
}

# Install text editors
install_editors() {
    echo "Installing text editors..."
    sudo apt install -y \
        vim \
        neovim
    echo "Done."
}

# Install GUI applications if not in WSL
install_gui_apps() {
    # Skip GUI apps in WSL (they should be installed on Windows side)
    if is_wsl; then
        echo "Skipping GUI applications in WSL environment."
        return 0
    fi
    
    echo "Installing GUI applications..."
    sudo apt install -y \
        firefox \
        vlc
    
    # Install VSCode via apt repository
    echo "Installing Visual Studio Code..."
    wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
    sudo install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/trusted.gpg.d/
    sudo sh -c 'echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/trusted.gpg.d/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list'
    rm -f packages.microsoft.gpg
    sudo apt update
    sudo apt install -y code
    echo "Done."
}

# Install Docker (optionally)
install_docker() {
    echo "Do you want to install Docker? (y/N)"
    read -r install_docker_response
    
    if [[ ! "$install_docker_response" =~ ^[Yy]$ ]]; then
        echo "Skipping Docker installation."
        return 0
    fi

    echo "Installing Docker..."
    
    # Remove old versions if present
    sudo apt remove -y docker docker-engine docker.io containerd runc || true
    
    # Install dependencies
    sudo apt install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    # Add Docker's official GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    
    # Set up repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Add user to docker group to run without sudo
    sudo usermod -aG docker "$USER"
    
    # Special handling for WSL
    if is_wsl; then
        # Create daemon configuration for WSL
        echo "Configuring Docker for WSL..."
        sudo mkdir -p /etc/docker
        cat <<EOT | sudo tee /etc/docker/daemon.json
{
  "iptables": false,
  "bridge": "none",
  "hosts": ["unix:///var/run/docker.sock"]
}
EOT
        
        # Create startup script for Docker
        sudo mkdir -p /etc/wsl.d/
        cat <<EOT | sudo tee /etc/wsl.d/docker.conf
[boot]
command="service docker start"
EOT

        echo "Docker configured for WSL. It will start automatically on WSL launch."
        echo "NOTE: You may need to restart your WSL instance for Docker to work without sudo."
    else
        # Enable Docker to start on boot for regular Linux
        sudo systemctl enable docker
        sudo systemctl start docker
    fi
    
    echo "Docker installation completed."
}

# Configure fonts
configure_fonts() {
    # Skip in WSL as fonts are managed by Windows
    if is_wsl; then
        echo "Skipping font installation in WSL environment."
        return 0
    fi

    echo "Installing development fonts..."
    
    # Create fonts directory
    mkdir -p ~/.local/share/fonts
    
    # Download and install JetBrains Mono
    echo "Installing JetBrains Mono..."
    wget -q "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip" -O /tmp/jetbrains-mono.zip
    unzip -q -o /tmp/jetbrains-mono.zip -d /tmp/jetbrains-mono
    cp /tmp/jetbrains-mono/fonts/ttf/*.ttf ~/.local/share/fonts/
    rm -rf /tmp/jetbrains-mono /tmp/jetbrains-mono.zip
    
    # Download and install Hack Nerd Font
    echo "Installing Hack Nerd Font..."
    wget -q "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.0.2/Hack.zip" -O /tmp/hack-nerd-font.zip
    unzip -q -o /tmp/hack-nerd-font.zip -d ~/.local/share/fonts/
    rm -f /tmp/hack-nerd-font.zip
    
    # Update font cache
    fc-cache -f -v
    
    echo "Font installation completed."
}

# Configure default shell
configure_default_shell() {
    if [ "$SHELL" != "/bin/zsh" ] && command -v zsh > /dev/null; then
        echo "Do you want to set Zsh as your default shell? (y/N)"
        read -r set_zsh
        
        if [[ "$set_zsh" =~ ^[Yy]$ ]]; then
            echo "Setting Zsh as default shell..."
            chsh -s $(which zsh)
            echo "Shell changed to Zsh. Please log out and log back in for changes to take effect."
        fi
    else
        echo "Zsh is already your default shell."
    fi
}

# Main function
main() {
    echo "==================================================="
    echo "  Linux Native Package Installer for Dotfiles"
    echo "==================================================="
    echo ""
    
    # Check if running as root
    check_not_root
    
    # Detect environment
    if is_wsl; then
        echo "WSL environment detected."
    else
        echo "Native Linux environment detected."
    fi
    
    echo ""
    echo "This script will install native Linux packages and"
    echo "configure your Linux/WSL environment."
    echo ""
    echo "The following operations will be performed:"
    echo "1. Update apt package repositories"
    echo "2. Install essential build dependencies"
    echo "3. Install development libraries"
    echo "4. Install shell tools (zsh, fish, tmux)"
    echo "5. Install text editors (vim, neovim)"
    
    if ! is_wsl; then
        echo "6. Install GUI applications"
        echo "7. Configure development fonts"
    fi
    
    echo ""
    echo "Additionally, you'll have the option to:"
    echo "- Install Docker"
    echo "- Change your default shell to Zsh"
    echo ""
    
    read -p "Do you want to continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi

    update_apt
    install_build_deps
    install_dev_libs
    install_shell_tools
    install_editors
    install_gui_apps
    install_docker
    configure_fonts
    configure_default_shell
    
    echo ""
    echo "==================================================="
    echo "  Linux Native Package Installation Complete"
    echo "==================================================="
    echo ""
    echo "Your Linux/WSL environment is now set up with native packages."
    echo ""
    
    if is_wsl; then
        echo "IMPORTANT NOTES FOR WSL USERS:"
        echo "- GUI applications should be installed on the Windows side"
        echo "- To access Windows applications from WSL, use the 'wslview' command"
        echo "- For Docker, you may need to restart your WSL instance or run:"
        echo "  'sudo service docker start'"
    fi
    
    echo ""
    echo "Don't forget to restart your terminal to apply all changes!"
    echo ""
}

# Run the main function
main