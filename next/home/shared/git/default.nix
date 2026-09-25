# git: global LFS filters, and who commits on this machine
# (~/.config/git/config.local, from the checkout's untracked .env).
{ config, ... }:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  dotfiles.setup.git-lfs.command = setup "git-lfs";
  dotfiles.setup.git-identity.command = setup "git-identity";
}
