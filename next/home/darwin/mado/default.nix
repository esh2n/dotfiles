# mado: ~/.config/mado is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.mado.source = config.lib.dotfiles.link "next/home/darwin/mado/config";
}
