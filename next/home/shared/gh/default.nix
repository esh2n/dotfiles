# gh: extensions are gh's own state; missing ones are installed, installed
# ones are never upgraded behind the owner's back.
{ config, ... }:
let
  setup = config.lib.dotfiles.devSetup;
in
{
  dotfiles.setup.gh-extensions.command = setup "gh-extensions";
}
