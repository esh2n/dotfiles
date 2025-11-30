{ pkgs, ... }: {
  # Fonts from nixpkgs
  home.packages = with pkgs; [
    jetbrains-mono
    nerd-fonts.jetbrains-mono
    nerd-fonts.hack
  ];
}
