# Neovim: the distributions are linked (home/shared/configs); on a new
# machine ~/.config/nvim starts as LazyVim (nvim-switch picks another).
{ config, ... }:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  dotfiles.setup.nvim-default.command = setup "nvim-default";
}
