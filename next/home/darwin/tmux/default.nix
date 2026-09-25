# tmux (macOS; Omarchy owns tmux on Linux): its plugins load through TPM.
{ config, ... }:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  dotfiles.setup.tpm.command = setup "tpm";
}
