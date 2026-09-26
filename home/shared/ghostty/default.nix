# ghostty: the shared config and shaders, each a link into this directory.
# The config ends with `config-file = platform`, which the OS's own module
# places (home/darwin/ghostty, home/linux/ghostty).
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  xdg.configFile."ghostty/config".source = link "home/shared/ghostty/config";
  xdg.configFile."ghostty/shaders".source = link "home/shared/ghostty/shaders";
}
