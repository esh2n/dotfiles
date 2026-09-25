# zsh: the login and interactive entry points, and the fragments .zshrc
# reads from beside them (rc/: helpers, aliases, options, functions,
# integrations, keybindings, editors, brew). All links into the checkout, so
# an edit takes effect in the next shell.
# capsule, the prompt, answers from a daemon it registers itself.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  dotfiles.setup.capsule-daemon.command = config.lib.dotfiles.setupStep "capsule-daemon";

  home.file = {
    ".zshenv".source = link "next/home/shared/zsh/zshenv";
    ".zprofile".source = link "next/home/shared/zsh/zprofile";
    ".zshrc".source = link "next/home/shared/zsh/zshrc";
  };
}
