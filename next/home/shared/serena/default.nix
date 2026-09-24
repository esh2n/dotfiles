# serena reads ~/.serena (its config is rendered from a template, see
# home/shared/templated).
{ config, ... }:
{
  home.file.".serena".source = config.lib.dotfiles.link "domains/dev/config/serena";
}
