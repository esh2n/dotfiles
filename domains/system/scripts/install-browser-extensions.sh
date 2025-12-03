#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Browser Extensions Installer
# =============================================================================
# Automatically configure Chrome/Chromium-based browsers to install extensions
# using the ExtensionInstallForcelist policy (Recommended level).
#
# Usage:
#   ./install-browser-extensions.sh [--dry-run]
#
# Options:
#   --dry-run    Show what would be done without making changes
# =============================================================================

# Color output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m' # No Color

# Get script directory
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly CONFIG_DIR="$(cd "$SCRIPT_DIR/../config/browsers" && pwd)"
readonly EXTENSIONS_FILE="$CONFIG_DIR/extensions.json"

# Dry run flag
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
  esac
done

# =============================================================================
# Functions
# =============================================================================

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
  if ! command -v python3 &> /dev/null; then
    log_error "python3 is required but not installed"
    exit 1
  fi

  if [[ ! -f "$EXTENSIONS_FILE" ]]; then
    log_error "Extensions file not found: $EXTENSIONS_FILE"
    exit 1
  fi
}

get_extension_ids() {
  python3 -c "
import json
with open('$EXTENSIONS_FILE') as f:
    data = json.load(f)
    ids = [ext['id'] for ext in data['extensions']]
    print(' '.join(ids))
"
}

configure_browser() {
  local browser_bundle_id="$1"
  local browser_name="$2"

  log_info "Configuring $browser_name ($browser_bundle_id)..."

  # Get extension IDs as array
  local extension_ids
  extension_ids=$(get_extension_ids)

  if [[ "$DRY_RUN" == true ]]; then
    log_info "[DRY RUN] Would configure $browser_name with extensions:"
    for id in $extension_ids; do
      echo "  - $id"
    done
    return 0
  fi

  # Build defaults write command
  local -a ext_array=()
  for id in $extension_ids; do
    ext_array+=("-array-add" "$id")
  done

  # Clear existing list first
  defaults delete "$browser_bundle_id" ExtensionInstallForcelist 2>/dev/null || true

  # Set new list
  defaults write "$browser_bundle_id" ExtensionInstallForcelist -array
  for id in $extension_ids; do
    defaults write "$browser_bundle_id" ExtensionInstallForcelist -array-add "$id"
  done

  log_info "✓ Configured $browser_name with ${#ext_array[@]} extensions"
}

verify_configuration() {
  local browser_bundle_id="$1"
  local browser_name="$2"

  log_info "Verifying $browser_name configuration..."

  local configured_count
  configured_count=$(defaults read "$browser_bundle_id" ExtensionInstallForcelist 2>/dev/null | grep -c "^ " || echo "0")

  if [[ "$configured_count" -gt 0 ]]; then
    log_info "✓ $browser_name: $configured_count extensions configured"
    return 0
  else
    log_warn "⚠ $browser_name: No extensions configured"
    return 1
  fi
}

# =============================================================================
# Main
# =============================================================================

main() {
  echo "=========================================="
  echo "Browser Extensions Installer"
  echo "=========================================="
  echo ""

  check_requirements

  # Show extensions list
  log_info "Extensions to install:"
  python3 -c "
import json
with open('$EXTENSIONS_FILE') as f:
    data = json.load(f)
    for ext in data['extensions']:
        print(f\"  - {ext['name']} ({ext['id']})\")
"
  echo ""

  # Define browsers to configure
  # Format: "bundle_id:browser_name"
  local -a browsers=(
    "com.google.Chrome:Google Chrome"
    "company.thebrowser.dia:Dia Browser"
  )

  # Uncomment to add more browsers:
  # "com.brave.Browser:Brave Browser"
  # "com.vivaldi.Vivaldi:Vivaldi"
  # "com.microsoft.edgemac:Microsoft Edge"

  # Configure each browser
  for browser_entry in "${browsers[@]}"; do
    local bundle_id="${browser_entry%%:*}"
    local browser_name="${browser_entry#*:}"
    configure_browser "$bundle_id" "$browser_name"
  done

  echo ""

  if [[ "$DRY_RUN" == true ]]; then
    log_info "[DRY RUN] No changes were made"
    exit 0
  fi

  # Verify configuration
  echo "=========================================="
  echo "Verification"
  echo "=========================================="
  echo ""

  for browser_entry in "${browsers[@]}"; do
    local bundle_id="${browser_entry%%:*}"
    local browser_name="${browser_entry#*:}"
    verify_configuration "$bundle_id" "$browser_name"
  done

  echo ""
  echo "=========================================="
  log_info "✓ Done!"
  echo "=========================================="
  echo ""
  echo "Next steps:"
  echo "1. Restart your browsers"
  echo "2. Extensions will be installed automatically"
  echo "3. Check chrome://policy (or equivalent) to verify"
  echo ""
  echo "Note: Extensions are set at 'Recommended' level,"
  echo "      so you can still uninstall them if needed."
  echo ""
}

main "$@"
