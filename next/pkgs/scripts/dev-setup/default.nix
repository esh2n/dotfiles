# dev-setup as a package (shellcheck at build time). The tools each step
# drives (gh, mise, claude, pi, cargo, ...) come from the user's PATH on
# purpose: Nix, mise and their own installers own them.
{
  writeShellApplication,
  coreutils,
  gnused,
  gawk,
  gnugrep,
  dotctl,
}:
writeShellApplication {
  name = "dev-setup";
  runtimeInputs = [
    coreutils
    gnused
    gawk
    gnugrep
    dotctl
  ];
  inheritPath = true;
  text = builtins.readFile ./dev-setup.sh;
}
