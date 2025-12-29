#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Nix Configuration Update Script
# -----------------------------------------------------------------------------
# Updates nix-darwin configuration after package or configuration changes
# Usage: ./core/nix/update.sh [options]
# -----------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NIX_DIR="${SCRIPT_DIR}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Show help
show_help() {
    cat << EOF
Nix Configuration Update Script

Updates nix-darwin configuration after making changes to:
- Node packages (domains/dev/packages/node2nix/package.json)
- Homebrew packages (*/packages/homebrew.nix)
- System configuration (core/nix/*)

Usage:
    $0 [options]

Options:
    --rebuild       Force complete rebuild (slower but thorough)
    --node2nix      Regenerate node2nix packages before update
    -h, --help      Show this help message

Examples:
    $0                  # Normal update
    $0 --rebuild        # Complete rebuild
    $0 --node2nix       # Regenerate node packages then update

EOF
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check if Nix is installed
    if ! command -v nix &> /dev/null; then
        log_error "Nix is not installed. Please run ./core/install/installer.sh first"
        exit 1
    fi

    # Check if we can use sudo
    if ! sudo -n true 2>/dev/null; then
        log_info "This script requires sudo access for system activation"
        log_info "You may be prompted for your password"
    fi

}

# Regenerate node2nix packages
regenerate_node2nix() {
    local node2nix_dir="${DOTFILES_ROOT}/domains/dev/packages/node2nix"

    if [[ -f "${node2nix_dir}/package.json" ]]; then
        log_info "Regenerating node2nix packages..."

        # Check if package.json has been modified
        if cd "${DOTFILES_ROOT}" && git diff --name-only | grep -q "domains/dev/packages/node2nix/package.json"; then
            log_info "package.json has been modified, regenerating..."
        fi

        # Run node2nix
        cd "${node2nix_dir}"
        if command -v node2nix &> /dev/null; then
            node2nix -i package.json
        else
            log_info "node2nix not found in PATH, using nix-shell..."
            nix-shell -p nodePackages.node2nix --run "node2nix -i package.json"
        fi

        log_success "node2nix packages regenerated"
        cd "${DOTFILES_ROOT}"
    else
        log_warn "node2nix package.json not found, skipping"
    fi
}

# Build nix configuration
build_configuration() {
    log_info "Building nix-darwin configuration..."

    cd "${NIX_DIR}"

    # Warn about git status
    if cd "${DOTFILES_ROOT}" && ! git diff --quiet; then
        log_warn "Git working tree is dirty (uncommitted changes)"
        log_info "This is OK, continuing with --impure flag..."
    fi

    cd "${NIX_DIR}"

    # Build the configuration
    log_info "Building configuration for ${USER}-mac..."

    if nix build ".#darwinConfigurations.${USER}-mac.system" --impure; then
        log_success "Configuration built successfully"
        return 0
    else
        log_error "Build failed. Trying with more verbose output..."
        nix build ".#darwinConfigurations.${USER}-mac.system" --impure --show-trace
        return 1
    fi
}

# Apply configuration
apply_configuration() {
    log_info "Applying configuration (requires sudo)..."

    if [[ ! -f "${NIX_DIR}/result/activate" ]]; then
        log_error "Build result not found. Build may have failed."
        exit 1
    fi

    # Apply the configuration
    if sudo "${NIX_DIR}/result/activate"; then
        log_success "Configuration applied successfully!"

        # Show what was updated
        log_info "Updates applied:"
        echo "  - System packages via Nix"
        echo "  - Homebrew packages and casks"
        echo "  - Node.js packages (if node2nix was used)"
        echo "  - System configuration"

        # Check if Claude Code was installed
        if command -v claude &> /dev/null; then
            local claude_version=$(claude --version 2>/dev/null || echo "unknown")
            log_success "Claude Code CLI is available: $claude_version"
        fi

        return 0
    else
        log_error "Failed to apply configuration"
        log_info "You can try manually running: sudo ${NIX_DIR}/result/activate"
        return 1
    fi
}

# Clean up old results
cleanup() {
    log_info "Cleaning up..."

    if [[ -L "${NIX_DIR}/result" ]]; then
        rm -f "${NIX_DIR}/result"
    fi

    # Clean up old generations (optional, keeps last 5)
    if command -v darwin-rebuild &> /dev/null; then
        log_info "Cleaning old system generations (keeping last 5)..."
        sudo nix-env --profile /nix/var/nix/profiles/system --list-generations | tail -n +6 | awk '{print $1}' | xargs -I {} sudo nix-env --profile /nix/var/nix/profiles/system --delete-generations {} 2>/dev/null || true
    fi
}

# Main execution
main() {
    local rebuild=false
    local node2nix=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --rebuild)
                rebuild=true
                shift
                ;;
            --node2nix)
                node2nix=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    log_info "Starting Nix configuration update..."
    echo ""

    # Run checks
    check_prerequisites

    # Regenerate node2nix if requested or if package.json changed
    if [[ "$node2nix" == true ]]; then
        regenerate_node2nix
    elif cd "${DOTFILES_ROOT}" && git diff --name-only | grep -q "domains/dev/packages/node2nix/package.json"; then
        log_info "Detected changes in node2nix package.json"
        regenerate_node2nix
    fi

    # Clean if rebuild requested
    if [[ "$rebuild" == true ]]; then
        log_info "Performing complete rebuild..."
        cleanup
    fi

    # Build and apply
    if build_configuration; then
        apply_configuration
    else
        log_error "Build failed. Please check the error messages above."
        log_info "Common fixes:"
        echo "  1. Ensure all files are saved"
        echo "  2. Check for syntax errors in .nix files"
        echo "  3. Try running with --rebuild flag"
        echo "  4. Check that username.nix contains: \"${USER}\""
        exit 1
    fi

    echo ""
    log_success "Update complete!"
    log_info "Your system configuration is now up to date."

    # Remind about new shells
    log_info "Note: New shells will have updated packages available"
    log_info "      Current shells may need to be restarted"
}

# Run main
main "$@"