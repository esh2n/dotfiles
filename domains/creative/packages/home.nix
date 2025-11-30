{ pkgs, ... }: {
  home.packages = with pkgs; [
    ffmpeg
    imagemagick
    yt-dlp
  ]
  ++ (with pkgs.brewCasks; [
    figma
    blender
    obs
    cleanshot
    screen-studio
    vlc
  ]);
}
