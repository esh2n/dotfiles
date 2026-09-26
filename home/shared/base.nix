# What every home has: identity from facts, home-manager itself, direnv.
{ lib, facts, ... }:
{
  home.stateVersion = "24.05";
  home.username = facts.username;
  home.homeDirectory = lib.mkForce facts.home;
  programs.home-manager.enable = true;

  programs.direnv = {
    enable = true;
    enableZshIntegration = true;
    nix-direnv.enable = true;
  };
}
