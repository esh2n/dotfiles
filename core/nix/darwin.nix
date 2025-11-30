{ pkgs, username, ... }: {
  system.primaryUser = username;

  ids.gids.nixbld = 350;

  nix.settings.experimental-features = [ "nix-command" "flakes" ];

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

  homebrew = {
    enable = true;
    onActivation = {
      autoUpdate = true;
      cleanup = "zap";
    };
    taps = [
      "felixkratz/formulae"
    ];
  };

  system.stateVersion = 4;
}
