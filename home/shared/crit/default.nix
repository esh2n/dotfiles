{ config, ... }:
{
  home.file.".crit.config.json".source = config.lib.dotfiles.link "home/shared/crit/crit.config.json";
}
