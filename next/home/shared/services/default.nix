# Services any machine can run, declared off; roles switch them on
# (next/roles/dev.nix).
{ facts, ... }:
{
  dotfiles.services = {
    litellm-proxy.script = "domains/dev/config/litellm/litellm-up.sh";
    jig-decision = {
      script = "domains/dev/config/jig/jig-decision-up.sh";
      environment = {
        JIG_DIR = "${facts.repo}/domains/dev/llm/harness/jig";
        JIG_DECISION_PORT = "4100";
      };
    };
  };
}
