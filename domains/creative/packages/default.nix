{ pkgs, ... }:
let
  # Node.js packages via node2nix
  # Generate with: cd node2nix && npm install --package-lock-only && nix-shell -p node2nix --run 'node2nix -l package-lock.json'
  node2nixPackages = import ./node2nix { inherit pkgs; };
in {
  home.packages = with pkgs; [
    # Processing
    ffmpeg
    imagemagick

    # YouTube Tools
    yt-dlp  # youtube downloader (better than ytdl)
  ] ++ (with node2nixPackages; [
    # Node.js YouTube Tools (via node2nix)
    ytdl
    ytdl-mp3
  ]);

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
