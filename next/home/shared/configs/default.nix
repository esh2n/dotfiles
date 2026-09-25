# App config directories linked under ~/.config on every platform. One table
# while the contents still live in domains/; each app becomes its own
# directory under home/ (module and contents together) when its contents move.
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  dirs = {
    nvim-lazyvim = "domains/dev/config/nvim-lazyvim";
    nvim-nvchad = "domains/dev/config/nvim-nvchad";
    nvim-astrovim = "domains/dev/config/nvim-astrovim";
    nvim-custom = "domains/dev/config/nvim-custom";
    wezterm = "domains/dev/config/wezterm";
    themes = "domains/system/config/themes";
    litellm = "domains/dev/config/litellm";
    sbx = "domains/dev/config/sbx";
  };
in
{
  xdg.configFile = lib.mapAttrs (_: path: { source = link path; }) dirs;
}
