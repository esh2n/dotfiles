#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# LESS Variables Generator
# =============================================================================
# Generates LESS variable files from theme Lua files
#
# Usage:
#   ./generate-less-variables.sh <theme>        # Generate for specific theme
#   ./generate-less-variables.sh --all          # Generate for all themes
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERSTYLES_DIR="$(dirname "$SCRIPT_DIR")"
THEMES_DIR="$USERSTYLES_DIR/../../system/config/themes"
VARS_DIR="$USERSTYLES_DIR/vars"
DOTFILES_ROOT="$(cd "$USERSTYLES_DIR/../../.." && pwd)"

source "$DOTFILES_ROOT/core/utils/common.sh"

# Extract hex color from Lua palette file
extract_color() {
  local color_name="$1"
  local theme_file="$2"
  local value=$(grep "^\s*${color_name}\s*=" "$theme_file" | sed 's/.*0x//' | sed 's/,.*$//')
  if [[ -n "$value" ]]; then
    value=$(echo "$value" | sed 's/^ff//')
    echo "#${value}"
  else
    echo ""
  fi
}

# Generate LESS variables file for a theme
generate_vars() {
  local theme="$1"
  local theme_file="$THEMES_DIR/${theme}.lua"
  local output_file="$VARS_DIR/${theme}.less"

  if [[ ! -f "$theme_file" ]]; then
    log_error "Theme file not found: $theme_file"
    return 1
  fi

  log_info "Generating LESS variables for $theme..."

  # Extract all colors
  local base=$(extract_color "base" "$theme_file")
  local mantle=$(extract_color "mantle" "$theme_file")
  local crust=$(extract_color "crust" "$theme_file")
  local text=$(extract_color "text" "$theme_file")
  local subtext1=$(extract_color "subtext1" "$theme_file")
  local subtext0=$(extract_color "subtext0" "$theme_file")
  local overlay2=$(extract_color "overlay2" "$theme_file")
  local overlay1=$(extract_color "overlay1" "$theme_file")
  local overlay0=$(extract_color "overlay0" "$theme_file")
  local surface2=$(extract_color "surface2" "$theme_file")
  local surface1=$(extract_color "surface1" "$theme_file")
  local surface0=$(extract_color "surface0" "$theme_file")
  local red=$(extract_color "red" "$theme_file")
  local green=$(extract_color "green" "$theme_file")
  local blue=$(extract_color "blue" "$theme_file")
  local yellow=$(extract_color "yellow" "$theme_file")
  local peach=$(extract_color "peach" "$theme_file")
  local mauve=$(extract_color "mauve" "$theme_file")
  local pink=$(extract_color "pink" "$theme_file")
  local teal=$(extract_color "teal" "$theme_file")
  local sky=$(extract_color "sky" "$theme_file")
  local sapphire=$(extract_color "sapphire" "$theme_file")
  local lavender=$(extract_color "lavender" "$theme_file")

  # Get accent color
  local accent_name=$(get_accent_color "$theme")
  local accent=$(extract_color "$accent_name" "$theme_file")

  # Generate LESS file
  cat > "$output_file" << EOF
// LESS variables for ${theme} theme
// Auto-generated from domains/system/config/themes/${theme}.lua

@base: ${base};
@mantle: ${mantle};
@crust: ${crust};
@text: ${text};
@subtext1: ${subtext1};
@subtext0: ${subtext0};
@overlay2: ${overlay2};
@overlay1: ${overlay1};
@overlay0: ${overlay0};
@surface2: ${surface2};
@surface1: ${surface1};
@surface0: ${surface0};
@red: ${red};
@green: ${green};
@blue: ${blue};
@yellow: ${yellow};
@peach: ${peach};
@mauve: ${mauve};
@pink: ${pink};
@teal: ${teal};
@sky: ${sky};
@sapphire: ${sapphire};
@lavender: ${lavender};
@accent: ${accent};
EOF

  log_success "Generated: $output_file"
}

# Get default accent color for theme
get_accent_color() {
  local theme="$1"
  case "$theme" in
    catppuccin) echo "mauve" ;;
    nord) echo "sky" ;;
    tokyonight) echo "blue" ;;
    dracula) echo "mauve" ;;
    gruvbox) echo "peach" ;;
    kanagawa) echo "blue" ;;
    onedark) echo "blue" ;;
    rosepine) echo "lavender" ;;
    solarized) echo "blue" ;;
    everforest) echo "green" ;;
    *) echo "blue" ;;
  esac
}

main() {
  mkdir -p "$VARS_DIR"

  if [[ "${1:-}" == "--all" ]]; then
    for theme_file in "$THEMES_DIR"/*.lua; do
      if [[ -f "$theme_file" ]]; then
        local theme_name=$(basename "$theme_file" .lua)
        generate_vars "$theme_name"
      fi
    done
  else
    local theme="${1:-}"
    if [[ -z "$theme" ]]; then
      log_error "Usage: $0 <theme|--all>"
      exit 1
    fi
    generate_vars "$theme"
  fi

  log_success "✓ Done!"
}

main "$@"
