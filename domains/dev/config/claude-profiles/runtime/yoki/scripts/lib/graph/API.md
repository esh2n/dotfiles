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
  - `opts.model` — `'haiku' | 'sonnet' | 'opus'` (or a backend-specific role
    key from `core/harness-models.json`, e.g. omp's `review`/`scout`), or a
    backend-native model id passed straight through. Omitted = inherit the
    run's `--model`. See "Model resolution" below: a tier that the backend's
    map does not have is an ERROR listing the valid tiers, not a value passed
    on to the CLI.
  - `opts.effort` — `'low'|'medium'|'high'|'xhigh'|'max'`, passed through to
    the backend for the tiers that accept it (omp has `--thinking`; codex
    has no such flag, so the value is folded into the prompt preamble and
    the comment in backends/codex.js says so).
  - `opts.backend` — `'codex' | 'omp' | 'mock'`, overriding the run's
    `--backend` for THIS call. Omitted = the run's backend. See "Per-call
    backends" below; this option is yoki-graph's own, with no Workflow-tool
    counterpart (inside Claude Code the equivalent is a provider lane — see
    `core/workflows/lib/lanes.js`).
  - `opts.isolation: 'worktree'` — run this one agent() call inside a fresh
    `git worktree`, auto-removed after if the tree is clean.
  - `opts.sandbox` — `'read-only' | 'workspace-write' | 'danger-full-access'`.
    **Defaults to `'read-only'`** on every real backend, so a call only gets
    filesystem write authority when the script asks for it. Set
    `sandbox: 'workspace-write'` on the calls that actually edit, commit, or
    run a build (implement.js's Implement/Delivery, preflight.js's auto-fix,
    go-optimize.js's Propose/Verify); leave it off for reviewing, reading and
    researching calls, whose prompts are assembled from untrusted material
    (diff hunks, fetched pages, artifact comments). `isolation: 'worktree'`
    does NOT imply it: a worktree call that writes still passes it explicitly.

    How each backend enforces it:

    | backend | `read-only` | `workspace-write` / `danger-full-access` |
    | --- | --- | --- |
    | codex | `-s read-only` (native) | `-s <mode>` |
    | omp | `--tools read,grep,glob,web_search` (allow-list) | no extra flag |
    | mock | n/a — nothing is spawned | n/a |

    An unknown value is a hard error on every backend, never a silent
    widening. omp used to accept `opts.sandbox` and discard it, which made
    the read-only default a property of one harness rather than of the API.
  - `opts.timeoutMs` — wall-clock ceiling for this one call. Falls back to
    the run's `--timeout`, then to a 15-minute default; `0` disables it.
    A child that runs past it is SIGKILLed, journaled with `timedOut: true`,
    and (being a transient failure) retried. See "Execution caps, retry and
    timeouts" below.
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
  surface (turn-level token budget from a "+500k"-style directive). There is
  no Claude Code turn directive to read outside a turn, so the numbers come
  from this run's own token cap instead: `total` is `graphMaxTokens` when one
  is configured (else `null`), `remaining()` is the real headroom under it
  (else `Infinity`), and `spent()` sums the token counts recorded in this
  run's journal. `remaining()` used to be a hardcoded `Infinity`, which made
  `while (budget.remaining() > 0) await agent(...)` an unbounded loop with
  nothing to stop it — see the caps section below.
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

## Backends

`codex`, `omp` and `mock`. There is deliberately no `claude` backend:
yoki-graph exists to run these scripts from harnesses that have NO Workflow
tool, and inside Claude Code the native Workflow tool is the supported path.
Driving `claude -p` from here was a second, unsupported route to the same
result — one that may move to metered billing — so `--backend claude` is
refused by name ("inside Claude Code use the native Workflow tool;
yoki-graph backends are codex, omp, mock") rather than reported as an
unknown value, and `backends/claude.js` is gone from disk. The same decision
removed `--harness claude` from yoki-loop, where Claude Code's own `/loop`
and scheduled routines already cover the need.

### Per-call backends

`--backend` sets the run's default; `agent(prompt, {backend: 'omp'})`
overrides it for one call, so a single run can mix codex and omp lanes.
What is shared and what is per call:

| per call | shared by the run |
| --- | --- |
| the backend module (`buildArgv`, `run`, `extractText`, `extractUsage`, `supportsSchemaNatively`) | the concurrency limiter — ONE semaphore, so a mixed run does not get double the machine load |
| model resolution, against THAT backend's tier map (`sonnet` is a different id on codex than on omp) | the journal, the run lock, `--resume`'s index sequence |
| the sandbox default and how it is expressed | the agent-call / token / wall-clock caps (budget.js) |
| the usage reader, and therefore the token semantics | the `run.json` totals and the per-model table |

The resolution lives in `backends/index.js` rather than in runner.js because
api.js needs it too and may not require runner.js (which requires api.js).

An unknown per-call backend is FATAL, not a lane that resolves to `null`:
`parallel()`/`pipeline()` re-raise it the way they re-raise a budget breach.
A typo'd `{backend: 'codexx'}` degrading to `null` would look exactly like
"that provider found nothing", in every lane at once.

`yoki-agent` (`domains/dev/bin/yoki-agent`, implemented in `agent-cli.js`)
runs exactly ONE such call from the command line, through this same
`agent()`. It is what a Claude Code provider lane shells out to, since
Claude Code cannot spawn codex/omp itself:

```
yoki-agent --backend codex|omp|mock [--model <tier|id>] [--schema <f.json>]
    [--sandbox read-only|workspace-write|danger-full-access] [--cwd <dir>]
    [--effort <level>] [--agent-type <name>] [--timeout <ms>] [--retries N]
    [--model-map <tier>=<id>,...] [--label <text>] [--mock <file>] [--dry-run]
    --prompt-file <file> [--json]
```

Exit codes — the contract a lane's transport agent branches on: `0` ok,
`1` usage (bad flags, unreadable prompt/schema, unknown backend, misspelled
model tier), `2` backend error (spawn failure, non-zero exit, timeout after
retries, or a budget breach), `3` schema validation failed after the one
retry. Under `--json` stdout is the result and nothing else, so the caller
can parse it whole; the one-line footer (resolved model, tokens, cached,
duration) goes to stderr.

`YOKI_AGENT_MOCK=<fixture.json>` reroutes ANY requested backend to the mock
one with that fixture — how a provider lane is exercised without codex/omp
installed. The footer still names the backend that was asked for
(`backend=mock (requested codex)`), so a mock run is never mistakable for a
real one.

The daily WORKFLOW cap (guard.js, shared with workflow-guard.sh) is
deliberately NOT charged per `yoki-agent` call: one review with six codex
lanes is one workflow launch, not seven, and a five-launch day would
otherwise be spent inside a single run. The per-run budget caps (budget.js)
ARE charged, through the same `assertWithinCaps` every workflow call uses.

## `--resume`: an index-ordered prefix replay

`--resume <runId>` does NOT look results up by key. It replays the longest
PREFIX of this run's `agent()` calls that still matches the journal:

1. Every `agent()` call gets an `index` — its position in this run's arrival
   order — recorded in the journal alongside its `key`
   (`sha256(prompt + NUL + JSON(opts + resolved backend + resolved model))`).
2. A resumed run walks its own calls 0, 1, 2, … and replays call *i* only
   while the journal holds a completed (`status: 'ok'`) entry at index *i*
   whose key matches. Replaying costs nothing: no process is spawned and the
   agent-call cap is not charged.
3. The FIRST mismatch ends the replay for good (a `resume-diverged` event is
   emitted with the index). Everything from there on runs live — including
   calls whose own prompt is byte-identical to a recorded one, because their
   upstream changed and a result computed from a different upstream is not
   the same work.

The key is label-aware in the way codex-dynamic-workflows' is: a label the
*script* chose is part of the caller's identity and stays in the key (two
lanes that send the same prompt under different labels are different work),
while an auto-generated one (`(unlabeled)`, `agent-<n>`) is stripped — it
embeds arrival order, which interleaves nondeterministically under
concurrency, so keeping it would miss the replay on every rerun.

The key also carries what the RUNNER resolved — the per-call backend and the
concrete model id — not just what the script typed. `opts.model` cannot
stand in for them: it is often absent (the call inherits the run's
`--model`) or a tier name whose meaning `--model-map` can redefine. Without
this, a resume that changed `--model`, `--model-map` or a call's `{backend}`
replayed the answer a DIFFERENT model produced, which is not the same work.

Failed and retried calls are never replayed: a resumed run retries them.

**Generations, not file order.** `agent()` calls complete out of order under
concurrency, so a journal's LINE order is completion order while `index` is
arrival order. Each `executeScript` invocation against a runId therefore
stamps its entries with a `gen` number (one more than the highest already in
the file). Applied oldest generation first, each generation overrides its own
indices and truncates anything past its highest one: what it wrote below its
divergence point was replayed and confirmed, what sits above the last index
it reached is stale, because it changed the upstream and never got there.

## Model resolution

One place resolves a tier to a model id: `lib/graph/models.js`, called by
`agent()` before the backend is invoked. Precedence is per-call
`agent({model})` > the run's `--model` > nothing (the backend's own default).

| input | result |
| --- | --- |
| a tier in the backend's map (`sonnet`, or omp's `review`) | the mapped id |
| a tier the map does not have (`sonnett`) | **error**, listing the valid tiers |
| a concrete id (`gpt-5.5`, `anthropic/claude-sonnet-5`) | passed through |
| anything, on a backend with no map (mock) | passed through |

