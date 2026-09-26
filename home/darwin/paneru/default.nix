# paneru: ~/.config/paneru is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.paneru.source = config.lib.dotfiles.link "home/darwin/paneru/config";
}
