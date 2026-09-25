# jj: ~/.config/jj is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.jj.source = config.lib.dotfiles.link "next/home/shared/jj/config";
}
