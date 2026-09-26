# wezterm: ~/.config/wezterm is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.wezterm.source = config.lib.dotfiles.link "home/shared/wezterm/config";
}
