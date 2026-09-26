# Packages, by kind; roles turn the kinds on (roles). base is on for every
# machine; dev and desktop by role.
{ lib, ... }:
{
  imports = [
    ./base.nix
    ./dev.nix
    ./desktop.nix
    ./lsp.nix
  ];

  options.dotfiles.packages = lib.genAttrs [ "base" "dev" "desktop" ] (kind: {
    enable = lib.mkEnableOption "the ${kind} packages";
  });
}
