# macOS apps whose config lives outside ~/.config, or in two places.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  home.file = {
    ".warp".source = link "domains/dev/config/warp";
    ".orca".source = link "domains/dev/config/orca";
    # VS Code reads its settings from Application Support; the rendered
    # settings.json lives in the checkout (see home/shared/templated).
    "Library/Application Support/Code/User/settings.json".source =
      link "domains/dev/config/vscode/settings.json";
  };

  xdg.configFile = {
    vscode.source = link "domains/dev/config/vscode";
    cursor.source = link "domains/dev/config/cursor";
  };
}
