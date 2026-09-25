# App config directories linked under ~/.config on the Mac only: the macOS
# window-management set, macOS-only apps, and the apps whose ~/.config path
# Omarchy owns on Linux (ghostty, tmux, herdr, git — see home/linux/git).
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  dirs = {
    git = "domains/dev/config/git";
  };
in
{
  xdg.configFile = lib.mapAttrs (_: path: { source = link path; }) dirs;
}
