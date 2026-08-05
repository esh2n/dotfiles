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
      # "zap" removed 25 undeclared casks + 11 MAS apps + fish (2026-08-05).
      # Keep "none" until the declarations catch up with reality, then decide
      # whether to go back to strict cleanup.
      cleanup = "none";
    };
    taps = [
      "felixkratz/formulae"
      "satococoa/tap"
      "nikitabobko/tap"
      "BarutSRB/tap"
    ];
  };

  system.stateVersion = 4;
}
