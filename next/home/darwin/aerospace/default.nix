# aerospace: ~/.config/aerospace is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.aerospace.source = config.lib.dotfiles.link "next/home/darwin/aerospace/config";
}
