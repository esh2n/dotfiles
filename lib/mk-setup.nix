# Setup steps: what cannot be declared — a tool's own registration command, a
# download into a mutable place, a file seeded once and then owned by the app.
#
#   dotfiles.setup.<name> = {
#     enable  = <bool>;        # default on; a role can own it (off here, on there)
#     command = "<cmd line>";  # idempotent: looks first, acts only on what is missing
#     after   = [ "<activation entry>" ... ];  # beyond linkGeneration
#   };
#
# Each becomes the activation entry setup-<name>, after the links are in
# place. A failing step warns and the switch goes on — the contract the old
# installer had — so one unreachable download never blocks the rest.
{
  config,
  lib,
  facts,
  ...
}:
let
  enabled = lib.filterAttrs (_: s: s.enable) config.dotfiles.setup;
  # Activation runs with a PATH of its own; a step drives the user's tools
  # (installed by Nix, mise, cargo, Homebrew, the system), so it sees them
  # after activation's own.
  userPath = lib.concatStringsSep ":" [
    "/etc/profiles/per-user/${facts.username}/bin"
    "${facts.home}/.nix-profile/bin"
    "${facts.home}/.local/share/mise/shims"
    "${facts.home}/.cargo/bin"
    "${facts.home}/.local/bin"
    "/opt/homebrew/bin"
    "/usr/local/bin"
    "/usr/bin"
    "/bin"
    "/usr/sbin"
    "/sbin"
  ];
in
{
  # the same PATH for other activation entries that drive the user's tools
  config.lib.dotfiles.userPath = userPath;

  options.dotfiles.setup = lib.mkOption {
    default = { };
    description = "Idempotent setup steps run on activation.";
    type = lib.types.attrsOf (
      lib.types.submodule {
        options = {
          enable = lib.mkOption {
            type = lib.types.bool;
            default = true;
            description = "Whether to run this step.";
          };
          command = lib.mkOption {
            type = lib.types.str;
            description = "The command line to run; must be idempotent.";
          };
          after = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
            description = "Activation entries this step runs after, besides linkGeneration.";
          };
        };
      }
    );
  };

  config.home.activation = lib.mapAttrs' (
    name: step:
    lib.nameValuePair "setup-${name}" (
      lib.hm.dag.entryAfter ([ "linkGeneration" ] ++ step.after) ''
        if ! (PATH="$PATH:${userPath}" && run ${step.command}); then
          warnEcho "setup ${name} failed; make up goes on (run it again once the cause is fixed)"
        fi
      ''
    )
  ) enabled;
}
