# zed: ~/.config/zed is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.zed.source = config.lib.dotfiles.link "next/home/shared/zed/config";
}
