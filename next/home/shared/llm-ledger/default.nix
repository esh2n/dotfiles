# The cost ledger's sync (rules/decisions/2026-09-25-llm-cost-ledger-local-first.md):
# on a machine that is not the ledger, ship its LiteLLM spend rows to the
# llm-console machine's Postgres. Off until a role turns it on. The ledger's
# tailnet name is this machine's fact (the roles file's "consoleHost").
{
  lib,
  pkgs,
  facts,
  ...
}:
{
  dotfiles.services.llm-ledger-sync = {
    script = "next/home/shared/llm-ledger/ledger-sync-up.sh";
    environment = {
      LEDGER_SYNC_BIN = lib.getExe pkgs.llm-ledger-sync;
      LEDGER_SQL = "${facts.repo}/next/home/shared/llm-ledger/ledger.sql";
    }
    // lib.optionalAttrs (facts.consoleHost != null) { LEDGER_HOST = facts.consoleHost; };
  };
}
