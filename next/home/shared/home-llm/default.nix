# The home LLM's command steps (next/pkgs/scripts/home-llm-setup): tailscale
# serve, LiteLLM restarted onto its current config, the hub's stacks, and the
# tier check. Off until a role turns it on; the hub half is a role's call too.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  cfg = config.dotfiles.homeLlm;
in
{
  options.dotfiles.homeLlm = {
    enable = lib.mkEnableOption "the home-LLM setup steps";
    hub = lib.mkEnableOption "the hub half (LM Studio, tailnet exposure, Prometheus, Open WebUI)";
  };

  config.dotfiles.setup.home-llm = {
    inherit (cfg) enable;
    command = "${lib.getExe pkgs.home-llm-setup} ${lib.escapeShellArg facts.repo} ${
      if cfg.hub then "hub" else "node"
    }";
    # after the service manager has the current LiteLLM definition
    after = [
      "setupLaunchAgents"
      "reloadSystemd"
    ];
  };
}
