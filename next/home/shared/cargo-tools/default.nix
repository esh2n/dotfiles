# Tools only published as cargo git installs.
{ config, ... }:
let
  setup = config.lib.dotfiles.devSetup;
in
{
  dotfiles.setup.pacifica.command = setup "pacifica";
}
