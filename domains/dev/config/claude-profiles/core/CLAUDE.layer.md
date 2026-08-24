# Core Rules (yoki)

## Harness

The agent harness — "yoki" (良き): hooks runtime, correction-driven learning,
and workflow graphs — lives in this dotfiles repo at
`claude-profiles/runtime/yoki` (`$YOKI_ROOT` points there; heritage in
`runtime/yoki/ORIGIN`). Language/domain content is toggled per machine via
`yoki-switch pack enable|disable <pack>` (旧名 claude-switch はエイリアスとして残る).

yoki is organized in three layers:
- **Harness** — deterministic guards and observation (hooks, permissions)
- **Loop** — time-axis automation (/loop, cron routines, correction-detect)
- **Graph** — multi-agent control flow as Workflow scripts (`~/.claude/workflows/`)

## Hook Profiles

yoki hooks run through the `run-with-flags.js` runner with profile levels:
- `minimal` — always runs
- `standard` — default level (set via YOKI_HOOK_PROFILE)
- `strict` — maximum enforcement

## Learning

Learning is correction-driven: the `correction-detect` Stop hook records user
corrections to `~/.claude/homunculus/corrections.jsonl`. Distill them with:
- `/learn` — extract patterns from current session
- `/instinct-status` — view learned instincts
- `/evolve` — analyze and promote instincts
- `retrospective-codify` skill — turn a correction into a rule/skill/lint

## Compaction Timing

| Phase transition | Compact? |
|---|---|
| Research → Planning / Planning → Implementation | Yes — the distilled output (plan) survives |
| Debugging → next feature / after a failed approach | Yes — dead-end traces pollute context |
| Mid-implementation | No — losing file paths and partial state is costly |
| Implementation → Testing | Only when switching focus |

## Language Overrides

- Python: ONLY use `uv`, NEVER `pip`. Use `anyio` for async testing, not `asyncio`
- TypeScript: prefer `pnpm` > `npm` > `yarn`. `strict: true` always. No `any` in production
- Go: NEVER ignore error returns
- Bash: always `set -euo pipefail`

## Quality Rules

- Write tests for new features and bug fixes
- Use feature branches for all development
- Follow semantic versioning for releases
- Document breaking changes

## Expensive-Model Delegation (Fable/Opus main sessions) — IMPORTANT

- The main session on an expensive model (Fable/Mythos/Opus) is the ARCHITECT:
  orchestrate, adjudicate, verify, and write rulings. Do NOT spend its tokens on
  WebFetch, bulk file reads, exploratory grep sweeps, or implementation — delegate
  those to subagents (default sonnet) or workflows
- Workflow vs single agent: workflows for batches of adjudicated tasks (parallel,
  per-task verify + gate + delivery); a single agent for one-cause investigations
  with a tight repro loop; the main session only for judgment and acceptance
- Reference material the user shares (repos, URLs, docs) is REFERENCE, not source:
  never copy or vendor it — extract what applies, adapt it into the product's own
  design system, and cite it in research records
- Durable instructions belong in the harness (this file, rules/, hooks) or the
  project repo — session memory does not travel across machines and must not be
  the only home of a repeated correction
