# The roles as home-manager sees them: the interface plus what each role
# switches on. The nix-darwin (system) evaluation imports ./system.nix: the
# interface and the system-level kinds (Homebrew).
{
  imports = [
    ./options.nix
    ./base.nix
    ./developer.nix
    ./desk-user.nix
    ./model-provider.nix
    ./observer.nix
  ];
}
