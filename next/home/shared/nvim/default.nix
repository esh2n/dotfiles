# Neovim: each distribution beside this file (lazyvim/, nvchad/, astrovim/,
# custom/) is linked as ~/.config/nvim-<name>; ~/.config/nvim points at one
# of them (`dotctl nvim <name>`), LazyVim on a new machine.
{ config, lib, ... }:
{
  xdg.configFile = lib.listToAttrs (
    map
      (
        d: lib.nameValuePair "nvim-${d}" { source = config.lib.dotfiles.link "next/home/shared/nvim/${d}"; }
      )
      [
        "lazyvim"
        "nvchad"
        "astrovim"
        "custom"
      ]
  );
  dotfiles.setup.nvim-default.command = config.lib.dotfiles.setupStep "nvim-default";
}
