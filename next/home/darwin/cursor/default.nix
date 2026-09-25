# cursor: ~/.config/cursor is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.cursor.source = config.lib.dotfiles.link "next/home/darwin/cursor/config";
}
