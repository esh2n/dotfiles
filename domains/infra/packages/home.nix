{ pkgs, ... }: {
  home.packages = with pkgs; [
    curl
    wget
    openssh
    gnupg
    _1password-cli
  ]
  ++ (with pkgs.brewCasks; [
    ngrok
  ]);
}
