# Services any machine can run, declared off; roles switch them on
# (roles/dev.nix).
{ facts, ... }:
{
  dotfiles.services = {
    litellm-proxy.script = "home/shared/litellm/config/litellm-up.sh";
    jig-decision = {
      script = "home/shared/services/jig-decision-up.sh";
      environment = {
        JIG_DIR = "${facts.repo}/harness/jig";
        JIG_DECISION_PORT = "4100";
      };
    };
  };
}
