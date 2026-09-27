# Hyprland on Omarchy: only the override files the owner changed are links
# into the checkout; Omarchy keeps the rest. `omarchy refresh hyprland`
# copies its templates over these with `cp -f`, which writes through the
# link into the checkout: do not run it (git diff shows it if it happens).
{ config, ... }:
{
  xdg.configFile."hypr/looknfeel.lua".source = config.lib.dotfiles.link "home/linux/hypr/looknfeel.lua";
}