"Shaped like a tier" is a bare lowercase word — every real model id carries a
digit, a dash or a provider prefix. Getting that wrong in the safe direction
only means an unknown id reaches the backend, which reports it; the shared
reader's old behaviour of passing `sonnett` through meant `codex -m sonnett`
failed far from the typo.

`--model-map haiku=gpt-5.4-mini,sonnet=gpt-5.5` layers over the file's map
for one run: it overrides an existing tier and can add one the file lacks,
without editing `core/harness-models.json`.

Resolution happens in the runner, not the backend, because the RESOLVED id is
what has to be visible: every `agent-start`/`agent-end`/`agent-progress`
event carries `backend` and `model` (plus `modelTier` on start), every
journal entry records both, and the end of a run prints a per-model table of
calls, tokens, cached tokens and model-seconds (`journal.usageByModel()`,
also stored in `run.json` so `yoki-graph status` can reprint it). A progress
line reading "sonnet" says nothing about which model actually ran once
`--model-map` or a per-call override is in play.

The table's rows are keyed by BACKEND + resolved id, and the backend column
appears only when a run actually mixed backends — a mixed run must not blur
two CLIs' spend into one row, and a single-backend run gains no noise. The
accounting is printed BEFORE the JSON result, not after: a workflow result
runs to thousands of lines, and a table below it is scrolled off a TTY and
buried at the bottom of a redirected log.

