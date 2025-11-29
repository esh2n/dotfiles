{ pkgs, ... }: {
  # Fonts from nixpkgs
  home.packages = with pkgs; [
    jetbrains-mono
    (nerdfonts.override { fonts = [ "JetBrainsMono" "Hack" ]; })
  ];
}

