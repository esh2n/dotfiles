# serena reads ~/.serena, a link to config/ beside this file (serena_config.yml
# is rendered there from its template; serena keeps its logs there too).
{ config, ... }:
{
  home.file.".serena".source = config.lib.dotfiles.link "home/shared/serena/config";
}
