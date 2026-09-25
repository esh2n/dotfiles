# The home LLM's command steps (next/pkgs/scripts/home-llm-setup): tailscale
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
        (lib.getExe pkgs.home-llm-setup)
        (lib.escapeShellArg facts.repo)
      ]
      ++ lib.optional cfg.lmstudio "--lmstudio"
      ++ lib.optional cfg.console "--console"
      ++ lib.optional cfg.gpu "--gpu"
    );
    # after the service manager has the current LiteLLM definition
    after = [
      "setupLaunchAgents"
      "reloadSystemd"
    ];
  };
}
