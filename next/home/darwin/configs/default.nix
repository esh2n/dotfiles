# App config directories linked under ~/.config on the Mac only: the macOS
# window-management set, macOS-only apps, and the apps whose ~/.config path
# Omarchy owns on Linux (ghostty, tmux, herdr, git — see home/linux/git).
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  dirs = {
    git = "domains/dev/config/git";
    ghostty = "domains/dev/config/ghostty";
    tmux = "domains/dev/config/tmux";
    herdr = "domains/dev/config/herdr";
    lmstudio = "domains/dev/config/lmstudio";
    browsers = "domains/system/config/browsers";
    aerospace = "domains/workspace/config/aerospace";
    borders = "domains/workspace/config/borders";
    hammerspoon = "domains/workspace/config/hammerspoon";
    mado = "domains/workspace/config/mado";
    omniwm = "domains/workspace/config/omniwm";
    paneru = "domains/workspace/config/paneru";
    sketchybar = "domains/workspace/config/sketchybar";
  };
in
{
  xdg.configFile = lib.mapAttrs (_: path: { source = link path; }) dirs;
}
