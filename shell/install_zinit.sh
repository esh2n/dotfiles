#!/bin/bash
# Install Zinit plugin manager for zsh

set -euo pipefail

# Install Zinit
install_zinit() {
    echo "Installing Zinit plugin manager..."
    
    # Installation directory
    ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"
    
    # Create directory
    mkdir -p "$(dirname $ZINIT_HOME)"
    
    # Clone zinit if not already installed
    if [ ! -d "$ZINIT_HOME" ]; then
        git clone https://github.com/zdharma-continuum/zinit.git "$ZINIT_HOME"
    else
        echo "Zinit already installed at $ZINIT_HOME"
    fi
    
    # Source zinit
    if [ -f "$ZINIT_HOME/zinit.zsh" ]; then
        # Add autoload line to zshrc if it doesn't exist
        ZINIT_LOAD_CMD='source "$ZINIT_HOME/zinit.zsh"'
        
        echo "Zinit installed successfully!"
        echo ""
        echo "Make sure your .zshrc loads Zinit with:"
        echo '# Initialize Zinit'
        echo 'ZINIT_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}/zinit/zinit.git"'
        echo 'source "${ZINIT_HOME}/zinit.zsh"'
    else
        echo "Error: Zinit installation failed. Please check the error messages above."
    fi
}

# Run the installation if this script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    install_zinit
fi