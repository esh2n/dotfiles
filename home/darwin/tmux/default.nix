# tmux (macOS; Omarchy owns tmux on Linux): ~/.config/tmux is a link to
# config/ beside this file, and its plugins load through TPM.
{ config, ... }:
{
  xdg.configFile.tmux.source = config.lib.dotfiles.link "home/darwin/tmux/config";
  dotfiles.setup.tpm.command = config.lib.dotfiles.setupStep "tpm";
}
