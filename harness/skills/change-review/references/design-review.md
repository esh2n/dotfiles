# Reviewing a design before code

For a design doc, ADR draft, plan or spec that has no code yet. It checks the design against what the project has already written down, and ends with the decisions a human must take. It replaces the former `design-review` workflow script. The judgment rules are `code-review-discipline` section 12.

Do not run pstack's `interrogate` on an abstract plan with no code: it invents risks. Ground the review in the project's documents instead.

## Steps

1. **Read the design itself**, the whole file or page. Reviewers read it too; a summary is for orientation only and is never what gets reviewed.
2. **Collect the grounding.** List what exists, then read it: `docs/adr/`, `docs/design/`, decision notes, `AGENTS.md`/`CLAUDE.md`, `.claude/rules/`, `README*`, `CONTRIBUTING*`, and the top-level layout. Quote load-bearing rules verbatim with their path. Write down each kind of document you looked for and did not find.
3. **Spawn one fresh, read-only subagent per lane**, each with the design path, the grounding, and its lane's focus:

   | Lane | Focus |
   | --- | --- |
   | conventions | Does the design contradict a grounding document or written convention? Does it cover every requirement of its ticket or brief, add nothing unrequested, and read each requirement as written? An acknowledged, justified deviation is not a finding; an unacknowledged one is. Use `spec-reviewer` when a ticket, brief or acceptance criteria exist. |
   | architecture | Layer boundaries and dependency direction, where business logic lands, aggregate and bounded-context fit, whether new abstractions earn their place, transaction and consistency boundaries — judged against this repository's actual structure. |
   | security | Who can call what and where authorization sits, data exposure in responses and logs, tenant isolation on new data paths, secret handling, trust boundaries crossed. Use `security-reviewer`. |
   | wording | Names against the domain's language and what already ships; names that mislead about behaviour; API, field and endpoint naming coherence. |
   | release | Rollout and rollback, backward compatibility for clients and data, migration order (expand and contract: is there a step where old code meets the new schema?), feature flags or dual writes, and whether the change is observable enough to tell it worked. Use `rollout-reviewer`. |
   | workload | Expected load against the design: queries per request, contention, retry amplification, what saturates first. Use `workload-reviewer`; without a workload description it reports missing context. |
   | failure modes | Only when domain checklists are installed: walk each external dependency, async boundary, new metric and health endpoint through the checklists' silences. A silence with a concrete consequence is a finding citing the checklist id; a trade-offs item is never a finding, only a question naming the options. |

4. **Verify** every finding the go or no-go decision depends on, and every blocker, with `review-verifier` against the design text, the grounding and the code. Refuted findings drop; unsettled ones are listed, not weighed.
5. **Output**, in the owner's language:
   1. Verdict: proceed, proceed with changes, or rethink, with one or two sentences of reasoning. Derive it from held findings only. An unresolved blocker or major finding rules out "proceed".
   2. Findings by lane, each quoting the grounding document that backs it.
   3. A trade-off table: option, what it gains, what it costs, what decides it.
   4. Decisions to make, phrased so the owner can answer each.
   5. Unverified findings, listed and not weighed.
   6. What could not be judged because no grounding document exists, said plainly.
