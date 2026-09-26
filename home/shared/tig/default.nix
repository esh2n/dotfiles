{ config, ... }:
{
  home.file.".tigrc".source = config.lib.dotfiles.link "home/shared/tig/tigrc";
}
