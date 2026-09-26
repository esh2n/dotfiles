# hammerspoon: ~/.config/hammerspoon is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.hammerspoon.source = config.lib.dotfiles.link "home/darwin/hammerspoon/config";
}
