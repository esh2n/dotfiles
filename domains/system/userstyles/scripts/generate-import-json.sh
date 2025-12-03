#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Import JSON Generator for Unified Userstyle
# =============================================================================
# Generates import.json containing only the unified .user.less file
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERSTYLES_DIR="$(dirname "$SCRIPT_DIR")"
GEN_DIR="$USERSTYLES_DIR/gen"
OUTPUT_FILE="$GEN_DIR/import.json"
UNIFIED_FILE="$GEN_DIR/github.user.less"
DOTFILES_ROOT="$(cd "$USERSTYLES_DIR/../../.." && pwd)"

source "$DOTFILES_ROOT/core/utils/common.sh"

# Extract metadata from UserCSS file
extract_metadata() {
  local file="$1"
  local key="$2"
  grep "^@${key}" "$file" | sed "s/^@${key}\\s*//" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | head -1
}

# Extract CSS/LESS code (everything after ==/UserStyle== marker)
extract_code() {
  local file="$1"
  sed -n '/^==/,$p' "$file" | tail -n +2
}

# Extract domain patterns from @-moz-document directive
extract_domains() {
  local file="$1"
  local domains=()
  while IFS= read -r line; do
    if [[ "$line" =~ domain\\(\\\"([^\\\"]+)\\\"\\) ]]; then
      domains+=("\"${BASH_REMATCH[1]}\"")
    fi
  done < <(grep -o 'domain("[^"]*")' "$file")

  if [[ ${#domains[@]} -gt 0 ]]; then
    echo "[$(IFS=,; echo "${domains[*]}")]"
  else
    echo "[]"
  fi
}

# Extract regexp patterns from @-moz-document directive
extract_regexps() {
  local file="$1"
  local regexps=()
  while IFS= read -r line; do
    if [[ "$line" =~ regexp\\(\\\"([^\\\"]+)\\\"\\) ]]; then
      local pattern="${BASH_REMATCH[1]}"
      pattern="${pattern//\\\\/\\\\\\\\}"
      regexps+=("\"${pattern}\"")
    fi
  done < <(grep -o 'regexp("[^"]*")' "$file")

  if [[ ${#regexps[@]} -gt 0 ]]; then
    echo "[$(IFS=,; echo "${regexps[*]}")]"
  else
    echo "[]"
  fi
}

main() {
  if [[ ! -f "$UNIFIED_FILE" ]]; then
    log_error "Unified userstyle file not found: $UNIFIED_FILE"
    log_info "Run: bash scripts/generate-unified-userstyle.sh first"
    exit 1
  fi

  if ! command -v jq &> /dev/null; then
    log_error "jq not found. Please install jq"
    exit 1
  fi

  log_info "Generating import.json for unified userstyle..."

  # Extract metadata
  local name=$(extract_metadata "$UNIFIED_FILE" "name")
  local namespace=$(extract_metadata "$UNIFIED_FILE" "namespace")
  local homepageURL=$(extract_metadata "$UNIFIED_FILE" "homepageURL")
  local version=$(extract_metadata "$UNIFIED_FILE" "version")
  local description=$(extract_metadata "$UNIFIED_FILE" "description")
  local author=$(extract_metadata "$UNIFIED_FILE" "author")
  local preprocessor=$(grep "^@preprocessor" "$UNIFIED_FILE" | sed 's/@preprocessor\s*//' | tr -d ' ')

  # Read entire LESS source code
  local sourceCode=$(cat "$UNIFIED_FILE" | jq -Rs .)

  # Generate required metadata
  local uuid=$(uuidgen | tr '[:upper:]' '[:lower:]')
  local timestamp=$(date +%s)000
  local digest=$(echo -n "$sourceCode" | shasum -a 256 | cut -d' ' -f1)
  local etag="W/\\\"${digest}\\\""

  # Generate JSON with usercssData and sourceCode (Catppuccin style)
  cat > "$OUTPUT_FILE" <<EOF
[
  {
    "settings": {
      "patchCsp": true,
      "updateInterval": 24,
      "updateOnlyEnabled": true
    }
  },
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
    "id": 1,
    "etag": "${etag}"
  }
]
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
  log_info ""
  log_info "To import into Stylus:"
  log_info "  1. Open Stylus extension"
  log_info "  2. Click 'Manage' → 'Import'"
  log_info "  3. Select: $OUTPUT_FILE"
  log_info "  4. Enable 'GitHub Multi-Theme'"
  log_info "  5. Click settings icon (⚙️) → Select theme"
  log_info ""
  log_success "✓ Done!"
}

main "$@"
