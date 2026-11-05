# Herdr's desktop app (the cask is in system/darwin/homebrew.nix). Linked file
# by file, not as a directory: ~/.config/herdr-app also holds what the app
# rewrites on every start (its guide, icons, shipped mods, socket, telemetry).
# The app writes through these links. Its file watcher does not follow them:
# an edit made here to settings.json applies within about 10 s, through the
# app's poll (herdrdev/herdr-app#65), and a theme edit applies on restart.
# keys.json and layouts stay unmanaged for now.
#
# Separate from the terminal herdr (home/darwin/herdr, home/shared/herdr): the
# two run on different servers and share no sessions or settings.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  xdg.configFile."herdr-app/settings.json".source = link "home/darwin/herdr-app/settings.json";
  xdg.configFile."herdr-app/themes/catppuccin.json".source =
    link "home/darwin/herdr-app/themes/catppuccin.json";
}
