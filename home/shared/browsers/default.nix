# Browsers: ~/.config/browsers is a link to config/ beside this file (the
# extension list, Text Blaze snippets), and Stylus's userstyles are
# generated for every theme in the checkout. The extensions themselves are
# installed per OS from config/extensions.json: system/darwin/browsers.nix
# (Chrome and Dia) and home/linux/browsers (Omarchy's Chromium).
{ config, ... }:
{
  xdg.configFile.browsers.source = config.lib.dotfiles.link "home/shared/browsers/config";
  dotfiles.setup.userstyles.command = config.lib.dotfiles.setupStep "userstyles";
}
