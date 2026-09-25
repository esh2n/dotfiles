# mise withdraws trust whenever its config changes, and this checkout changes
# it: trust is renewed on every switch, before make up runs mise install.
{ config, ... }:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  dotfiles.setup.mise-trust.command = setup "mise-trust";
}
