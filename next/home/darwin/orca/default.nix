# Orca: ~/.orca is a link to config/ beside this file (keybindings; the rest
# is Orca's own state, gitignored).
{ config, ... }:
{
  home.file.".orca".source = config.lib.dotfiles.link "next/home/darwin/orca/config";
}
