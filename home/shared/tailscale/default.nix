# tailscale: ~/.config/tailscale is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.tailscale.source = config.lib.dotfiles.link "home/shared/tailscale/config";
}
