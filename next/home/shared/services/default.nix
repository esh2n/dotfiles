# Services any machine can run, declared off; roles switch them on
# (next/roles/dev.nix).
{ facts, ... }:
{
  dotfiles.services = {
    litellm-proxy.script = "next/home/shared/litellm/config/litellm-up.sh";
    jig-decision = {
      script = "next/home/shared/services/jig-decision-up.sh";
      environment = {
        JIG_DIR = "${facts.repo}/harness/jig";
        JIG_DECISION_PORT = "4100";
      };
    };
  };
}
