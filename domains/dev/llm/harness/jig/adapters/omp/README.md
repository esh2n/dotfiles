# jig's omp (oh-my-pi) adapter

One omp extension carrying the five hooks
`rules/decisions/2026-09-22-hooks-five-events.md` allows, one per event:

| omp event | what runs | file |
|---|---|---|
| `tool_call` | the guard — the enforcement point | `src/guard.ts` |
| `session_start` | the session's model, written to `sessions.jsonl` | `src/session.ts` |
| `before_agent_start` | hold the session on its LiteLLM tier (`proxy/main` unless `/tier` or `OMP_TIER` picked another): put the model back when omp's startup order or a `/model` pick landed on a direct provider — never a judgment, never automatic (`rules/decisions/2026-09-23-tier-fixed-main-subagent-escalation.md`); the same hold runs at `session_start` | `src/tier.ts` |
| `tool_result` | format the edited file, silently — the project's lefthook / pre-commit first, jig's table only without one | `src/format.ts` |
| `session_stop` | the project's hooks on the touched files, else typecheck/lint; once, capped at 2 continuations | `src/gate.ts` |

Skill selection at prompt submit stays Claude Code's; omp's prompt-submit
slot only holds the session's tier. A stronger model is reached through a
subagent whose `model:` maps to `proxy/complex` (`agents/models.json`), the
same shape pi's `extensions/tier-router.ts` now has.

## The tool table

`src/map.ts` translates omp's tools into jig's vocabulary. Nothing here
judges; `src/domain/policy/request.ts` and `evaluate.ts` do.

| omp tool | jig action | read from |
|---|---|---|
| `bash` | `shell.exec` | `command` |
| `eval` | `shell.exec` | `code`, plus the command strings embedded in the cell |
| `write` | `fs.write` (`net.fetch` for an http(s) target) | `path` |
| `edit` / `apply_patch` | `fs.edit`, `fs.write` per file | `paths` → `path` → hashline sections → apply_patch envelope |
| `read` (file) | `fs.read` | `path`, trailing selector peeled |
| `read` (http(s) URL) | `net.fetch` | `path` |
| `mcp__<server>_<tool>` | `mcp.call` (`fs.edit` for serena's editing tools) | the name, canonicalized |
| anything else | — | out of scope: silence |

Four omp-specific things this closes:

- **`eval` is not covered by `bash.patterns`.** omp's pattern policy "controls
  approval for the `bash` tool" only, so a denied command runs unchallenged
  inside a Python or JavaScript cell. The cell body is judged as a shell
  command, and the command strings inside it are pulled out too — otherwise
  `os.system("rm -rf /tmp/x")` reads as a program called `os.system` and no
  rule about `rm` ever fires.
- **`edit` carries no path** in its default hashline mode; it is fanned out
  per file, the way codex's `apply_patch` already was.
- **`read` is also the fetch tool**; an http(s) path is a `net.fetch`.
- **MCP names join server and tool with one underscore**, not two.

## Ask

omp's `tool_call` result is `{block, reason, input}` — there is no "ask".
An `ask` verdict is resolved through `ctx.ui.confirm(title, message)`, which
`ExtensionUIContext` provides in interactive, RPC and ACP modes; with no
screen (`hasUI === false`, a headless run, a subagent) it becomes a block
carrying the rule's reason. An ask never becomes a silent allow.

Failures are blocks, never silence: an unreadable policy, a core that will
not load, an over-budget judgment (5 s), an `edit` payload whose target
cannot be read, and any crash all block with a reason that says what to fix.
omp has no OS sandbox and no trust gate, so this handler is the only thing
between the model and the machine.

## Gate

`session_stop` runs one check and on failure returns
`{continue: true, additionalContext: <tail>}`. Which check follows
[`2026-09-23-project-hooks-first-jig-table-fallback.md`](../../../rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md):
a project with `lefthook.yml` / `.lefthook.yml` / `.pre-commit-config.yaml` gets
`lefthook run pre-commit --file <f>…` / `pre-commit run --files <f>…` on the
files the turn touched (`git diff --name-only --relative HEAD` plus untracked;
git absent or nothing changed → nothing runs); only a project with no such
file gets jig's table — `bunx tsc --noEmit`, `go vet ./...`, `ruff check`, or
`cargo check`. omp allows 8 advisory continuations; this stops at **2 per
session** and then lets the turn end. It never uses `{decision: "block"}`,
which would keep blocking until a handler relents. A missing toolchain is not
a failure — except the project's own hook runner, which is never replaced by
the table: the session is told once to install it. Subagent sessions are
skipped (see the caveat below).

## Installing it

The generator links this package; do not copy it by hand.

- Link target: `src/index.ts` → `~/.omp/agent/extensions/jig.ts` (under a
  named profile, `~/.omp/profiles/<name>/agent/extensions/jig.ts`).
- Or, for a one-off session: `omp -e <this dir>/src/index.ts`.
- `--no-extensions` still loads an explicit `-e` path.

There is no build step, deliberately. omp runs on Bun and loads TypeScript
extensions directly, so the extension finds jig's source tree from its own
real path and imports it at runtime (`src/jig.ts`) — the same technique the
pi extension uses, and for the same reason: a symlinked file resolves
relative imports against the link, not the repo. The DSH adapter bundles
instead only because dsh loads plain JS; a bundle here would add a build
step whose output could drift from the core it copies.

The guard reads the shared policy from `JIG_POLICY_FILE`, else
`~/.config/jig/policy/guard-rules.json`; the audit and session logs come from
`JIG_STATE_DIR`, else `~/.local/state/jig`. Same variables as every other
adapter (`src/app/hooks/environment.ts`).

## Version pin

Typed structurally against `@oh-my-pi/pi-coding-agent` **18.2.8** (upstream
`main`, 2026-09-22); the machine this was written on runs the 18.0.4
Homebrew build. `src/omp.ts` names every field used and where it came from,
so a contract change shows up as a typecheck failure in one file. The
package is an optional peer dependency — nothing imports it at runtime.

## What is still unverified

- No live payload was ever captured: the surface record's own attempt failed
  at credential resolution, so the event shapes come from omp's sources and
  docs, not from a recorded call.
- `paths`/`path` on a normalized hashline `edit` event are documented in
  omp's `ToolCallEventResult` comment but were not observed; the adapter
  parses the payload when they are absent, so both paths are covered.
- omp says `session_stop` never fires for a task/subagent session. Nothing on
  the event or the context identifies one, so the gate cannot assert it; the
  continuation cap is what bounds the cost if the claim is wrong.
- Whether omp's loader resolves a dynamic `import()` of an absolute `.ts`
  path from inside an extension. If it does not, the guard blocks with "the
  jig guard could not be loaded", which is the intended failure direction.
