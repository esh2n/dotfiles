# App config directories linked under ~/.config on every platform. One table
# while the contents still live in domains/; each app becomes its own
# directory under home/ (module and contents together) when its contents move.
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  dirs = {
    litellm = "next/home/shared/litellm/config";
    sbx = "next/home/shared/sbx/config";
  };
in
{
  xdg.configFile = lib.mapAttrs (_: path: { source = link path; }) dirs;
}
