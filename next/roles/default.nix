# The roles as home-manager sees them: the interface plus what each role
# switches on. The nix-darwin (system) evaluation imports ./options.nix alone,
# because the features the roles switch on are declared in home modules.
{
  imports = [
    ./options.nix
    ./base.nix
    ./desktop.nix
    ./dev.nix
    ./lmstudio.nix
    ./llm-console.nix
    ./gpu.nix
  ];
}
