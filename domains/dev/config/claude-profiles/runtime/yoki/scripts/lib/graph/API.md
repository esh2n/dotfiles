# Workflow script API — as consumed by yoki-graph

Enumerated by reading every workflow script that ships in this repo
(`core/workflows/*.js`, `packs/go/workflows/go-optimize.js`) plus the
`workflow-authoring` skill (SKILL.md body — this repo has no on-disk
`~/.claude/skills/workflow-authoring/`; it loaded as a packaged skill body,
quoted below where it matters). This is the exact surface `yoki-graph`
implements as injected globals — nothing more, nothing the scripts don't use
or the skill doesn't document.

## Script shape

Every script starts with a pure-literal `export const meta = {...}` (name,
description required; whenToUse, phases optional — phases entries are
`{title, detail}`, optionally `{model}`). The rest of the file is a plain
async script body: top-level `await` and top-level `return <value>` are both
used throughout (`research.js` returns `{report, unknowns}`, `implement.js`
returns a `{tasks, schedule, gate, delivery, note}` object, several scripts
`return { error: '...' }` early). Top-level `return` is not legal in a real
ES module or classic script — the Workflow tool therefore must run the body
as a function, not `import()` it directly. See "Execution mechanism" below
for how yoki-graph reproduces this.

Scripts are plain JavaScript — no TypeScript syntax, no filesystem/Node API
access from the script body itself (only through `agent()`).

## Injected globals (from the skill body + confirmed by every script)

- `args` — the value passed as the run's `args` input, verbatim. Every
  script defensively does `let A = args; if (typeof A === 'string') { try {
  A = JSON.parse(A) } catch { A = {} } }` because named-workflow invocation
  may deliver args as a JSON string — yoki-graph's CLI (`--args`/`--args-file`)
  always parses JSON itself and hands the script the parsed value, but the
  scripts' own guard makes a string-args path safe either way.
- `phase(title: string): void` — starts a progress group; matched against
  `meta.phases[].title` by exact string equality for display purposes only.
- `log(message: string): void` — a narrator line, printed above/around the
  progress tree.
