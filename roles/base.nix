# base: every machine. Always on, with or without a roles file (roles/options.nix).
{ config, lib, ... }:
lib.mkIf config.dotfiles.roles.base.enable {
  dotfiles.packages.base.enable = true;
}
