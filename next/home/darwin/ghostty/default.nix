# ghostty: ~/.config/ghostty is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.ghostty.source = config.lib.dotfiles.link "next/home/darwin/ghostty/config";
}
