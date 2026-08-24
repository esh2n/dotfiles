{ ... }: {
  homebrew.casks = [
    "spotify"
    # Screenshot + screen recording + annotation in one OSS app; meant to
    # replace both cleanshot and screen-studio (see home.nix). Requires
    # macOS 26.4+, so the cask fails to install until the OS is upgraded.
    # The tap is trusted by core/utils/homebrew.sh.
    "fayazara/tap/screendrop"
  ];
}
