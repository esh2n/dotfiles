#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Import JSON Generator for Multi-Service Userstyles
# =============================================================================
# Generates import.json containing all service userstyles (32 services)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERSTYLES_DIR="$(dirname "$SCRIPT_DIR")"
GEN_DIR="$USERSTYLES_DIR/gen"
OUTPUT_FILE="$GEN_DIR/import.json"
DOTFILES_ROOT="$(cd "$USERSTYLES_DIR/../../.." && pwd)"

source "$DOTFILES_ROOT/core/utils/common.sh"

# Ensure gen directory exists
mkdir -p "$GEN_DIR"

# Extract metadata from UserCSS file
extract_metadata() {
  local file="$1"
  local key="$2"
  grep "^@${key}" "$file" | sed "s/^@${key}\\s*//" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | head -1
}

# Generate JSON entry for a service
generate_service_entry() {
  local file="$1"
  local service_name="$2"

  if [[ ! -f "$file" ]]; then
    log_warning "Skipping $service_name: file not found"
    return 1
  fi

  # Extract metadata
  local name=$(extract_metadata "$file" "name")
  local namespace=$(extract_metadata "$file" "namespace")
  local homepageURL=$(extract_metadata "$file" "homepageURL")
  local version=$(extract_metadata "$file" "version")
  local description=$(extract_metadata "$file" "description")
  local author=$(extract_metadata "$file" "author")
  local preprocessor=$(grep "^@preprocessor" "$file" | sed 's/@preprocessor\s*//' | tr -d ' ')

  # Read entire LESS source code
  local sourceCode=$(cat "$file" | jq -Rs .)

  # Generate required metadata
  local uuid=$(uuidgen | tr '[:upper:]' '[:lower:]')
  local timestamp=$(date +%s)000
  local digest=$(echo -n "$sourceCode" | shasum -a 256 | cut -d' ' -f1)
  local etag="W/\\\"${digest}\\\""

  # Generate vars based on service
  local vars_json=""
  if [[ "$service_name" == "youtube" ]]; then
    vars_json=$(cat <<'VARS'
      "vars": {
        "theme": {
          "type": "select",
          "label": "Theme",
          "name": "theme",
          "value": "catppuccin",
          "default": "catppuccin",
          "options": [
            {"name": "catppuccin", "label": "Catppuccin", "value": "catppuccin"},
            {"name": "nord", "label": "Nord", "value": "nord"},
            {"name": "tokyonight", "label": "Tokyo Night", "value": "tokyonight"},
            {"name": "dracula", "label": "Dracula", "value": "dracula"},
            {"name": "gruvbox", "label": "Gruvbox", "value": "gruvbox"},
            {"name": "kanagawa", "label": "Kanagawa", "value": "kanagawa"},
            {"name": "onedark", "label": "OneDark", "value": "onedark"},
            {"name": "rosepine", "label": "Rosé Pine", "value": "rosepine"},
            {"name": "solarized", "label": "Solarized", "value": "solarized"},
            {"name": "everforest", "label": "Everforest", "value": "everforest"}
          ]
        },
        "logo": {
          "type": "checkbox",
          "label": "Enable YouTube logo",
          "name": "logo",
          "value": "1",
          "default": "1"
        },
        "oled": {
          "type": "checkbox",
          "label": "Enable black bars (OLED)",
          "name": "oled",
          "value": "0",
          "default": "0"
        },
        "sponsorBlock": {
          "type": "checkbox",
          "label": "Enable SponsorBlock segments",
          "name": "sponsorBlock",
          "value": "1",
          "default": "1"
        }
      }
VARS
)
  else
    # GitHub and other services: only theme selector
    vars_json=$(cat <<'VARS'
      "vars": {
        "theme": {
          "type": "select",
          "label": "Theme",
          "name": "theme",
          "value": "catppuccin",
          "default": "catppuccin",
          "options": [
            {"name": "catppuccin", "label": "Catppuccin", "value": "catppuccin"},
            {"name": "nord", "label": "Nord", "value": "nord"},
            {"name": "tokyonight", "label": "Tokyo Night", "value": "tokyonight"},
            {"name": "dracula", "label": "Dracula", "value": "dracula"},
            {"name": "gruvbox", "label": "Gruvbox", "value": "gruvbox"},
            {"name": "kanagawa", "label": "Kanagawa", "value": "kanagawa"},
            {"name": "onedark", "label": "OneDark", "value": "onedark"},
            {"name": "rosepine", "label": "Rosé Pine", "value": "rosepine"},
            {"name": "solarized", "label": "Solarized", "value": "solarized"},
            {"name": "everforest", "label": "Everforest", "value": "everforest"}
          ]
        }
      }
VARS
)
  fi

  # Generate JSON entry
  cat <<EOF
  {
    "enabled": true,
    "name": "${name}",
    "description": "${description}",
    "author": "${author}",
    "updateUrl": null,
    "usercssData": {
      "name": "${name}",
      "namespace": "${namespace}",
      "homepageURL": "${homepageURL}",
      "version": "${version}",
      "updateURL": null,
      "supportURL": null,
      "description": "${description}",
      "author": "${author}",
      "license": "MIT",
      "preprocessor": "${preprocessor}",
${vars_json}
    },
    "originalDigest": "${digest}",
    "_id": "${uuid}",
    "_rev": ${timestamp},
    "sourceCode": ${sourceCode},
    "sections": [
      {
        "code": ""
      }
    ],
    "id": ${ENTRY_ID},
    "etag": "${etag}"
  }
EOF
}

main() {
  if ! command -v jq &> /dev/null; then
    log_error "jq not found. Please install jq"
    exit 1
  fi

  log_info "Generating import.json for all services..."

  # Start JSON array with settings
  cat > "$OUTPUT_FILE" <<'EOF'
[
  {
    "settings": {
      "patchCsp": true,
      "updateInterval": 24,
      "updateOnlyEnabled": true
    }
  }
EOF

  # Generate entries for each service
  local entry_id=1
  for service in github youtube chatgpt \
    nixos-search devdocs startpage brave-search mdn claude crates.io docs.rs \
    react.dev perplexity mastodon reddit pypi stackoverflow spotify-web \
    linkedin bsky npm whatsapp-web google gmail google-drive google-photos \
    google-gemini instagram twitter twitch go.dev duckduckgo; do
    local file="$GEN_DIR/${service}.user.less"

    if [[ -f "$file" ]]; then
      log_info "Adding ${service}..."
      echo "," >> "$OUTPUT_FILE"
      ENTRY_ID=$entry_id generate_service_entry "$file" "$service" >> "$OUTPUT_FILE"
      ((entry_id++))
    else
      log_warning "Skipping ${service}: file not found"
    fi
  done

  # Close JSON array
  echo "" >> "$OUTPUT_FILE"
  echo "]" >> "$OUTPUT_FILE"

  log_success "✓ Generated: $OUTPUT_FILE"
  log_info ""
  log_info "To import into Stylus:"
  log_info "  1. Open Stylus extension"
  log_info "  2. Click 'Manage' → 'Import'"
  log_info "  3. Select: $OUTPUT_FILE"
  log_info "  4. Enable desired services"
  log_info "  5. Click settings icon (⚙️) → Configure themes/options"
  log_info ""
  log_success "✓ Done!"
}

main "$@"
