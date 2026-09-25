# desktop: a machine used at a desk — GUI apps, fonts, media tools.
{ config, lib, ... }:
lib.mkIf config.dotfiles.roles.desktop.enable {
  dotfiles.packages.desktop.enable = true;
}
