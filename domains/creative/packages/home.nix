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
    # cleanshot + screen-studio: candidates for removal once screendrop
    # (homebrew.nix) proves itself for both screenshots and recording.
    cleanshot
    screen-studio
    vlc
  ]);
}
