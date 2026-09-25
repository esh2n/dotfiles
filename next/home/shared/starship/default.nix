# starship: ~/.config/starship is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.starship.source = config.lib.dotfiles.link "next/home/shared/starship/config";
}