- `agent(prompt: string, opts?: object): Promise<any>` — runs one subagent
  call. Every script uses these `opts` keys: `label`, `phase`, `schema`,
  `model`, `effort`, and (go-optimize.js, review.js) `agentType` and
  (go-optimize.js) `isolation: 'worktree'`.
  - Without `schema`: resolves to the subagent's final text (a string).
  - With `schema` (a JSON Schema object): resolves to the parsed/validated
    object — the skill says this "forces a StructuredOutput tool call";
    yoki-graph has no such tool outside Claude Code, so it reproduces the
    *contract* (schema-validated JSON out) via `schema.js`'s
    append-instruction/extract/validate/retry-once/hard-fail pipeline
    instead, uniformly across every backend (see schema.js).
  - `opts.label` — display label, also namespaces the journal/resume key.
  - `opts.phase` — explicit phase-group override (races inside
    `parallel()`/`pipeline()` otherwise).
  - `opts.model` — `'haiku' | 'sonnet' | 'opus'`, or a backend-native model
    id passed straight through. Omitted = inherit the run's `--model`
    (itself defaulted to sonnet by yoki-graph, matching every script's own
    `const MODEL = (A && A.model) || 'sonnet'` convention for the *script's*
    model tier — the run's own default is analogous, one level up).
  - `opts.effort` — `'low'|'medium'|'high'|'xhigh'|'max'`, passed through to
    the backend for the tiers that accept it (claude has `--effort`; codex
    and omp accept reasoning-effort override too where the model supports
    it, otherwise it's advisory metadata folded into the prompt preamble).
  - `opts.isolation: 'worktree'` — run this one agent() call inside a fresh
    `git worktree`, auto-removed after if the tree is clean.
  - `opts.sandbox` — `'read-only' | 'workspace-write' | 'danger-full-access'`,
    for backends that have a sandbox concept (today: codex's `-s`). **Defaults
    to `'read-only'`** — the backend tool's own default — so a call only gets
    filesystem write authority when the script asks for it. Set
    `sandbox: 'workspace-write'` on the calls that actually edit, commit, or
    run a build (implement.js's Implement/Delivery, preflight.js's auto-fix,
    go-optimize.js's Propose/Verify); leave it off for reviewing, reading and
    researching calls, whose prompts are assembled from untrusted material
    (diff hunks, fetched pages, artifact comments). `isolation: 'worktree'`
    does NOT imply it: a worktree call that writes still passes it explicitly.
    Backends without a sandbox concept (claude, omp, mock) ignore the option.
  - `opts.agentType` — the actual field name used by scripts (review.js:
    `agentType: 'code-reviewer'`/`'security-reviewer'`/`'go-perf-reviewer'`
    etc.; go-optimize.js: `agentType: 'go-perf-reviewer'`). **Note**: the
    task brief that commissioned this file calls this option
    `subagent_type` — that name does not appear in any script or in the
    skill body. yoki-graph accepts `opts.agentType` as canonical and
    `opts.subagent_type` as an accepted alias, so both spellings work.
  - Return-value semantics per the skill: "Returns null if the user skips
    the agent mid-run or the subagent dies on a terminal API error after
    retries (filter with `.filter(Boolean)`)." There is no interactive user
    to skip a call in a headless CLI run, so that half never applies; a
    terminal backend failure (process spawn error, non-zero exit with no
    usable output) resolves the call to `null` rather than rejecting, so a
    script's own `if (!x) { log(...); return {error: ...} }` early-exits
    keep working unmodified. A *schema validation* failure that survives one
    retry is architecturally different (schema.js's own "hard-fail after
    that" contract) and **rejects** the `agent()` promise instead — a script
    that asked for structured output and got none has no sane fallback value
    to hand back, and every schema-using script already treats "no object
    back" as fatal to that phase (`if (!plan || !plan.angles...) { return
    {error...} }`), so a reject just short-circuits earlier there while a
    script that WOULD catch it (none currently do) still can.
- `parallel(thunks: Array<() => Promise<any>>): Promise<any[]>` — a barrier;
  every element of the result array is non-null on success, `null` where a
  thunk rejected. The call itself never rejects.
- `pipeline(items, stage1, stage2, ...): Promise<any[]>` — every item flows
  through all stages independently (no barrier between stages); a stage
  callback receives `(prevResult, originalItem, index)`; a stage that throws
  drops that item to `null` and skips its remaining stages. Every
  multi-stage script in this repo uses this (research/acceptance/
  design-review/review all pipeline a "produce findings" stage into a
  "verify findings" stage per item).
- `budget: {total: number|null, spent(): number, remaining(): number}` — not
  used by any script in this repo today, but is part of the documented
  surface (turn-level token budget from a "+500k"-style directive). Since
  yoki-graph runs outside a Claude Code turn there is no such directive to
  read; `budget.total` is always `null` and `remaining()` is always
  `Infinity`, matching the skill's own "no target set" behavior. `spent()`
  sums the (best-effort) token counts recorded in this run's journal.
- `workflow(nameOrRef, args?): Promise<any>` — run another workflow inline
  and return its result; nesting is one level only (a child calling
  `workflow()` throws). Not used by any script in this repo today; supported
  because the skill documents it as core surface. yoki-graph resolves a name
  the same way its own CLI does (`~/.claude/workflows/<name>.js`) or accepts
  `{scriptPath}`.
- Restricted natives, per the skill ("Date.now()/Math.random()/argless `new
  Date()`... throw — they would break resume"): yoki-graph shadows `Date`
  and `Math` inside the executed script body only (not the host process) so
  `Date.now()`, `new Date()` with no arguments, and `Math.random()` throw;
  `new Date(x)` and every other `Math.*` member still work.

## Return value

Whatever the script's top-level `return` produces (or `undefined` if it
never returns) is the run's result — printed as the human summary / final
`--json` NDJSON event, and stored in the run's journal metadata.

## Execution mechanism (chosen)

`new Function` via the `AsyncFunction` constructor
(`Object.getPrototypeOf(async function(){}).constructor`), **not** a
temp-file ESM wrapper. Rationale:

1. Scripts use a bare top-level `return` inside their body (see above) —
   illegal in an ES module or a classic `<script>`-shaped file. Wrapping the
   body as the source of an `AsyncFunction` makes that `return` a normal
   function return, and top-level `await` "just works" because the function
   is async — with zero string surgery beyond stripping the leading
   `export const meta = {...}` declaration.
2. Globals are passed as **named parameters**, not `globalThis` mutation:
   `new AsyncFunction('args','phase','log','agent','parallel','pipeline',
   'budget','workflow','Date','Math', body)`, invoked with the concrete
   per-run implementations (plus the restricted `Date`/`Math` shims) as
   arguments. Parameter shadowing means the function body's references to
   `Date`/`Math`/`agent`/etc. resolve to what yoki-graph hands in, without
   ever touching the actual Node process's globals — safe for concurrent
   runs in the same process (e.g. `node --test`) and there is nothing to
   clean up afterward.
3. `meta` is extracted separately (regex for the balanced
   `export const meta = { ... }` block, evaluated with the very same
   `AsyncFunction`/`Function` trick since the skill requires it to be a pure
   literal) before the body is compiled, so `--dry-run`/`list`/`status` can
   read `meta.name`/`meta.phases` without executing anything.

See `runner.js` (`compileScript`) for the implementation.

## Backend-neutrality audit (T21)

Every script that ships in this repo — the 9 under `core/workflows/` plus
`packs/go/workflows/go-optimize.js` — was audited against the injected-globals
surface above for Claude-Code-only assumptions (subagent_type/model-tier
names, tool availability inside `agent()` calls, absolute paths, reliance on
the Workflow tool's own arg delivery). **Result: none of these 10 scripts
needed a functional change to run under `yoki-graph` on any of the three real
backends.** Every construct they use is already mapped generically:

- Model tiers (`'haiku'|'sonnet'|'opus'`) resolve per backend through
  `core/harness-models.json` (`backends/common.js` `resolveModel`) — scripts
  never see the difference.
- `opts.agentType` (and its `opts.subagent_type` alias — see "Injected
  globals" above) resolves to a preamble by reading `<name>.md` across the
  layered personal/core/pack `agents/` directories on every backend
  (`resolveAgentPreamble`) — a name with no matching file just drops that
  lane's specialization; it never errors. `review.js` and `go-optimize.js`
  are the only scripts that use this.
- `schema` enforcement is backend-uniform via `schema.js`'s
  append-instruction/extract/validate/retry-once/hard-fail pipeline, whether
  the backend enforces it natively (claude, codex) or the instruction is
  folded into the prompt (omp).
- `opts.isolation: 'worktree'` (`go-optimize.js`'s Propose phase) is a
  runner-level feature (`worktree.js`, real `git worktree` off `cwd`'s HEAD)
  that doesn't touch the backend at all.
- A handful of prompts *name* a Claude-Code tool (`WebSearch`/`WebFetch` in
  `research.js`/`deliberate.js`/`design-review.js`/`code-study.js`, the
  "Skill tool" in `implement.js`'s Deliver step) as prose guidance to the
  subagent. This is advisory text, not a script-level dependency — under
  codex/omp the subagent just has whatever tools it actually has; an
  unactionable instruction degrades to an `unknowns`/`unverified` entry
  (scripts already model that path) rather than failing the call. Each
  affected script carries a one-line arg-note documenting this; see the
  `// backends: claude, codex, omp (via yoki-graph)` comment block each
  script now carries right after its `meta` object.

The one real defect found was **not** a backend-portability issue:
`stocktake.js`'s memory-scanner prompt had two unescaped backticks around an
embedded shell command (`` `find . ~/.claude ...` ``) inside its own
template-literal string, which is a plain JavaScript syntax error — the
`AsyncFunction` compile step (`compileScript`) failed on it identically
regardless of backend, and it would have failed identically under the real
Workflow tool in Claude Code too (same "the body must be a valid script"
constraint the whole execution mechanism above rests on). Fixed by escaping
the two backticks (`` \` ``); no other line in that script changed.

Note on count: the task brief that commissioned this section says "11
workflow scripts". The repo's own `core/workflows/` + `packs/go/workflows/`
directories contain exactly 10 (9 + go-optimize) — confirmed by listing both
directories. All 10 that exist are covered below; there is no 11th script on
disk under either path.

### Results table

Produced by `test/scripts.test.js` (`node --test`), run against
`runner.executeScript` — the exact function `yoki-graph run <name> --backend
mock --mock <file>` dispatches into (see `cli.js`'s `cmdRun`) — with a canned
fixture per script under `test/fixtures/<name>.mock.json`. "Phases reached"
lists every literal `phase(...)` call the script actually executed for that
fixture. Several scripts additionally pass a `phase` value through an
`agent()` call's `opts` (e.g. review.js's `{ phase: 'Review', ... }` inside
its pipeline) purely to label that call's progress-tree grouping — that is
NOT a `phase(...)` narrator call and does not appear here, only in `meta`'s
own `phases` list and the per-call event stream (`agent-start`'s `phase`
field). "Return keys" are the top-level keys of the object the script's own
`return` produced.

| script | phases reached | return keys |
|---|---|---|
| acceptance | Ground, Gaps, Report | `verdict, rows, gaps, decisions, report` |
| code-study | Map, Check, Report | `target, answers, checked, refuted, not_found, report` |
| deliberate | Ground, Reframe, Diverge, Gate, Converge, Challenge, Synthesize | `question, real_question, options, criteria, gate, convergence, objections, answer` |
| design-review | Gather, Panel, Synthesize | `verdict, report, findings, unverified, open_questions` |
| implement | Load, Schedule, Implement, Gate, Deliver | `tasks, schedule, gate, delivery, note` |
| preflight | Collect, Judge, Fix, Gate | `status, branch, base, auto_fixed, judge_rejected, report_only, gate, note` |
| research | Plan, Synthesize | `report, unknowns` |
| review | Collect | `intent, findings, unverified, metrics` |
| stocktake | Scan, Synthesize | `report, drop_candidates, fix_items` |
| go-optimize | Resolve, Profile, Propose, Gate, Verify, Deliver | `pkg, targetBench, threshold, accepted, rejected, reportPath, rejectedPath, delivery, note` |

Every row above reached `status: 'ok'` (its final top-level `return`)
without throwing, under `--backend mock`. `go-optimize`'s Propose phase also
exercises `opts.isolation: 'worktree'` for real — the test runs it inside a
throwaway `git init`'d repo so the real `git worktree add`/`remove` cycle
(one per angle, 4 in parallel) completes cleanly against disposable state.

### `--backend codex --dry-run` / `--backend omp --dry-run` for review/research

The task brief asked for these two flags specifically, "asserting the
printed argv (no real execution)". Investigated and **implemented
differently, deliberately**: `agent()`'s dry-run branch (`api.js`, guarded by
`ctx.dryRun`) returns its placeholder value *before* ever calling
`ctx.backend.run`/`buildArgv` — by design, for **any** backend, `--dry-run`
never spawns a backend process or even resolves what argv it would use. That
is the correct behavior for a cost-safety flag, but it means there is no
codex/omp-*specific* argv to assert on down that path — every backend
produces the identical placeholder, so a literal `--dry-run` run proves
nothing backend-specific.

What actually proves "the printed argv, no real execution" is exercised
instead: `test/scripts.test.js` stubs *only* `codex.run`/`omp.run` (the part
that would call `spawnCollect` and spawn a real process) to instead call
that backend's own real, unit-tested `buildArgv()` and return a canned
answer — the script runs for real, end to end, through the real backend
selection and the real per-call `model`/`schema`/`agentType`/`effort`
resolution, and the exact argv each label would have produced is captured
and asserted on (e.g. codex's `collect-diff` call carries
`--output-schema <file>`, ends in `-`; omp's carries no dedicated schema
flag at all, `--no-extensions`, `-e <bridge>`; the `security` lane's model
resolves through `harness-models.json` to something other than the bare
`'opus'` tier name) — with zero process ever spawned. Four tests total:
review × {codex, omp}, research × {codex, omp}, all passing.
