# The roles interface: one namespace, options.dotfiles.roles.<name>.enable.
# Feature modules read these options; they never read the roles file, the
# environment, or each other. Which roles are on is decided by the
# machine-local roles file and injected as the `facts` module argument.
{ lib, facts, ... }:
let
  names = import ./names.nix;
in
{
  options.dotfiles.roles = lib.genAttrs names (
    name:
    {
      enable = lib.mkEnableOption "the ${name} role";
    }
  );

  config.dotfiles.roles = lib.genAttrs facts.roles (_: {
    enable = lib.mkDefault true;
  });
}
