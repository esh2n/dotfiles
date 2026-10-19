## Delegation

The main session on an expensive model is the architect: orchestrate, adjudicate, verify, and write rulings. Do not spend its tokens on WebFetch, bulk file reads, exploratory grep sweeps, or carrying out a fully specified plan that a test, lint or type check confirms — delegate those to a subagent (its model from the table below) or a workflow script (one script, written once; the harness itself runs it — there is no separate execution engine). Implementation that needs design judgment stays in the session (table below).

- Propose a design only after a research record answers "which option is the accepted practice" (vendors, named practitioners, measurements, public repos, and the failures of each option). Feasibility alone — "the seam exists", "it can be built" — is never a basis for a proposal. When you change a recommendation, say so first, then why
- When running independent parallel reviews or research, give each lane a distinct role (e.g., factual reviewer, security expert, consistency reviewer, redundancy checker) and isolate each lane's write target (a worktree, or a non-overlapping file set)
- Reference material the user shares (repos, URLs, docs) is reference, not source: never copy or vendor it — extract what applies, adapt it into the project's own design, and cite it
- Durable instructions belong in the harness (rules/, hooks) or the project repo — session memory does not travel across machines and must not be the only home of a repeated correction

## Choosing a model

Agent definitions name only a tier — `main`, `complex` or `executor` — and an effort; jig turns them into each harness's model (rules/decisions/2026-10-19-model-assignment.md). Match the work, then delegate to the agent or spawn with that tier and effort:

| When the work is | Tier | Effort | Agent |
|---|---|---|---|
| design, architecture, or a plan for a multi-file change | complex | xhigh | architect |
| a bug that survived two attempts, or a root cause to find | complex | high | spawn with `complex` |
| a security or privacy review (auth, input handling, secrets, personal data) | complex | high | security-reviewer, through the `change-review` skill |
| reviewing a change: correctness, workload, UI, tests, match with its documents, rollout and compatibility, or verifying a finding | main | high | through the `change-review` skill: code-reviewer, workload-reviewer, ui-reviewer, test-reviewer, spec-reviewer, rollout-reviewer, review-verifier (inherits) |
| implementation that needs judgment | main | inherit | build-error-resolver, or work in the session |
| reading, searching, docs lookup, an industry survey | main | medium | docs-lookup, research |
| carrying out a fully specified plan whose result a test, lint or type check confirms, when keeping the work local matters more than speed | executor | medium | spawn with `executor` |
| a title, a commit message, a summary | main | low | — |

- The session keeps the tier it started on; reach a stronger model by delegating to a `complex` agent, never by switching the session's model.
- Never give `executor` work whose result nothing machine-checkable confirms.
- When a model is unavailable, do not continue on a different model; report which one failed and why.

## Running workers in parallel

- Fan out reading, research, verification and review freely; for N workers follow pstack's `swarm` procedure (frame, fan out, aggregate, report).
- Parallel writers each own separate files, and their changes land one at a time. Tasks whose files overlap never run at the same time; the later one waits and builds on the earlier one.
- Unattended parallel implementation of an agreed task list (the `implement` workflow where the harness runs it): one plain-git worktree per task, a test or check confirms each task inside its worktree, and the owner merges each branch with `git merge --no-ff`. Otherwise work through the list in order.
- Aim for three to five workers at once.
- Never mix harnesses inside one swarm; asking another harness for a second opinion is a single delegation.

## Immediate Agent Use

- After writing or modifying code: follow the `change-review` skill; in your own work, fix verified blocker and major findings and report the rest by number for the owner's choice
- Before a commit touching auth, input handling, secrets, CI or dependencies: the `change-review` skill's run includes security-reviewer; do not commit before it reports
- Never post a review or comment to GitHub without the owner's approval of the text
- For an architectural decision: run the architect agent
- When a build fails: run the build-error-resolver agent, fix incrementally, verify after each fix
- When evaluating an external skeleton or template to build on: run parallel read-only agents (security, extensibility, relevance) before adopting it as a foundation
