# jj: ~/.config/jj is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.jj.source = config.lib.dotfiles.link "home/shared/jj/config";
}
