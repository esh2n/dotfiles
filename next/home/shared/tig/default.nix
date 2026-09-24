{ config, ... }:
{
  home.file.".tigrc".source = config.lib.dotfiles.link "domains/dev/home/.tigrc";
}
