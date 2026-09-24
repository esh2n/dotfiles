# zellij plugins: two prebuilt downloads, and harpoon built against the
# installed zellij's plugin API.
{ config, ... }:
let
  setup = config.lib.dotfiles.devSetup;
in
{
  dotfiles.setup.zellij-plugins.command = setup "zellij-plugins";
  dotfiles.setup.zellij-harpoon.command = setup "zellij-harpoon";
}
