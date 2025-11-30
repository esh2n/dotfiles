{ pkgs, ... }: {
  home.packages = with pkgs; [
    coreutils
    moreutils
    findutils
    gnused
    gnugrep
    mas
    trash-cli
  ]
  ++ (with pkgs.brewCasks; [
    notion
    obsidian
    slack
    discord
    zoom
    raycast
    hammerspoon
    paste
    marta
  ]);
}
