# Omarchy's shell (bar, menu, lock screen): the bar is changed through
# Omarchy's own `omarchy bar` commands, listed in ./bar, never by owning
# ~/.config/omarchy/shell.json.
{ config, ... }:
{
  dotfiles.setup.omarchy-bar.command = config.lib.dotfiles.setupStep "omarchy-bar";
}
