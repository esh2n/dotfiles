{ pkgs, username, ... }: {
  home.stateVersion = "24.05";
  home.username = username;
  home.homeDirectory = pkgs.lib.mkForce "/Users/${username}";
  programs.home-manager.enable = true;
}
