# git on Omarchy: Omarchy writes ~/.config/git/config itself, so the directory
# stays Omarchy's and only this repo's other files are placed into it. Our
# settings live in ~/.gitconfig, which git reads with priority, so behaviour
# matches the Mac.
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  files = [
    "ignore"
    "message"
    "message.emoji"
  ];
in
{
  xdg.configFile = lib.genAttrs (map (f: "git/${f}") files) (
    name: { source = link "domains/dev/config/${name}"; }
  );
}
