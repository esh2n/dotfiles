# borders: ~/.config/borders is a link to config/ beside this file.
{ config, ... }:
{
  xdg.configFile.borders.source = config.lib.dotfiles.link "home/darwin/borders/config";
  dotfiles.zsh.snippets.borders = "home/darwin/borders/borders.zsh";
}
