# home-llm-setup as a package (shellcheck at build time). tailscale, docker,
# lms, launchctl/systemctl and the OS secret store come from the system on
# purpose; the scripts it drives live in the checkout.
{
  writeShellApplication,
  coreutils,
  gnused,
  curl,
}:
writeShellApplication {
  name = "home-llm-setup";
  runtimeInputs = [
    coreutils
    gnused
    curl
  ];
  inheritPath = true;
  text = builtins.readFile ./home-llm-setup.sh;
}
