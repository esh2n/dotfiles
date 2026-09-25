# herdr: ~/.config/herdr is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.herdr.source = config.lib.dotfiles.link "next/home/darwin/herdr/config";
}
