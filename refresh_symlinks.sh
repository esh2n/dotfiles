#!/bin/bash

# Script to refresh symlinks without running the full installation
# This is useful when you just want to update your dotfiles

set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source the symlinks script
source "$DOTFILES_DIR/shell/create_symlinks.sh"

echo "┌─────────────────────────────────────────┐"
echo "│ Dotfiles Symlink Refresh Tool           │"
echo "└─────────────────────────────────────────┘"
echo 
echo "This will only recreate symlinks without running the full installation."
echo "Your existing configurations will be backed up to ~/.dotfiles_backup/"
echo

read -p "Do you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Operation cancelled."
    exit 1
fi

# Call the create_symlinks function from the sourced script
create_symlinks

echo
echo "✅ Symlinks refreshed successfully!"
echo "You may need to restart your shell to apply all changes."