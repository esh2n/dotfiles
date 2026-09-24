# Packages only the Mac gets: macOS-only tools, GUI apps (Homebrew casks via
# brew-nix), fonts, and mise — on Omarchy, Omarchy installs and updates mise
# itself (rules/research/2026-09-24-dotfiles-on-omarchy.md).
{ pkgs, ... }:
{
  home.packages =
    with pkgs;
    [
      mas
      nowplaying-cli
      cocoapods
      codebase-memory-mcp # upstream ships macOS binaries only (next/pkgs)
      mise

      # Fonts
      jetbrains-mono
      nerd-fonts.jetbrains-mono
      nerd-fonts.hack
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
    ]);
}
