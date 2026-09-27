---
name: records-triage
description: Sort the flow documents (research records, plans) past their 14 days — promote what lasts into harness/rules/knowledge or a decision note, rewritten to the work only, then delete the rest. Run when make up or `dotctl records check` lists expired flow documents, or when asked to clean up the records.
disable-model-invocation: true
---

# records-triage

Flow documents (`harness/rules/research/`, `plans/`) live 14 days; stock
(`harness/rules/knowledge/`, `harness/rules/decisions/`) is kept and
maintained. This skill moves what lasts from flow into stock and leaves the
rest for `dotctl records prune --yes`. The rules are
`harness/rules/decisions/2026-09-27-records-flow-and-stock.md` and
`harness/rules/decisions/2026-09-27-records-describe-work-not-owner.md`.

## Steps

1. Run `dotctl records check` (or read the list the owner gives). Work on
   those entries only.
2. For each entry, read it in full and decide one of:
   - **knowledge** — a fact that will be asked again and is not a ruling
     (where a config lives, what a tool overwrites, a measured number).
   - **decision** — it is the evidence for an accepted decision note: fold
     the conclusion and its source URLs into that note's reasoning, without
     touching its `## Decision` section (supersede instead of editing it).
   - **delete** — superseded, one-off, never led anywhere, or already
     covered by stock.
   Show the owner the list of decisions (entry → knowledge / decision /
   delete, one line each, with the reason) and wait for approval before
   writing.
3. Promote. A knowledge note is `harness/rules/knowledge/<topic>.md`: the
   question, the answer, the source URLs with the date checked, the caveats.
   Merge into an existing note on the same topic instead of adding a second
   one. Add or update its line in `harness/rules/knowledge/INDEX.md`.
   Write the work only: no tone, personality, misremembered names or
   quotations of the owner; no usernames, paths carrying them, account or
   vault names, machine models, network or security state, work matters. A
   machine is named by its role, with only the capacity the work depends on.
4. Run `dotctl records prune` to see what will go, then
   `dotctl records prune --yes`. It removes only flow documents and their
   research INDEX lines.
5. Commit stock and removals separately, in English, one line each.

Never delete a flow entry whose facts a pending (not yet accepted)
decision still needs; say so and leave it for the next triage.
