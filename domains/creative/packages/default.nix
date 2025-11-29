{ pkgs, ... }: {
  home.packages = with pkgs; [
    # Processing
    ffmpeg
    imagemagick
  ];

  # GUI Apps (Homebrew casks)
  homebrew.casks = [
    # Design
    "figma"
    "blender"

    # Recording
    "obs"
    "cleanshot"
    "screen-studio"

    # Media Apps
    "vlc"
    "spotify"
    "davinci-resolve"
  ];
}

