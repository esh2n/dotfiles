# The macOS system itself: who owns it and how Nix runs on it.
{ facts, ... }:
{
  system.primaryUser = facts.username;

  ids.gids.nixbld = 350;

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  # Keys of eight eMudhra intermediates were recoverable (Mozilla, 2026-10-20),
  # and nixpkgs' cacert 3.126 still trusts the roots they chain to. Drop every
  # eMudhra root until a cacert with the fix lands, then remove this list.
  security.pki.caCertificateBlacklist = [
    "emSign ECC Root CA - C3"
    "emSign ECC Root CA - G3"
    "emSign Root CA - C1"
    "emSign Root CA - G1"
  ];
  # OpenSSL-based tools outside Nix (mise's Python among them) default to
  # macOS's /etc/ssl/cert.pem, which still trusts those roots.
  environment.variables.SSL_CERT_FILE = "/etc/ssl/certs/ca-certificates.crt";

  system.stateVersion = 4;
}
