# Media and graphics tools for a machine used at a desk (the desktop role).
{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.packages = lib.mkIf config.dotfiles.packages.desktop.enable (
    with pkgs;
    [
      # Media / graphics
      ffmpeg
      imagemagick
      graphviz
      yt-dlp
      lessc # userstyles templates

    ]
  );
}
