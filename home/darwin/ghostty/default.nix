# ghostty on macOS: the platform part (cmd keybinds, window chrome) and the
# theme pointer that dotctl theme set moves (pkgs/dotctl/internal/theme).
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  xdg.configFile."ghostty/platform".source = link "home/darwin/ghostty/platform";
  xdg.configFile."ghostty/theme".source = link "home/darwin/ghostty/theme";
}
