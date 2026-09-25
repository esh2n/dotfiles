# llm-console: the one place the home LLM is watched and used from outside —
# Prometheus (scrapes every machine's LiteLLM), Grafana, and Open WebUI (the
# phone's chat page). One machine takes it (the Mac;
# rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md).
{ config, lib, ... }:
lib.mkIf config.dotfiles.roles.llm-console.enable {
  dotfiles.homeLlm = {
    enable = true;
    console = true;
  };
}
