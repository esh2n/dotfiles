#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Unified Userstyle Generator v2 (Catppuccin-style variable interpolation)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERSTYLES_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATES_DIR="$USERSTYLES_DIR/templates"
GEN_DIR="$USERSTYLES_DIR/gen"
OUTPUT_FILE="$GEN_DIR/github.user.less"
DOTFILES_ROOT="$(cd "$USERSTYLES_DIR/../../.." && pwd)"

source "$DOTFILES_ROOT/core/utils/common.sh"

main() {
  log_info "Generating unified userstyle with variable interpolation..."

  # Generate header
  cat > "$OUTPUT_FILE" << 'EOF'
/* ==UserStyle==
@name GitHub 10-Themes
@namespace github.com/esh2n/dotfiles
@homepageURL https://github.com/esh2n/dotfiles
@version 4.0.0
@description GitHub multi-theme switcher with 10 themes
@author esh2n
@license MIT

@preprocessor less
@var select theme "Theme" ["catppuccin:Catppuccin*", "nord:Nord", "tokyonight:Tokyo Night", "dracula:Dracula", "gruvbox:Gruvbox", "kanagawa:Kanagawa", "onedark:OneDark", "rosepine:Rosé Pine", "solarized:Solarized", "everforest:Everforest"]
==/UserStyle== */

// Theme color definitions (Catppuccin-style)
@themes: {
  @catppuccin: { @base: #1e1e2e; @mantle: #181825; @crust: #11111b; @text: #cdd6f4; @subtext1: #bac2de; @subtext0: #a6adc8; @overlay2: #9399b2; @overlay1: #7f849c; @overlay0: #6c7086; @surface2: #585b70; @surface1: #45475a; @surface0: #313244; @red: #f38ba8; @green: #a6e3a1; @blue: #89b4fa; @yellow: #f9e2af; @peach: #fab387; @mauve: #cba6f7; @pink: #f5c2e7; @teal: #94e2d5; @sky: #89dceb; @sapphire: #74c7ec; @lavender: #b4befe; @accent: #cba6f7; };
  @nord: { @base: #2e3440; @mantle: #2e3440; @crust: #2e3440; @text: #eceff4; @subtext1: #e5e9f0; @subtext0: #d8dee9; @overlay2: #8fbcbb; @overlay1: #81a1c1; @overlay0: #5e81ac; @surface2: #434c5e; @surface1: #3b4252; @surface0: #2e3440; @red: #bf616a; @green: #a3be8c; @blue: #81a1c1; @yellow: #ebcb8b; @peach: #d08770; @mauve: #b48ead; @pink: #b48ead; @teal: #8fbcbb; @sky: #88c0d0; @sapphire: #81a1c1; @lavender: #5e81ac; @accent: #88c0d0; };
  @tokyonight: { @base: #1a1b26; @mantle: #16161e; @crust: #16161e; @text: #c0caf5; @subtext1: #a9b1d6; @subtext0: #9aa5ce; @overlay2: #565f89; @overlay1: #414868; @overlay0: #24283b; @surface2: #414868; @surface1: #24283b; @surface0: #1a1b26; @red: #f7768e; @green: #9ece6a; @blue: #7aa2f7; @yellow: #e0af68; @peach: #ff9e64; @mauve: #9d7cd8; @pink: #bb9af7; @teal: #73daca; @sky: #7dcfff; @sapphire: #7aa2f7; @lavender: #b4f9f8; @accent: #7aa2f7; };
  @dracula: { @base: #282a36; @mantle: #21222c; @crust: #191a21; @text: #f8f8f2; @subtext1: #e0e0e0; @subtext0: #bfbfbf; @overlay2: #6272a4; @overlay1: #44475a; @overlay0: #383a59; @surface2: #44475a; @surface1: #383a59; @surface0: #282a36; @red: #ff5555; @green: #50fa7b; @blue: #bd93f9; @yellow: #f1fa8c; @peach: #ffb86c; @mauve: #bd93f9; @pink: #ff79c6; @teal: #8be9fd; @sky: #8be9fd; @sapphire: #6272a4; @lavender: #ff79c6; @accent: #bd93f9; };
  @everforest: { @base: #2e383c; @mantle: #272e33; @crust: #1e2326; @text: #d3c6aa; @subtext1: #c9c0a8; @subtext0: #9da9a0; @overlay2: #859289; @overlay1: #5c6a72; @overlay0: #4f5b58; @surface2: #4f5b58; @surface1: #3d484d; @surface0: #2e383c; @red: #e67e80; @green: #a7c080; @blue: #7fbbb3; @yellow: #dbbc7f; @peach: #e69875; @mauve: #d699b6; @pink: #d699b6; @teal: #83c092; @sky: #7fbbb3; @sapphire: #7fbbb3; @lavender: #d699b6; @accent: #a7c080; };
  @gruvbox: { @base: #282828; @mantle: #1d2021; @crust: #1d2021; @text: #ebdbb2; @subtext1: #d5c4a1; @subtext0: #bdae93; @overlay2: #665c54; @overlay1: #504945; @overlay0: #3c3836; @surface2: #504945; @surface1: #3c3836; @surface0: #282828; @red: #cc241d; @green: #b8bb26; @blue: #83a598; @yellow: #fabd2f; @peach: #fe8019; @mauve: #d3869b; @pink: #d3869b; @teal: #8ec07c; @sky: #83a598; @sapphire: #458588; @lavender: #b16286; @accent: #d79921; };
  @kanagawa: { @base: #1f1f28; @mantle: #16161d; @crust: #16161d; @text: #dcd7ba; @subtext1: #c8c093; @subtext0: #a6a69c; @overlay2: #727169; @overlay1: #54546d; @overlay0: #2a2a37; @surface2: #54546d; @surface1: #2a2a37; @surface0: #1f1f28; @red: #c34043; @green: #76946a; @blue: #7e9cd8; @yellow: #c0a36e; @peach: #ffa066; @mauve: #957fb8; @pink: #d27e99; @teal: #7aa89f; @sky: #7fb4ca; @sapphire: #7e9cd8; @lavender: #938aa9; @accent: #7e9cd8; };
  @onedark: { @base: #282c34; @mantle: #21252b; @crust: #1c1f24; @text: #abb2bf; @subtext1: #b6bdca; @subtext0: #828997; @overlay2: #5c6370; @overlay1: #4b5263; @overlay0: #3e4452; @surface2: #4b5263; @surface1: #3e4452; @surface0: #282c34; @red: #e06c75; @green: #98c379; @blue: #61afef; @yellow: #e5c07b; @peach: #d19a66; @mauve: #c678dd; @pink: #c678dd; @teal: #56b6c2; @sky: #56b6c2; @sapphire: #61afef; @lavender: #c678dd; @accent: #61afef; };
  @rosepine: { @base: #191724; @mantle: #1f1d2e; @crust: #191724; @text: #e0def4; @subtext1: #908caa; @subtext0: #6e6a86; @overlay2: #524f67; @overlay1: #403d52; @overlay0: #26233a; @surface2: #403d52; @surface1: #26233a; @surface0: #1f1d2e; @red: #eb6f92; @green: #31748f; @blue: #31748f; @yellow: #f6c177; @peach: #f6c177; @mauve: #c4a7e7; @pink: #ebbcba; @teal: #9ccfd8; @sky: #9ccfd8; @sapphire: #31748f; @lavender: #c4a7e7; @accent: #c4a7e7; };
  @solarized: { @base: #002b36; @mantle: #001e26; @crust: #00141a; @text: #839496; @subtext1: #93a1a1; @subtext0: #657b83; @overlay2: #586e75; @overlay1: #073642; @overlay0: #002b36; @surface2: #073642; @surface1: #002b36; @surface0: #002b36; @red: #dc322f; @green: #859900; @blue: #268bd2; @yellow: #b58900; @peach: #cb4b16; @mauve: #6c71c4; @pink: #d33682; @teal: #2aa198; @sky: #2aa198; @sapphire: #268bd2; @lavender: #6c71c4; @accent: #268bd2; };
};

@-moz-document regexp("https://github\\.com(?!(/home$|/features($|/.*)|/organizations/plan)).*$"),
  domain("gist.github.com"),
  domain("docs.github.com"),
  domain("viewscreen.githubusercontent.com") {

  #apply-theme(@theme) {
    // Extract colors using variable interpolation
    @base: @themes[@@theme][@base];
    @mantle: @themes[@@theme][@mantle];
    @crust: @themes[@@theme][@crust];
    @text: @themes[@@theme][@text];
    @subtext1: @themes[@@theme][@subtext1];
    @subtext0: @themes[@@theme][@subtext0];
    @overlay2: @themes[@@theme][@overlay2];
    @overlay1: @themes[@@theme][@overlay1];
    @overlay0: @themes[@@theme][@overlay0];
    @surface2: @themes[@@theme][@surface2];
    @surface1: @themes[@@theme][@surface1];
    @surface0: @themes[@@theme][@surface0];
    @red: @themes[@@theme][@red];
    @green: @themes[@@theme][@green];
    @blue: @themes[@@theme][@blue];
    @yellow: @themes[@@theme][@yellow];
    @peach: @themes[@@theme][@peach];
    @mauve: @themes[@@theme][@mauve];
    @pink: @themes[@@theme][@pink];
    @teal: @themes[@@theme][@teal];
    @sky: @themes[@@theme][@sky];
    @sapphire: @themes[@@theme][@sapphire];
    @lavender: @themes[@@theme][@lavender];
    @accent: @themes[@@theme][@accent];

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
  sed -n '/Calendar & Contribution Graph/,$ {
    /Calendar & Contribution Graph/d
    /--color-calendar-graph-day-bg/d
    /--color-calendar-graph-day-border/d
    /--color-calendar-graph-day-L1-bg/d
    /--color-calendar-graph-day-L2-bg/d
    /--color-calendar-graph-day-L3-bg/d
    /--color-calendar-graph-day-L4-bg/d
    p
  }' "$TEMPLATES_DIR/github.user.less" | sed '$ d' | sed '$ d' | sed 's/^/    /' >> "$OUTPUT_FILE"

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
  log_info ""
  log_info "Next steps:"
  log_info "  1. Run: bash scripts/generate-import-json.sh"
  log_info "  2. Import github-10-themes.stylus.json into Stylus"
  log_info ""
}

main "$@"
