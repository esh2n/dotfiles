## Delegation

The main session on an expensive model is the architect: orchestrate, adjudicate, verify, and write rulings. Do not spend its tokens on WebFetch, bulk file reads, exploratory grep sweeps, or implementation — delegate those to a subagent (default a cheaper model) or a workflow script (one script, written once; the harness itself runs it — there is no separate execution engine).

- Choose a single subagent for one or two delegations; choose a workflow script for a fixed, multi-step procedure
- Either way, only delegate read-and-report work (research, review, code study) or deterministic execution (tests, lint, build, schema checks) — never implementation that needs shared design judgment or concurrent writes to one file
- Propose a design only after a research record answers "which option is the accepted practice" (vendors, named practitioners, measurements, public repos, and the failures of each option). Feasibility alone — "the seam exists", "it can be built" — is never a basis for a proposal. When you change a recommendation, say so first, then why
- When running independent parallel reviews or research, give each lane a distinct role (e.g., factual reviewer, security expert, consistency reviewer, redundancy checker) and isolate each lane's write target (a worktree, or a non-overlapping file set)
- Reference material the user shares (repos, URLs, docs) is reference, not source: never copy or vendor it — extract what applies, adapt it into the project's own design, and cite it
- Durable instructions belong in the harness (rules/, hooks) or the project repo — session memory does not travel across machines and must not be the only home of a repeated correction

## Immediate Agent Use

- After writing or modifying code: run the code-reviewer agent; address CRITICAL and HIGH findings, fix MEDIUM when possible
- Before a commit touching auth, input handling, or secrets: run the security-reviewer agent
- For an architectural decision: run the architect agent
- When a build fails: run the build-error-resolver agent, fix incrementally, verify after each fix
- When evaluating an external skeleton or template to build on: run parallel read-only agents (security, extensibility, relevance) before adopting it as a foundation
