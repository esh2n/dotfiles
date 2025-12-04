#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Userstyle Generator (Multi-service support with shared theme library)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERSTYLES_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES_DIR="$USERSTYLES_DIR/templates"
GEN_DIR="$USERSTYLES_DIR/gen"
LIB_FILE="$USERSTYLES_DIR/lib/themes.less"
DOTFILES_ROOT="$(cd "$USERSTYLES_DIR/../../.." && pwd)"

source "$DOTFILES_ROOT/core/utils/common.sh"

# Service selection (default: github for backwards compatibility)
SERVICE="${1:-github}"

generate_github() {
  local OUTPUT_FILE="$GEN_DIR/github.user.less"
  log_info "Generating GitHub userstyle..."

  # Generate header
  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name GitHub Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/github
@homepageURL https://github.com/esh2n/dotfiles
@version 4.1.0
@description GitHub multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  # Embed theme library
  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document regexp("https://github\\.com(?!(/home$|/features($|/.*)|/organizations/plan)).*$"),
  domain("gist.github.com"),
  domain("docs.github.com"),
  domain("viewscreen.githubusercontent.com") {

  #apply-theme(@theme) {
    // Load colors from shared theme library
    .palette(@theme);

    /* Color Palette Variables */
    --theme-base: @base;
    --theme-mantle: @mantle;
    --theme-crust: @crust;
    --theme-text: @text;
    --theme-subtext1: @subtext1;
    --theme-subtext0: @subtext0;
    --theme-overlay2: @overlay2;
    --theme-overlay1: @overlay1;
    --theme-overlay0: @overlay0;
    --theme-surface2: @surface2;
    --theme-surface1: @surface1;
    --theme-surface0: @surface0;
    --theme-red: @red;
    --theme-green: @green;
    --theme-blue: @blue;
    --theme-yellow: @yellow;
    --theme-peach: @peach;
    --theme-mauve: @mauve;
    --theme-pink: @pink;
    --theme-teal: @teal;
    --theme-sky: @sky;
    --theme-sapphire: @sapphire;
    --theme-lavender: @lavender;
    --theme-accent: @accent;

    /* Accent color */
    accent-color: var(--theme-accent);
    color: var(--theme-text);

    /* Calendar & Contribution Graph */
    --color-calendar-graph-day-bg: var(--theme-surface0) !important;
    --color-calendar-graph-day-border: transparent !important;
    --color-calendar-graph-day-L1-bg: color-mix(in srgb, var(--theme-accent) 40%, transparent) !important;
    --color-calendar-graph-day-L2-bg: color-mix(in srgb, var(--theme-accent) 60%, transparent) !important;
    --color-calendar-graph-day-L3-bg: color-mix(in srgb, var(--theme-accent) 80%, transparent) !important;
    --color-calendar-graph-day-L4-bg: var(--theme-accent) !important;
EOF

  # Append rest of styles from template
  log_info "Appending style definitions from template..."
  cat "$TEMPLATES_DIR/github/content.less" >> "$OUTPUT_FILE"

  # Close mixin and apply within selector
  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  // Apply theme to GitHub dark mode
  [data-color-mode][data-color-mode="auto"][data-dark-theme="dark"],
  [data-color-mode="dark"][data-dark-theme="dark"] {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_youtube() {
  local OUTPUT_FILE="$GEN_DIR/youtube.user.less"
  log_info "Generating YouTube userstyle..."

  # Generate header
  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name YouTube Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/youtube
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description YouTube multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
@var checkbox logo "Enable YouTube logo" 1
@var checkbox oled "Enable black bars (OLED)" 0
@var checkbox sponsorBlock "Enable SponsorBlock segments" 1
==/UserStyle== */

EOF

  # Embed theme library
  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("youtube.com") {
  #apply-theme(@theme) {
    // Load colors from shared theme library
    .palette(@theme);

    // Helper variables (all themes are dark)
    @white: @text;
    @black: @base;

    color: @text;
    background: @base;
EOF

  # Append YouTube main content
  log_info "Appending YouTube main content..."
  cat "$TEMPLATES_DIR/youtube/main-content.less" >> "$OUTPUT_FILE"

  # Close #apply-theme and apply to :root
  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root[dark] {
    #apply-theme(@theme);
  }
}
EOF

  # Studio YouTube
  cat >> "$OUTPUT_FILE" << 'EOF'

@-moz-document url-prefix("https://studio.youtube.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  # Append YouTube Studio content
  cat "$TEMPLATES_DIR/youtube/studio-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root[dark] {
    #apply-theme(@theme);
  }
}
EOF

  # Mobile YouTube
  cat >> "$OUTPUT_FILE" << 'EOF'

@-moz-document domain("m.youtube.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  # Append YouTube Mobile content
  cat "$TEMPLATES_DIR/youtube/mobile-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  html[darker-dark-theme] {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_chatgpt() {
  local OUTPUT_FILE="$GEN_DIR/chatgpt.user.less"
  log_info "Generating ChatGPT userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name ChatGPT Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/chatgpt
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description ChatGPT multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  # Embed theme library
  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("chat.openai.com"), domain("chatgpt.com") {
  #apply-theme(@theme) {
    .palette(@theme);

    /* ChatGPT theming - placeholder */
    --text-primary: @text;
    --text-secondary: @subtext0;
    --surface-primary: @base;
    --surface-secondary: @mantle;
    --border-light: @surface0;
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE (basic template)"
  log_info "Note: ChatGPT theming requires further customization"
}

main() {
  case "$SERVICE" in
    github)
      generate_github
      ;;
    youtube)
      generate_youtube
      ;;
    chatgpt)
      generate_chatgpt
      ;;
    all)
      generate_github
      generate_youtube || true
      generate_chatgpt || true
      ;;
    *)
      log_error "Unknown service: $SERVICE"
      log_info "Usage: $0 [github|youtube|chatgpt|all]"
      exit 1
      ;;
  esac

  log_info ""
  log_info "Next steps:"
  log_info "  1. Run: bash scripts/generate-import-json.sh"
  log_info "  2. Import generated .user.less files into Stylus"
  log_info ""
}

main "$@"
