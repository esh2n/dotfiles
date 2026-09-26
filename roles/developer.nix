# developer: the machine is used to write code with coding agents. It gets the
# language tooling and servers, and runs its own loopback LiteLLM
# (rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md:
# one per machine) and jig's judgment service, which every harness asks.
{ config, lib, ... }:
lib.mkIf config.dotfiles.roles.developer.enable {
  dotfiles.services.litellm-proxy.enable = true;
  dotfiles.services.jig-decision.enable = true;
  dotfiles.homeLlm.enable = true;
  # the observer's LiteLLM writes to the ledger itself
  dotfiles.services.llm-ledger-sync.enable = !config.dotfiles.roles.observer.enable;
  dotfiles.packages.dev.enable = true;
}
