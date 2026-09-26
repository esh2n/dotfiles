# borders: ~/.config/borders is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.borders.source = config.lib.dotfiles.link "home/darwin/borders/config";
}
