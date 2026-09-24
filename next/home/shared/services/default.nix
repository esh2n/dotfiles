# Services every machine with the dev role runs: its own loopback LiteLLM
# (rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md:
# one per machine) and jig's judgment service, which every harness asks over
# the loopback.
{ config, facts, ... }:
let
  dev = config.dotfiles.roles.dev.enable;
in
{
  dotfiles.services = {
    litellm-proxy = {
      enable = dev;
      script = "domains/dev/config/litellm/litellm-up.sh";
    };
    jig-decision = {
      enable = dev;
      script = "domains/dev/config/jig/jig-decision-up.sh";
      environment = {
        JIG_DIR = "${facts.repo}/domains/dev/llm/harness/jig";
        JIG_DECISION_PORT = "4100";
      };
    };
  };
}
