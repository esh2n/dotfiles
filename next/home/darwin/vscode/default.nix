# VS Code: ~/.config/vscode is a link to config/ beside this file, and VS Code
# reads its settings from Application Support, linked to the settings.json
# rendered in config/ from settings.json.template.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  xdg.configFile.vscode.source = link "next/home/darwin/vscode/config";
  home.file."Library/Application Support/Code/User/settings.json".source =
    link "next/home/darwin/vscode/config/settings.json";
}
