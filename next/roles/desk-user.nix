# desk-user: someone sits at this machine — GUI apps, fonts, media tools.
{ config, lib, ... }:
lib.mkIf config.dotfiles.roles.desk-user.enable {
  dotfiles.packages.desktop.enable = true;
}
