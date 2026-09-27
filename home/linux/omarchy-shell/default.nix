# Omarchy's shell (bar, menu, lock screen): the bar is changed through
# Omarchy's own `omarchy bar` commands, listed in ./bar, never by owning
# ~/.config/omarchy/shell.json. Themes from git are listed in ./themes and
# installed once, on a machine that lacks them.
{ config, ... }:
{
  dotfiles.setup.omarchy-bar.command = config.lib.dotfiles.setupStep "omarchy-bar";
  dotfiles.setup.omarchy-themes.command = config.lib.dotfiles.setupStep "omarchy-themes";
}
