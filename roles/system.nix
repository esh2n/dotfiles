# The roles as nix-darwin (the system evaluation) sees them: the interface,
# and what each role switches on at the system level — Homebrew's kinds
# (system/darwin/homebrew.nix). What the roles switch on in the home lives
# in the role modules beside this file (./default.nix).
{ config, ... }:
let
  on = role: config.dotfiles.roles.${role}.enable;
in
{
  imports = [ ./options.nix ];

  dotfiles.homebrew = {
    dev.enable = on "developer";
    desktop.enable = on "desk-user";
    models.enable = on "model-provider";
  };
}
