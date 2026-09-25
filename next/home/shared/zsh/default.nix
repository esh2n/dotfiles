# zsh: the login and interactive entry points. The shell's own layout
# (functions, aliases, completion) is read from the checkout by .zshrc.
# capsule, the prompt, answers from a daemon it registers itself.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  dotfiles.setup.capsule-daemon.command = config.lib.dotfiles.setupStep "capsule-daemon";

  home.file = {
    ".zshenv".source = link "domains/dev/home/.zshenv";
    ".zprofile".source = link "domains/dev/home/.zprofile";
    ".zshrc".source = link "domains/dev/home/.zshrc";
  };
}
