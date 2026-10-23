# observer: the one machine the home LLM is watched and used from outside —
# Prometheus (scrapes every machine's LiteLLM), Grafana, the cost ledger,
# Open WebUI (the phone's chat page), and the sync server of the owner's tasks.
# One machine takes it (the Mac;
# rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md).
{ config, lib, ... }:
lib.mkIf config.dotfiles.roles.observer.enable {
  dotfiles.homeLlm = {
    enable = true;
    console = true;
  };
  dotfiles.tasks.syncServer = true;
}
