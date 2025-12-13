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

# Ensure gen directory exists
mkdir -p "$GEN_DIR"

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

  # Main ChatGPT domain
  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("chat.openai.com"), domain("chatgpt.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/chatgpt/main-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

EOF

  # Auth domain
  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("auth.openai.com") {
  main {
    #apply-theme(@theme) {
      .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/chatgpt/auth-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
    }

    #apply-theme(@theme);
  }
}

EOF

  # Auth0 domain
  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("auth0.openai.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/chatgpt/auth0-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  #apply-theme(@theme);
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

# =============================================================================
# Service Generation Functions
# =============================================================================

generate_nixos_search() {
  local OUTPUT_FILE="$GEN_DIR/nixos-search.user.less"
  log_info "Generating NixOS Search userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name NixOS Search Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/nixos-search
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description NixOS Search multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("search.nixos.org") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/nixos-search/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_devdocs() {
  local OUTPUT_FILE="$GEN_DIR/devdocs.user.less"
  log_info "Generating DevDocs userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name DevDocs Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/devdocs
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description DevDocs multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("devdocs.io") {
  @import url("https://prismjs.catppuccin.com/variables.important.css");

  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/devdocs/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  html._theme-default {
    #apply-theme(@theme);
  }
  html._theme-dark {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_startpage() {
  local OUTPUT_FILE="$GEN_DIR/startpage.user.less"
  log_info "Generating Startpage userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Startpage Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/startpage
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Startpage multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("startpage.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/startpage/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_brave_search() {
  local OUTPUT_FILE="$GEN_DIR/brave-search.user.less"
  log_info "Generating Brave Search userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Brave Search Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/brave-search
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Brave Search multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("search.brave.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/brave-search/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root.light {
    #apply-theme(@theme);
  }
  :root.dark {
    #apply-theme(@theme);
  }
  :root:not(.light, .dark) {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_mdn() {
  local OUTPUT_FILE="$GEN_DIR/mdn.user.less"
  log_info "Generating MDN userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name MDN Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/mdn
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description MDN multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("developer.mozilla.org") {
  @import url("https://prismjs.catppuccin.com/variables.important.css");

  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/mdn/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  .light {
    #apply-theme(@theme);
  }
  .dark {
    #apply-theme(@theme);
  }
  :root:not(.light):not(.dark) {
    #apply-theme(@theme);
  }
}

@-moz-document domain("interactive-examples.mdn.mozilla.net") {
  #apply-theme(@theme) {
    .palette(@theme);
EOF

  cat "$TEMPLATES_DIR/mdn/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  .theme-light {
    #apply-theme(@theme);
  }
  .theme-dark {
    #apply-theme(@theme);
  }
  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_claude_userstyle() {
  local OUTPUT_FILE="$GEN_DIR/claude.user.less"
  log_info "Generating Claude userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Claude Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/claude
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Claude multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
#hslify(@color) {
  @raw: e(%("%s %s% %s%", hue(@color), saturation(@color), lightness(@color)));
}

@-moz-document domain("claude.ai") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/claude/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root[data-mode="dark"] {
    #apply-theme(@theme);
  }
  :root[data-mode="light"], [data-theme="claude"][data-mode="light"] {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_crates_io() {
  local OUTPUT_FILE="$GEN_DIR/crates.io.user.less"
  log_info "Generating crates.io userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name crates.io Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/crates.io
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description crates.io multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("crates.io") {
  @import url("https://unpkg.com/@catppuccin/highlightjs@1.0.0/css/catppuccin-variables.important.css");

  code.hljs {
    background: none !important;
  }

  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/crates.io/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root[data-color-scheme="system"] {
    #apply-theme(@theme);
  }
  :root[data-color-scheme="light"] {
    #apply-theme(@theme);
  }
  :root[data-color-scheme="dark"] {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_docs_rs() {
  local OUTPUT_FILE="$GEN_DIR/docs.rs.user.less"
  log_info "Generating docs.rs userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name docs.rs Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/docs.rs
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description docs.rs multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("docs.rs") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/docs.rs/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_react_dev() {
  local OUTPUT_FILE="$GEN_DIR/react.dev.user.less"
  log_info "Generating React.dev userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name React.dev Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/react.dev
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description React.dev multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("react.dev") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/react.dev/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_perplexity() {
  local OUTPUT_FILE="$GEN_DIR/perplexity.user.less"
  log_info "Generating Perplexity userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Perplexity Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/perplexity
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Perplexity multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("perplexity.ai") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/perplexity/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_mastodon() {
  local OUTPUT_FILE="$GEN_DIR/mastodon.user.less"
  log_info "Generating Mastodon userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Mastodon Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/mastodon
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Mastodon multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document regexp("https://.*") {
  body.theme-mastodon-dark,
  body.theme-mastodon-light {
    #apply-theme(@theme) {
      .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/mastodon/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
    }

    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_reddit() {
  local OUTPUT_FILE="$GEN_DIR/reddit.user.less"
  log_info "Generating Reddit userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Reddit Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/reddit
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Reddit multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("reddit.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/reddit/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_pypi() {
  local OUTPUT_FILE="$GEN_DIR/pypi.user.less"
  log_info "Generating PyPI userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name PyPI Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/pypi
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description PyPI multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("pypi.org") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/pypi/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_stackoverflow() {
  local OUTPUT_FILE="$GEN_DIR/stackoverflow.user.less"
  log_info "Generating Stack Overflow userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Stack Overflow Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/stackoverflow
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Stack Overflow multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document regexp("^https?://(www\\.)?stackoverflow\\.com.*$"),
  regexp("^https?://(www\\.)?serverfault\\.com.*$"),
  regexp("^https?://(www\\.)?superuser\\.com.*$"),
  regexp("^https?://.*\\.stackexchange\\.com.*$") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/stackoverflow/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_google() {
  local OUTPUT_FILE="$GEN_DIR/google.user.less"
  log_info "Generating Google userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Google Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/google
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Google multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document regexp("^https?://(www\\.|images\\.)?google\\..*") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/google/main-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document regexp("^https?://(ogs\\.)?google\\..*") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/google/ogs-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_gmail() {
  local OUTPUT_FILE="$GEN_DIR/gmail.user.less"
  log_info "Generating Gmail userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Gmail Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/gmail
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Gmail multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("mail.google.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/gmail/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_google_drive() {
  local OUTPUT_FILE="$GEN_DIR/google-drive.user.less"
  log_info "Generating Google Drive userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Google Drive Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/google-drive
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Google Drive multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("drive.google.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/google-drive/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_google_photos() {
  local OUTPUT_FILE="$GEN_DIR/google-photos.user.less"
  log_info "Generating Google Photos userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Google Photos Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/google-photos
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Google Photos multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("photos.google.com") {
  @catppuccin: {
    latte: {
      rosewater: #dc8a78; flamingo: #dd7878; pink: #ea76cb; mauve: #8839ef;
      red: #d20f39; maroon: #e64553; peach: #fe640b; yellow: #df8e1d;
      green: #40a02b; teal: #179299; sky: #04a5e5; sapphire: #209fb5;
      blue: #1e66f5; lavender: #7287fd; text: #4c4f69; subtext1: #5c5f77;
      subtext0: #6c6f85; overlay2: #7c7f93; overlay1: #8c8fa1; overlay0: #9ca0b0;
      surface2: #acb0be; surface1: #bcc0cc; surface0: #ccd0da; base: #eff1f5;
      mantle: #e6e9ef; crust: #dce0e8;
    };
    frappe: {
      rosewater: #f2d5cf; flamingo: #eebebe; pink: #f4b8e4; mauve: #ca9ee6;
      red: #e78284; maroon: #ea999c; peach: #ef9f76; yellow: #e5c890;
      green: #a6d189; teal: #81c8be; sky: #99d1db; sapphire: #85c1dc;
      blue: #8caaee; lavender: #babbf1; text: #c6d0f5; subtext1: #b5bfe2;
      subtext0: #a5adce; overlay2: #949cbb; overlay1: #838ba7; overlay0: #737994;
      surface2: #626880; surface1: #51576d; surface0: #414559; base: #303446;
      mantle: #292c3c; crust: #232634;
    };
    macchiato: {
      rosewater: #f4dbd6; flamingo: #f0c6c6; pink: #f5bde6; mauve: #c6a0f6;
      red: #ed8796; maroon: #ee99a0; peach: #f5a97f; yellow: #eed49f;
      green: #a6da95; teal: #8bd5ca; sky: #91d7e3; sapphire: #7dc4e4;
      blue: #8aadf4; lavender: #b7bdf8; text: #cad3f5; subtext1: #b8c0e0;
      subtext0: #a5adcb; overlay2: #939ab7; overlay1: #8087a2; overlay0: #6e738d;
      surface2: #5b6078; surface1: #494d64; surface0: #363a4f; base: #24273a;
      mantle: #1e2030; crust: #181926;
    };
    mocha: {
      rosewater: #f5e0dc; flamingo: #f2cdcd; pink: #f5c2e7; mauve: #cba6f7;
      red: #f38ba8; maroon: #eba0ac; peach: #fab387; yellow: #f9e2af;
      green: #a6e3a1; teal: #94e2d5; sky: #89dceb; sapphire: #74c7ec;
      blue: #89b4fa; lavender: #b4befe; text: #cdd6f4; subtext1: #bac2de;
      subtext0: #a6adc8; overlay2: #9399b2; overlay1: #7f849c; overlay0: #6c7086;
      surface2: #585b70; surface1: #45475a; surface0: #313244; base: #1e1e2e;
      mantle: #181825; crust: #11111b;
    };
  };

  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/google-photos/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_google_gemini() {
  local OUTPUT_FILE="$GEN_DIR/google-gemini.user.less"
  log_info "Generating Google Gemini userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Google Gemini Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/google-gemini
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Google Gemini multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("gemini.google.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/google-gemini/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_spotify_web() {
  local OUTPUT_FILE="$GEN_DIR/spotify-web.user.less"
  log_info "Generating Spotify Web userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Spotify Web Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/spotify-web
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Spotify Web multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("open.spotify.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/spotify-web/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_linkedin() {
  local OUTPUT_FILE="$GEN_DIR/linkedin.user.less"
  log_info "Generating LinkedIn userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name LinkedIn Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/linkedin
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description LinkedIn multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("linkedin.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/linkedin/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_bsky() {
  local OUTPUT_FILE="$GEN_DIR/bsky.user.less"
  log_info "Generating Bluesky userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Bluesky Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/bsky
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Bluesky multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("bsky.app") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/bsky/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_instagram() {
  local OUTPUT_FILE="$GEN_DIR/instagram.user.less"
  log_info "Generating Instagram userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Instagram Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/instagram
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Instagram multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("instagram.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/instagram/main-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document regexp("^.*instagram.com/direct.*") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/instagram/direct-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_twitter() {
  local OUTPUT_FILE="$GEN_DIR/twitter.user.less"
  log_info "Generating Twitter userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Twitter Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/twitter
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Twitter multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("twitter.com"), domain("x.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/twitter/main1-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document domain("api.twitter.com"), domain("api.x.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/twitter/api-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document domain("twitter.com"), domain("x.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/twitter/main2-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_npm() {
  local OUTPUT_FILE="$GEN_DIR/npm.user.less"
  log_info "Generating npm userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name npm Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/npm
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description npm multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("www.npmjs.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/npm/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_twitch() {
  local OUTPUT_FILE="$GEN_DIR/twitch.user.less"
  log_info "Generating Twitch userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Twitch Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/twitch
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Twitch multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("twitch.tv") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/twitch/main-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document domain("dashboard.twitch.tv") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/twitch/dashboard-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document domain("dev.twitch.tv"),
  domain("dev-staging.twitch.tv") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/twitch/dev-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_go_dev() {
  local OUTPUT_FILE="$GEN_DIR/go.dev.user.less"
  log_info "Generating Go.dev userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name Go.dev Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/go.dev
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description Go.dev multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("go.dev") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/go.dev/main-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document domain("pkg.go.dev") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/go.dev/pkg-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document url-prefix("https://go.dev/tour") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/go.dev/tour-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_duckduckgo() {
  local OUTPUT_FILE="$GEN_DIR/duckduckgo.user.less"
  log_info "Generating DuckDuckGo userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name DuckDuckGo Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/duckduckgo
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description DuckDuckGo multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
@-moz-document domain("duckduckgo.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/duckduckgo/main-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}

@-moz-document domain("start.duckduckgo.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/duckduckgo/start-content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  :root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

generate_whatsapp_web() {
  local OUTPUT_FILE="$GEN_DIR/whatsapp-web.user.less"
  log_info "Generating WhatsApp Web userstyle..."

  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name WhatsApp Web Multi-Theme
@namespace github.com/esh2n/dotfiles/userstyles/whatsapp-web
@homepageURL https://github.com/esh2n/dotfiles
@version 1.0.0
@description WhatsApp Web multi-theme switcher
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

EOF

  cat "$LIB_FILE" >> "$OUTPUT_FILE"
  echo "" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
#WDS(@id, @color) {
  --WDS-@{id}: @color;
  --WDS-@{id}-RGB: #lib.rgbify(@color)[];
  --WDS-@{id}-rgb: #lib.rgbify(@color)[];
}

#RGB(@id, @color) {
  --@{id}: @color;
}

@-moz-document domain("web.whatsapp.com") {
  #apply-theme(@theme) {
    .palette(@theme);

EOF

  cat "$TEMPLATES_DIR/whatsapp-web/content.less" >> "$OUTPUT_FILE"

  cat >> "$OUTPUT_FILE" << 'EOF'
  }

  .app-wrapper-web.app-wrapper-web,
  .app-wrapper-web.app-wrapper-web:root {
    #apply-theme(@theme);
  }

  :root:has(> .dark),
  .dark.color-refresh,
  .color-refresh.dark,
  .dark .app-wrapper-web.app-wrapper-web,
  .dark .app-wrapper-web.app-wrapper-web:root {
    #apply-theme(@theme);
  }
}
EOF

  log_success "✓ Generated: $OUTPUT_FILE"
}

main() {
  case "$SERVICE" in
    github) generate_github ;;
    youtube) generate_youtube ;;
    chatgpt) generate_chatgpt ;;
    nixos-search) generate_nixos_search ;;
    devdocs) generate_devdocs ;;
    startpage) generate_startpage ;;
    brave-search) generate_brave_search ;;
    mdn) generate_mdn ;;
    claude) generate_claude_userstyle ;;
    crates.io) generate_crates_io ;;
    docs.rs) generate_docs_rs ;;
    react.dev) generate_react_dev ;;
    perplexity) generate_perplexity ;;
    mastodon) generate_mastodon ;;
    reddit) generate_reddit ;;
    pypi) generate_pypi ;;
    stackoverflow) generate_stackoverflow ;;
    google) generate_google ;;
    gmail) generate_gmail ;;
    google-drive) generate_google_drive ;;
    google-photos) generate_google_photos ;;
    google-gemini) generate_google_gemini ;;
    spotify-web) generate_spotify_web ;;
    linkedin) generate_linkedin ;;
    bsky) generate_bsky ;;
    instagram) generate_instagram ;;
    twitter) generate_twitter ;;
    npm) generate_npm ;;
    twitch) generate_twitch ;;
    go.dev) generate_go_dev ;;
    duckduckgo) generate_duckduckgo ;;
    whatsapp-web) generate_whatsapp_web ;;
    all)
      generate_github || true
      generate_youtube || true
      generate_chatgpt || true
      generate_nixos_search || true
      generate_devdocs || true
      generate_startpage || true
      generate_brave_search || true
      generate_mdn || true
      generate_claude_userstyle || true
      generate_crates_io || true
      generate_docs_rs || true
      generate_react_dev || true
      generate_perplexity || true
      generate_mastodon || true
      generate_reddit || true
      generate_pypi || true
      generate_stackoverflow || true
      generate_google || true
      generate_gmail || true
      generate_google_drive || true
      generate_google_photos || true
      generate_google_gemini || true
      generate_spotify_web || true
      generate_linkedin || true
      generate_bsky || true
      generate_instagram || true
      generate_twitter || true
      generate_npm || true
      generate_twitch || true
      generate_go_dev || true
      generate_duckduckgo || true
      generate_whatsapp_web || true
      ;;
    *)
      log_error "Unknown service: $SERVICE"
      log_info "Available services:"
      log_info "  github, youtube, chatgpt, nixos-search, devdocs, startpage,"
      log_info "  brave-search, mdn, claude, crates.io, docs.rs, react.dev,"
      log_info "  perplexity, mastodon, reddit, pypi, stackoverflow, google,"
      log_info "  gmail, google-drive, google-photos, google-gemini, spotify-web,"
      log_info "  linkedin, bsky, instagram, twitter, npm, twitch, go.dev,"
      log_info "  duckduckgo, whatsapp-web, all"
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
