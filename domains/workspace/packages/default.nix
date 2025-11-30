{ pkgs, ... }: {
  home.packages = with pkgs; [
    # Core Unix Tools
    coreutils
    moreutils
    findutils
    gnused  # gnu-sed
    gnugrep  # grep

    # Mac Tools
    mas
    trash-cli  # trash

    # UI Customization (if available in nixpkgs)
    # sketchybar  # May need to use homebrew
    # borders  # May need to use homebrew
  ];

  # Homebrew formulas (not in nixpkgs or need macOS specific version)
  homebrew.brews = [
    "sketchybar"
    "borders"
  ];

  # GUI Apps (Homebrew casks)
  homebrew.casks = [
    # Knowledge
    "notion"
    "obsidian"

    # Communication
    "slack"
    "discord"
    "zoom"

    # System
    "raycast"
    "1password"
    "karabiner-elements"
    "aerospace"
    "hammerspoon"

    # Utilities
    "dropover"
    "paste"
    "displaylink"
    "marta"
    "klack"

    # Fonts
    "font-jetbrains-mono-nerd-font"
    "font-hack-nerd-font"
    "font-sf-mono"
  ];
}
