# The macOS system itself: who owns it and how Nix runs on it.
{ facts, ... }:
{
  system.primaryUser = facts.username;

  ids.gids.nixbld = 350;

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  system.stateVersion = 4;
}
