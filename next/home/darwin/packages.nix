# Packages only the Mac gets, by the same kinds as home/shared/packages:
# mise with base (on Omarchy, Omarchy installs and updates mise itself —
# rules/research/2026-09-24-dotfiles-on-omarchy.md), macOS-only development
# tools with dev, and GUI apps (Homebrew casks via brew-nix) and fonts with
# desktop.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  on = kind: config.dotfiles.packages.${kind}.enable;
in
{
  home.packages = lib.mkMerge [
    (lib.mkIf (on "base") [ pkgs.mise ])
    (lib.mkIf (on "dev") [ pkgs.cocoapods ])
    (lib.mkIf (on "desktop") (
      [
        pkgs.mas
        pkgs.nowplaying-cli
        # Fonts
        pkgs.jetbrains-mono
        pkgs.nerd-fonts.jetbrains-mono
        pkgs.nerd-fonts.hack
      ]
      ++ (with pkgs.brewCasks; [
        # Development
        wezterm
        ghostty
        cursor
        visual-studio-code
        zed
        yaak
        ngrok
        # Workspace
        notion
        obsidian
        slack
        discord
        zoom
        raycast
        hammerspoon
        paste
        marta
        # Creative
        figma
        blender
        obs
        # cleanshot + screen-studio: candidates for removal once screendrop
        # (homebrew) proves itself for both screenshots and recording.
        cleanshot
        screen-studio
        vlc
      ])
    ))
  ];
}
