# tmux (macOS; Omarchy owns tmux on Linux): its plugins load through TPM.
{ config, ... }:
let
  setup = config.lib.dotfiles.devSetup;
in
{
  dotfiles.setup.tpm.command = setup "tpm";
}
