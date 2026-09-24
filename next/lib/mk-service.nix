# Resident services, declared once and rendered per platform:
#
#   dotfiles.services.<name> = {
#     enable = <bool>;
#     script = "<path in the checkout>";   # run with bash
#     environment = { NAME = "value"; };
#     restartDelay = <seconds>;           # launchd ThrottleInterval / systemd RestartSec
#   };
#
# macOS gets launchd.agents.<name> (label com.esh2n.<name>, logs in
# ~/Library/Logs/<name>.log); Linux gets systemd.user.services.<name>
# (logs in the journal). Secrets are never here: each script fetches its own
# at start (1Password), so a unit file holds no credential.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  inherit (lib) mkOption types;
  cfg = config.dotfiles.services;
  enabled = lib.filterAttrs (_: s: s.enable) cfg;
  script = s: "${facts.repo}/${s.script}";
in
{
  options.dotfiles.services = mkOption {
    default = { };
    description = "Resident services, rendered as launchd agents on macOS and systemd user services on Linux.";
    type = types.attrsOf (
      types.submodule {
        options = {
          enable = lib.mkEnableOption "this service";
          script = mkOption {
            type = types.str;
            description = "Path of the script to run, relative to the checkout.";
          };
          environment = mkOption {
            type = types.attrsOf types.str;
            default = { };
          };
          restartDelay = mkOption {
            type = types.int;
            default = 120;
            description = "Seconds to wait before starting again after an exit.";
          };
        };
      }
    );
  };

  config = lib.mkMerge [
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents = lib.mapAttrs (name: s: {
        enable = true;
        config = {
          Label = "com.esh2n.${name}";
          ProgramArguments = [
            "/bin/bash"
            (script s)
          ];
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = s.restartDelay;
          ProcessType = "Background";
          StandardOutPath = "${facts.home}/Library/Logs/${name}.log";
          StandardErrorPath = "${facts.home}/Library/Logs/${name}.log";
        }
        // lib.optionalAttrs (s.environment != { }) { EnvironmentVariables = s.environment; };
      }) enabled;
    })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services = lib.mapAttrs (name: s: {
        Unit.Description = name;
        Service = {
          ExecStart = "${pkgs.bash}/bin/bash ${lib.escapeShellArg (script s)}";
          Restart = "always";
          RestartSec = s.restartDelay;
          Environment = lib.mapAttrsToList (k: v: "${k}=${v}") s.environment;
        };
        Install.WantedBy = [ "default.target" ];
      }) enabled;
    })
  ];
}
