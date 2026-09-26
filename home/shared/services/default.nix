# Services any machine can run, declared off; roles switch them on
# (roles/dev.nix).
{ facts, lib, ... }:
{
  dotfiles.services = {
    # LLAMA_SERVER_HOST: where the deterministic tier's llama-server is
    # (the roles file's "llamaServerHost"); litellm-up.sh says so when unset.
    litellm-proxy = {
      script = "home/shared/litellm/config/litellm-up.sh";
      environment = lib.optionalAttrs (facts.llamaServerHost != null) {
        LLAMA_SERVER_HOST = facts.llamaServerHost;
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
