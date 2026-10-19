# The home LLM's command steps (`dotctl llm setup`, pkgs/dotctl): tailscale
# serve for what this machine offers, LiteLLM restarted onto its current
# config, the console's stacks, and the tier check. Off until a role turns it
# on; which parts run is the roles' call (model-provider, observer).
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
    lmstudio = lib.mkEnableOption "LM Studio's models served on the tailnet (macOS)";
    console = lib.mkEnableOption "Prometheus, Grafana and Open WebUI on this machine";
    gpu = lib.mkEnableOption "llama-server on this machine (Linux; home/linux/llama-server)";
  };

  config.dotfiles.setup.home-llm = {
    inherit (cfg) enable;
    command = lib.concatStringsSep " " (
      [
        (lib.getExe pkgs.dotctl)
        "llm"
        "setup"
        "--repo"
        (lib.escapeShellArg facts.repo)
      ]
      # dotctl's flags name the role; it picks the engine by platform
      ++ lib.optional (cfg.lmstudio || cfg.gpu) "--model-provider"
      ++ lib.optional cfg.console "--observer"
    );
    # after the service manager has the current LiteLLM definition
    after = [
      "setupLaunchAgents"
      "reloadSystemd"
    ];
  };
}
