# git: its config beside this file (config/), global LFS filters, and who
# commits on this machine (~/.config/git/config.local, from the checkout's
# untracked .env). On the Mac ~/.config/git is a link to config/. On Omarchy,
# Omarchy writes ~/.config/git/config itself, so the directory stays its own
# and only this repo's other files are placed into it; our settings live in
# ~/.gitconfig, which git reads with priority, so behaviour matches the Mac.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  link = config.lib.dotfiles.link;
  dir = "next/home/shared/git/config";
in
{
  xdg.configFile = lib.mkMerge [
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin { git.source = link dir; })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux (
      lib.genAttrs [ "git/ignore" "git/message" "git/message.emoji" ] (name: {
        source = link "${dir}/${lib.removePrefix "git/" name}";
      })
    ))
  ];
  # ~/.gitconfig: rendered beside this file from gitconfig.template (its
  # conditional includes come from config/conditional, machine-local)
  home.file.".gitconfig".source = link "next/home/shared/git/gitconfig";
  dotfiles.setup.git-lfs.command = config.lib.dotfiles.setupStep "git-lfs";
  dotfiles.setup.git-identity.command = config.lib.dotfiles.setupStep "git-identity";
}
