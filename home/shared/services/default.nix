# Services any machine can run, declared off; roles switch them on
# (roles/dev.nix).
{ facts, lib, ... }:
{
  dotfiles.services = {
    # LINUX_MODEL_HOST / MAC_MODEL_HOST: where deterministic's two
    # deployments are (the roles file's "linuxModelHost" / "macModelHost");
    # litellm-up.sh says so when one is unset.
    litellm-proxy = {
      script = "home/shared/litellm/config/litellm-up.sh";
      environment =
        lib.optionalAttrs (facts.linuxModelHost != null) {
          LINUX_MODEL_HOST = facts.linuxModelHost;
        }
        // lib.optionalAttrs (facts.macModelHost != null) {
          MAC_MODEL_HOST = facts.macModelHost;
        };
    };
    jig-decision = {
      script = "home/shared/services/jig-decision-up.sh";
      environment = {
        JIG_DIR = "${facts.repo}/harness/jig";
        JIG_DECISION_PORT = "4100";
      };
    };
  };
}
