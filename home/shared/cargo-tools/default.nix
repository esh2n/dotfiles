# Tools only published as cargo git installs.
{ config, ... }:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  dotfiles.setup.pacifica.command = setup "pacifica";
}
