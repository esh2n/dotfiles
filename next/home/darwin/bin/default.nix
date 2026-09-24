# Personal commands in ~/bin that only work on macOS (osascript, defaults,
# desktoppr, the macOS window managers, the macOS-only codebase-memory-mcp).
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  commands = {
    codebase-memory-mcp-managed = "domains/dev/bin/codebase-memory-mcp-managed";
    install-extensions = "domains/dev/bin/install-extensions";
    theme-switch = "domains/system/bin/theme-switch";
    "orca-theme-apply.py" = "domains/system/bin/orca-theme-apply.py";
    mado = "domains/workspace/bin/mado";
    wallpaper = "domains/creative/bin/wallpaper";
  };
in
{
  home.file = lib.mapAttrs' (name: path: lib.nameValuePair "bin/${name}" { source = link path; }) commands;
}