## Live progress

The `--json` NDJSON stream is the machine-readable source of truth. It gained
`model`, `backend`, `modelTier`, `index` and `phases` fields, plus one new
event: `agent-progress`, emitted whenever a running agent's tool-call count
moves. Each backend counts that from its own stream as it arrives —
`spawnCollect`'s `onData` feeds complete lines to a per-backend counter
(codex's `exec_command_begin`/`item.started` events, omp's `tool_use` blocks;
the mock backend reports one synthetic tick so the whole path is exercised
offline). A counter that throws is swallowed: progress is advisory and must
never fail the agent it reports on.

For a human, `progress.js` folds the same events into one compact status:

    phase 2/5 Review — running 3 / done 7 / failed 0 — [security gpt-5.6-sol 41s +3 tools] …

On a TTY that line is redrawn in place with `\r`, with phase headers, logs
and finished agents scrolling past above it. Off a TTY there is no status
line at all — a carriage-return redraw in a log file is one unreadable line —
so the same events print one per line, as before.

`yoki-graph status <runId> --watch` re-renders the same status every 2s by
folding the run's journal, until `run.json` stops saying `running`, then
prints the ordinary `status` report. The journal is in COMPLETION order, so
the reconstruction pairs entries by `index`: a call with no entry below the
highest index seen is still in flight.

## Execution caps, retry and timeouts

`guard.js`'s daily cap limits how many runs start in a day; it does nothing
about one run that never stops. Three per-run caps do (`budget.js`):

| cap | `.yoki.json` | CLI flag | env | default |
| --- | --- | --- | --- | --- |
| `agent()` calls | `graphMaxAgentCalls` | `--max-agent-calls` | `YOKI_GRAPH_MAX_AGENT_CALLS` | 1000 |
| tokens | `graphMaxTokens` | `--max-tokens` | `YOKI_GRAPH_MAX_TOKENS` | none |
| wall clock (ms) | `graphMaxWallMs` | `--max-wall-ms` | `YOKI_GRAPH_MAX_WALL_MS` | none |

Resolution is CLI flag > `.yoki.json` (searched upward from `cwd`, the same
file and the same reader the daily cap uses) > env > default; `0` disables a
cap. A breach throws `BudgetExceededError` from `agent()` and ends the run:
`parallel()`/`pipeline()` fold an ordinary lane failure into `null` but
re-raise this one, because a cap that degrades to `null` is a cap the runaway
loop keeps running past. Caps apply in `--dry-run` too.

**Backend retry** (`retry.js`) is a separate layer from schema.js's retry:
schema.js retries a MODEL whose output violated the shape, this retries a
PROCESS that failed. A transient failure — 429, an explicit 5xx, a timeout
kill, `EPIPE`/`ECONNRESET`, "overloaded" — is retried with exponential
backoff (500ms, 1s, 2s, … capped at 5s), up to `--retries N` (default 2)
per backend invocation. Anything else fails on the first attempt: retrying
`spawn codex ENOENT` three times only costs wall time. Each retry is
journaled as its own `status: 'retry'` line (invisible to the resume prefix,
which only replays `ok`) and emitted as an `agent-retry` event.

**Timeouts**: `opts.timeoutMs` > the run's `--timeout` > 15 minutes. The
child is SIGKILLed and `spawnCollect` reports `timedOut: true`, which the
backend turns into an error marked `transient` — so a wedged call is retried
rather than silently reported as an ordinary crash.

