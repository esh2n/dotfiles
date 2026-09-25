# Stylus's userstyles (macOS browsers), generated for every theme in the
# checkout. The extensions themselves are declared in system/darwin/browsers.nix.
{ config, ... }:
{
  dotfiles.setup.userstyles.command = config.lib.dotfiles.setupStep "userstyles";
}
