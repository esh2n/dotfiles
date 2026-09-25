# Personal commands in ~/bin that only work on macOS (osascript, defaults,
# desktoppr, the macOS window managers).
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  commands = {
    install-extensions = "domains/dev/bin/install-extensions";
    "orca-theme-apply.py" = "domains/system/bin/orca-theme-apply.py";
    wallpaper = "domains/creative/bin/wallpaper";
  };
in
{
  home.file = lib.mapAttrs' (
    name: path: lib.nameValuePair "bin/${name}" { source = link path; }
  ) commands;
}
