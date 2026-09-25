{ config, ... }:
{
  home.file.".tigrc".source = config.lib.dotfiles.link "next/home/shared/tig/tigrc";
}
