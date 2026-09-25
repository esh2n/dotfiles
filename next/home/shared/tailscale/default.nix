# tailscale: ~/.config/tailscale is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.tailscale.source = config.lib.dotfiles.link "next/home/shared/tailscale/config";
}
