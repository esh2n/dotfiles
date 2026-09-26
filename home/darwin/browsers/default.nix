# Browsers on the Mac: ~/.config/browsers is a link to config/ beside this
# file (the extension list, Text Blaze snippets), and Stylus's userstyles are
# generated for every theme in the checkout. The extensions themselves are
# declared in system/darwin/browsers.nix, from config/extensions.json.
{ config, ... }:
{
  xdg.configFile.browsers.source = config.lib.dotfiles.link "home/darwin/browsers/config";
  dotfiles.setup.userstyles.command = config.lib.dotfiles.setupStep "userstyles";
}
