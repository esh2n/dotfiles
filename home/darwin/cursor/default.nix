# cursor: ~/.config/cursor is a link to config/ beside this file, and Cursor
# reads its settings from Application Support, linked to the settings.json in
# config/.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  xdg.configFile.cursor.source = link "home/darwin/cursor/config";
  home.file."Library/Application Support/Cursor/User/settings.json" = {
    source = link "home/darwin/cursor/config/settings.json";
    # The old layout's link was there before this module.
    force = true;
  };
  dotfiles.zsh.snippets.cursor = "home/darwin/cursor/cursor.zsh";
}
