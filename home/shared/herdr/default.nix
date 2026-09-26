# herdr: ~/.config/herdr is a link to config/ beside this file, on both OS.
# On Omarchy it replaces the config Omarchy seeds; `omarchy-refresh-herdr`
# would copy Omarchy's back over it, into the checkout: do not run it.
{ config, ... }:
{
  xdg.configFile.herdr.source = config.lib.dotfiles.link "home/shared/herdr/config";
}
