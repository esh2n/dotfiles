# paneru: ~/.config/paneru is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.paneru.source = config.lib.dotfiles.link "next/home/darwin/paneru/config";
}