## Token accounting

Each backend reads its own primary source, off the RAW envelope before
`extractText` unwraps it:

| backend | source | what counts as spend |
| --- | --- | --- |
| codex | `turn.completed` events in the `--json` stream (summed); falls back to a rollout `token_count` record's `total_token_usage` | `input_tokens + output_tokens`. The cached counts are **excluded** |
| omp | an assistant record's `usage` (`{input, output, cacheRead, cacheWrite, totalTokens, cost}` — omp's camelCase names, pinned by spike S4-S5-omp.md and read the same way by `lib/harness/session.js`); `cost` is the only USD figure any backend reports | the record's own `totalTokens`, which **includes** `cacheRead`/`cacheWrite` |
| mock | none — nothing is spawned | — |

**The two backends treat cached tokens oppositely, and that is not a bug.**
In codex's accounting `cached_input_tokens` is the cached PART of
`input_tokens` — a subset, not an extra charge — so adding it double-counted
every cached prefix: a real review run reported 7.46M tokens against a true
~4.1M, because e.g. `{input 77961, cached 57856, output 884}` was booked as
136701 instead of 78845. In omp's, `input` is ~2 tokens beside a 50k
`cacheRead` and the record's own `totalTokens` equals
`input+output+cacheRead+cacheWrite`, so its cached counts are disjoint from
its input and DO belong in the total.

Either way the cached number is kept and reported separately — as its own
`cached` column in the per-model table and its own `N cached` clause in the
usage line — never folded into `tokens`. How much of the input was served
from cache is worth seeing; it just is not a second charge.

When a backend reports nothing, the call is charged an explicit ESTIMATE
(~4 characters per token) labelled `tokensSource: 'estimated'`, never a
silent zero: a zero looks like a free call. A journal entry carries `tokens`,
`tokensSource` (`reported` | `estimated` | `mixed`) and a `usage` breakdown;
the run's `run-end` event, `run.json` and `yoki-graph status` report the
totals with measured and estimated kept apart, so the numbers can be
reconciled against the cost tracker without mixing the two.

Reading usage off the unwrapped answer text (the previous behaviour) could
not work at all for a backend whose envelope carries the usage block and
whose `extractText` returns a bare answer string, so `budget.spent()` sat
silently at zero.

## Run lock

One live process per runId. `<runDir>/lock` is created with the `wx` flag
(atomic; no check-then-create race) holding `{pid, host, startedAt, token}`.
A second `--resume` on the same id returns `status: 'locked'` and exits 1
without running a line of the script. A lock is stale — and taken over —
when its pid is gone on this host, or after an hour regardless of host (a
foreign pid says nothing about liveness here). `token` makes release safe: a
process only removes the lock it wrote.

## Schema: strict on the wire, loose for validation

Workflow scripts declare LOOSE schemas (optional properties absent from
`required`). OpenAI-style structured output — `codex exec --output-schema` —
requires the strict form: `additionalProperties: false` everywhere and every
property in `required`. Writing the loose schema out verbatim was either a
rejection or a silent downgrade.

`schema.js`'s `toStrictJsonSchema` builds a strict COPY for the wire:
optional properties become nullable (widening an `enum` too, since
`type: [X, 'null']` with an enum listing only the original values is
unsatisfiable), `$defs`/`definitions`/`patternProperties` are treated as maps
of subschemas rather than schema nodes, and a schema-valued
`additionalProperties` is preserved instead of being forced to `false`
(forcing it would restrict the model to `{}`). The caller's schema is not
mutated, and validation still runs against it — so what a script sees is
exactly what it declared. `stripNullOptionals` then drops the explicit nulls
a strict-mode model returns for absent optional properties, before
validating. Backends without native schema support (omp) keep the
prompt-embedded fallback unchanged.

Mechanisms in this section were re-implemented from the designs described in
`six-ddc/codex-dynamic-workflows` (strict schema conversion, generic retry,
run lock, execution caps) and `tintinweb/pi-subagents` (index-ordered prefix
replay); no code was copied from either.

## Backend-neutrality audit (T21)

Every script that ships in this repo — the 9 under `core/workflows/` plus
`packs/go/workflows/go-optimize.js` — was audited against the injected-globals
surface above for Claude-Code-only assumptions (subagent_type/model-tier
names, tool availability inside `agent()` calls, absolute paths, reliance on
the Workflow tool's own arg delivery). **Result: none of these 10 scripts
needed a functional change to run under `yoki-graph` on either real
backend.** Every construct they use is already mapped generically:

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
  the backend enforces it natively (codex) or the instruction is folded into
  the prompt (omp).
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
  `// backends: codex, omp (via yoki-graph)` comment block each
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
