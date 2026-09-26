# ghostty on Linux: the platform part only; the colours come from Omarchy's
# current theme, which the platform file includes.
{ config, ... }:
{
  xdg.configFile."ghostty/platform".source = config.lib.dotfiles.link "home/linux/ghostty/platform";
}
