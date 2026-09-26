-- The cost ledger's own tables, beside LiteLLM's (rules/decisions/2026-09-25-llm-cost-ledger-local-first.md).
-- Idempotent: run on the ledger by the observer machine and by every sync.
-- ledger_origin names the machine each shipped row came from; a row with no
-- origin was written by the ledger machine's own LiteLLM.
CREATE TABLE IF NOT EXISTS ledger_origin (
  request_id text PRIMARY KEY,
  machine    text NOT NULL
);
