# omniwm: ~/.config/omniwm is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.omniwm.source = config.lib.dotfiles.link "home/darwin/omniwm/config";
}
