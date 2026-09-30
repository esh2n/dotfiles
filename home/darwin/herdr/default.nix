# herdr's binary on macOS. Linux takes Omarchy's /usr/bin/herdr instead: a
# second herdr earlier on PATH with another wire protocol would fail to talk
# to the server Omarchy's keybind starts
# (rules/knowledge/cli-tool-nix-packaging.md).
{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.packages = lib.mkIf config.dotfiles.packages.dev.enable [
    pkgs.herdr # needs >= 0.7.4 (home/shared/herdr); its self-update is off
  ];
}
