{ config, ... }:
{
  home.file.".crit.config.json".source = config.lib.dotfiles.link "domains/dev/home/.crit.config.json";
}
