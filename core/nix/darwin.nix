{ pkgs, ... }: {
  # Nix settings
  nix.settings.experimental-features = [ "nix-command" "flakes" ];

  # macOS system defaults
  system.defaults = {
    dock = {
      autohide = true;
      mru-spaces = false;
      show-recents = false;
    };
    finder = {
      AppleShowAllFiles = true;
      ShowPathbar = true;
      FXPreferredViewStyle = "clmv";
    };
    NSGlobalDomain = {
      KeyRepeat = 2;
      InitialKeyRepeat = 15;
      AppleShowAllExtensions = true;
    };
  };

  # Homebrew integration (for GUI apps that aren't in nixpkgs)
  homebrew = {
    enable = true;
    onActivation = {
      autoUpdate = true;
      cleanup = "zap";
    };
    taps = [
      "homebrew/cask-fonts"
    ];
  };

  # System state version
  system.stateVersion = 4;
}

