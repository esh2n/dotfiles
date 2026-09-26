# sbx (Docker Sandboxes): ~/.config/sbx is a link to config/ beside this file
# — the kits jig box renders at launch, and their README.
{ config, ... }:
{
  xdg.configFile.sbx.source = config.lib.dotfiles.link "home/shared/sbx/config";
}
