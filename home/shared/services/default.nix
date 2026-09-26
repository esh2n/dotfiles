# Services any machine can run, declared off; roles switch them on
# (roles/dev.nix).
{ facts, lib, ... }:
{
  dotfiles.services = {
    # LLAMA_SERVER_HOST / LM_STUDIO_HOST: where deterministic's two
    # deployments are (the roles file's "llamaServerHost" / "lmStudioHost");
    # litellm-up.sh says so when one is unset.
    litellm-proxy = {
      script = "home/shared/litellm/config/litellm-up.sh";
      environment =
        lib.optionalAttrs (facts.llamaServerHost != null) {
          LLAMA_SERVER_HOST = facts.llamaServerHost;
        }
        // lib.optionalAttrs (facts.lmStudioHost != null) {
          LM_STUDIO_HOST = facts.lmStudioHost;
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
