# capsule: ~/.config/capsule is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.capsule.source = config.lib.dotfiles.link "home/shared/capsule/config";
}
