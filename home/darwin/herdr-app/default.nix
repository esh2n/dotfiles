# Herdr's desktop app (the cask is in system/darwin/homebrew.nix). Linked file
# by file, not as a directory: ~/.config/herdr-app also holds what the app
# rewrites on every start (its guide, icons, shipped mods, socket, telemetry).
# The app writes through these links. Its file watcher does not follow them:
# an edit made here to settings.json applies within about 10 s, through the
# app's poll (herdrdev/herdr-app#65); a theme edit applies on restart or on
# dotctl theme set, which touches settings.json.
# keys.json takes no new default keys from the app once edited: compare it
# with upstream's defaults/keys.macos.json on an update. A mod edit applies on
# restart. The layout reset moves keys.json aside; make up puts it back.
#
# Separate from the terminal herdr (home/darwin/herdr, home/shared/herdr): the
# two run on different servers and share no sessions or settings.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
  files = [
    "settings.json"
    "keys.json"
    # dotctl theme set moves the link this one points at
    "themes/current.json"
    # file by file: the app writes its type files into each mod's folder
    "mods/prefix/main.js"
    "mods/prefix/bindings.js"
    "mods/prefix/mod.json"
    "mods/prefix/package.json"
  ];
in
{
  xdg.configFile = builtins.listToAttrs (
    map (f: {
      name = "herdr-app/${f}";
      value.source = link "home/darwin/herdr-app/${f}";
    }) files
  );
}
