# Review output format

The shape every review's result takes, whatever reviewers ran. Write it in the owner's language. Reviewers return findings in the same four fields; the lead (the session running the `change-review` skill) merges them, drops what review-verifier refuted, and writes this.

## A finding

Each finding carries a location, a severity, a confidence, a label, and four fields. A finding that cannot fill all four is a question or missing context, not a finding.

| Field | Write |
| --- | --- |
| What fails | The concrete input or situation and what happens. "When `bans.user_id` holds one NULL, the query returns zero rows." Never "could be unsafe" or "might cause issues". |
| Why | The mechanism, step by step. Keep the technical terms so no information is lost, and explain each term in a short clause where it first appears. No analogies. |
| Fix | The changed code, and how to read it: which line does what. |
| Verify | The test or command that shows the fix works, and the source URL the claim rests on (official docs, a standard, the project's own decision note). |

Header line: `N. [severity][confidence][label] path:line — one-line title`.

- severity: `blocker` (data loss, a security breach, wrong results in normal use, a broken build or contract), `major` (fails on a realistic edge case, under expected load, or on a likely path), `minor` (a real failure with small impact).
- confidence: `100` = the motivating line is quoted and the failing path was traced from input to failure; `75` = the motivating line is quoted and the concrete input is named, one link inferred; `50` = plausible, but the line or premise is not confirmed. A `50` appears only as a `blocker`, labelled `[unverified]`; any other `50` becomes a question or missing context.
- label: `[static]` (read, not run), `[needs-measurement]` (names the command that would settle it), `[verified]` (the check was run in this pass), `[unverified]` (review-verifier could not settle it, or confidence 50).
- Never quote the value of a secret. Show its location and kind only.

Example (in English here; the real output follows the owner's language):

> 1. [major][100][static] api/users.sql:12 — NOT IN returns no rows when the subquery yields a NULL
>
> What fails: `WHERE id NOT IN (SELECT user_id FROM bans)` returns zero rows as soon as one row of `bans` has `user_id` NULL.
>
> Why: in SQL, NULL means "unknown", so `id <> NULL` evaluates to UNKNOWN, neither TRUE nor FALSE (three-valued logic). `NOT IN` requires the value to differ from every element of the list; one UNKNOWN makes the whole condition UNKNOWN, and `WHERE` keeps only TRUE rows.
>
> Fix: `WHERE NOT EXISTS (SELECT 1 FROM bans b WHERE b.user_id = users.id)`. The subquery checks, per user row, whether a ban row with the same id exists; a NULL `user_id` simply never matches, so it cannot change the result.
>
> Verify: a test that inserts a ban row with `user_id` NULL and asserts the user count is unchanged. Source: https://wiki.postgresql.org/wiki/Don%27t_Do_This#Don.27t_use_NOT_IN

## Sections

1. **Findings** — numbered, blockers first. Mark which reviewers raised each one, and which model families when step 6 ran. Findings you already fixed in your own work are listed as fixed, with the diff.
2. **Questions for the owner** — trade-offs, taste, design calls, and every point a reviewer was told to phrase as a question (ui-reviewer's suggestions in mode A, workload trade-offs). Each names the options and what each gains and costs.
3. **Missing context** — each input that was absent (intent, acceptance criteria, workload file, screenshots, design spec), and what would close the item once supplied. Do not suppress a potentially serious concern because the evidence is incomplete; put it here.
4. **Ran** — each static tool and its status (ran, not installed, not applicable, failed); each reviewer spawned, with its finding count and how many held, were refuted, or could not be verified; each reviewer not spawned and why; whether step 6 ran and on which model; the refuted findings, one line each.

## Destinations

- Chat when there are 5 findings or fewer and no screenshots: the sections above, numbered so the owner can answer "1 fix, 2 dismiss, 3 comment".
- An Artifact page otherwise, and for every heavy review.

### Artifact page (to be built)

Not built yet. Until it exists, use chat and say the page is not available. The page, once built:

- shows each finding with its four fields and, for UI findings, the before and after images side by side;
- gives each finding one choice: fix it, I'll fix it, comment on GitHub, dismiss — plus a free-text note;
- saves the choices in the page's own database (the `db` capability) so the model reads them back with `ArtifactData` and continues: fix the "fix it" items and show the diff, leave "I'll fix it" alone, draft the GitHub text for "comment" items and post only after the owner approves that text, record "dismiss" items as below;
- lists Questions for the owner and Missing context as their own sections, with a free-text answer each.

## Learning loop

- Dismissed: record it as a false positive with the reviewer, the owner's reason and, when the finding cited one, the checklist item id.
- A checklist item dismissed three times with no accepted finding in between is proposed for removal.
- A miss (a defect found later that the review should have caught) adds one checklist item: the trigger in the diff, what to check, why, and a source URL.
- Checklists live in the dotfiles repository (`harness/skills/<skill>/references/review-checklist.md`). When the review runs in another repository, list the proposed checklist edits at the end of the output for the owner instead of writing them.
