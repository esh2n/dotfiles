{ pkgs, ... }: {
  home.packages = with pkgs; [
    # Network Tools
    curl
    wget
    openssh

    # Security
    gnupg
    _1password  # 1password-cli
  ];

  # GUI Apps (Homebrew casks)
  homebrew.casks = [
    # Browsers
    "google-chrome"

    # Tools
    "ngrok"
  ];
}

