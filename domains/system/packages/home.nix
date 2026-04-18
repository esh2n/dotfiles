{ pkgs, ... }: {
  # System packages
  home.packages = with pkgs; [
    # Fonts
    jetbrains-mono
    nerd-fonts.jetbrains-mono
    nerd-fonts.hack

    # Userstyles generation
    lessc  # LESS compiler for userstyles templates
    jq  # JSON processor for Stylus import.json generation
  ];
}
