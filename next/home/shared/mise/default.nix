# mise withdraws trust whenever its config changes, and this checkout changes
# it: trust is renewed on every switch, before make up runs mise install.
# ~/.config/mise is a link to config/ beside this file (config.toml is
# rendered there from config.toml.template).
{ config, ... }:
{
  xdg.configFile.mise.source = config.lib.dotfiles.link "next/home/shared/mise/config";
  dotfiles.setup.mise-trust.command = config.lib.dotfiles.setupStep "mise-trust";
}
