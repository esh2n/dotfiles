# sketchybar: ~/.config/sketchybar is a link to config/ beside this file. Its
# config is Lua and needs SbarLua, built against mise's lua and rebuilt when
# that Lua changes (dotctl setup sbarlua).
{ config, ... }:
{
  xdg.configFile.sketchybar.source = config.lib.dotfiles.link "next/home/darwin/sketchybar/config";
  dotfiles.setup.sbarlua.command = config.lib.dotfiles.setupStep "sbarlua";
}
