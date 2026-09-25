{ config, ... }:
{
  home.file.".crit.config.json".source =
    config.lib.dotfiles.link "next/home/shared/crit/crit.config.json";
}
