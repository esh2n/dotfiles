# zsh: the login and interactive entry points. The shell's own layout
# (functions, aliases, completion) is read from the checkout by .zshrc.
{ config, ... }:
let
  link = config.lib.dotfiles.link;
in
{
  home.file = {
    ".zshenv".source = link "domains/dev/home/.zshenv";
    ".zprofile".source = link "domains/dev/home/.zprofile";
    ".zshrc".source = link "domains/dev/home/.zshrc";
  };
}
