/**
 * The gate at the end of a response: typecheck and lint once, and hand a
 * failure back as a continuation.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` puts the
 * typecheck-and-lint gate at the end of the turn and requires a self-imposed
 * cap, because a gate that loops is expensive (35k tokens / 20 minutes on the
 * record it cites).
 * omp's `session_stop` allows up to 8 advisory continuations
 * (`{continue: true, additionalContext}`) before it stops honoring them; this
 * gate stops at TWO per session, the same reasoning as pi's own cap: the
 * budget is not an allowance to spend.
 *
 * It never uses `{decision: "block"}`. That form does not consume omp's
 * budget and keeps blocking "until the hook allows completion or the user
 * interrupts" — an unresolvable lint error would make the session
 * un-endable. A gate is advice at the end of a turn, not a lock.
 *
 * Subagent sessions: omp's own documentation says `session_stop` "never
 * fires for task/subagent sessions". Nothing on `ExtensionContext` or on the
 * event identifies a subagent session, so this handler CANNOT assert that
 * claim from the inside — see `isSubagent` below for what it can do instead.
 */

import { existsSync, readdirSync } from "node:fs";
import type { ReadDir } from "../../../src/domain/hooks/format";
import {
  type GateCommand,
  type GatePlan,
  type TableGate,
  gateCommandFor as chooseGateCommand,
  gatePlanFor as choosePlan,
  gateWantsChangedFiles,
  projectHooksFor,
  tail,
} from "../../../src/domain/hooks/gate";
import { missingToolReason } from "../../../src/domain/hooks/project-hooks";
import type { OmpContext, OmpSessionStopEvent, OmpSessionStopResult } from "./omp";
import {
  type ChangedFiles,
  type CommandResult,
  type Runner,
  changedFiles,
  runCommand,
} from "./run";

/** Continuations this gate will ask for, per session. omp's own ceiling is 8. */
export const MAX_CONTINUATIONS = 2;

const TIMEOUT_MS = 180_000;

/** The table's `.sln` / `.csproj` lookup; an unreadable directory is empty. */
const readDirSync: ReadDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * Which check a project answers to, and how a failure is trimmed, are jig's
 * own (`src/domain/hooks/gate.ts`) — shared verbatim with the Claude Code Stop
 * hook, so the two harnesses gate on the same command. That includes the
 * precedence of
 * `rules/decisions/2026-09-23-project-hooks-first-jig-table-fallback.md`
 * (`gatePlanFor`: the project's lefthook / pre-commit on the files this turn
 * touched first, the marker table only without one) and the eleven-language
 * table of `2026-09-23-all-languages-format-and-gate.md`. Wrapped here only
 * to bind omp's `existsSync` / `readdirSync` defaults, which a pure module
 * does not get to have.
 */
export type { GateCommand, GatePlan, TableGate };
export { tail };

export function gateCommandFor(
  cwd: string,
  exists: (p: string) => boolean = existsSync,
  changed: readonly string[] | undefined = undefined,
  readDir: ReadDir = readDirSync,
): TableGate {
  return chooseGateCommand(cwd, exists, changed, readDir);
}

export function gatePlanFor(
  cwd: string,
  changed: readonly string[] | undefined,
  exists: (p: string) => boolean = existsSync,
  readDir: ReadDir = readDirSync,
): GatePlan {
  return choosePlan(cwd, exists, changed, readDir);
}

/** Continuations already spent, per session id. Lives as long as the process. */
const spent = new Map<string, number>();

/**
 * Sessions already told their project's hook runner is not installed. Said
 * once per session: the fix is the owner's, and repeating it buys nothing.
 */
const toldMissing = new Set<string>();

/** Test seam: forget what this process has counted. */
export function resetGate(): void {
  spent.clear();
  toldMissing.clear();
}

export interface GateDeps {
  readonly run?: Runner;
  readonly exists?: (path: string) => boolean;
  /** For the table's `.sln` / `.csproj` lookup. */
  readonly readDir?: ReadDir;
  /** The files this turn touched; only asked when the plan is file-scoped or the project has a hook config. */
  readonly changedFiles?: ChangedFiles;
  readonly timeoutMs?: number;
  readonly maxContinuations?: number;
  /**
   * Whether this stop belongs to a task/subagent session, which the gate
   * skips entirely.
   *
   * omp's documentation says `session_stop` never fires for a task/subagent
   * session, and that claim CANNOT be asserted from inside the handler:
   * neither `SessionStopEvent` nor `ExtensionContext` carries anything that
   * names a subagent run, and no environment marker for one is documented.
   * So the default answers "no" unless one of the env names below happens to
   * be set (an escape hatch for an operator who finds such a marker, not a
   * documented contract), and the continuation cap is what actually bounds
   * the cost if the claim turns out to be wrong. The seam exists so that the
   * day omp exposes the fact, one function changes.
   */
  readonly isSubagent?: () => boolean;
}

function subagentByEnv(env: NodeJS.ProcessEnv): boolean {
  return env.OMP_SUBAGENT === "1" || env.PI_SUBAGENT === "1" || env.OMP_TASK_AGENT === "1";
}

/**
 * One `session_stop`, gated. Exported so it can be exercised without omp.
 * Returns `undefined` to let the session settle.
 */
export async function gateOnStop(
  event: OmpSessionStopEvent,
  ctx: OmpContext,
  deps: GateDeps = {},
): Promise<OmpSessionStopResult | undefined> {
  const isSubagent = deps.isSubagent ?? (() => subagentByEnv(process.env));
  if (isSubagent()) return undefined;

  const session = event.session_id ?? ctx.sessionManager?.getSessionId() ?? "";
  const cap = deps.maxContinuations ?? MAX_CONTINUATIONS;
  if ((spent.get(session) ?? 0) >= cap) return undefined;

  const exists = deps.exists ?? existsSync;
  const readDir = deps.readDir ?? readDirSync;
  // git is only asked when there is something to hand the list to: the
  // project's hook runner, or a file-scoped entry of the table.
  const hooks = projectHooksFor(ctx.cwd, exists);
  const changed = gateWantsChangedFiles(ctx.cwd, exists, readDir)
    ? await (deps.changedFiles ?? changedFiles)(hooks?.root ?? ctx.cwd)
    : undefined;
  const plan = gatePlanFor(ctx.cwd, changed, exists, readDir);
  if (plan.kind === "nothing") return undefined;

  const run = deps.run ?? runCommand;
  // In order; the first failure is the one reported. A table tool that is
  // not installed is skipped and the rest still run.
  for (const command of plan.commands) {
    const result: CommandResult = await run(command.bin, command.args, {
      cwd: plan.cwd,
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
    if (result.missing) {
      // A missing toolchain is not a failing check: a repo whose `tsc` is not
      // installed must still be able to finish a turn. The project's own hook
      // runner is the exception — the ruling forbids the table as its
      // substitute, so the owner is told to install it, once per session.
      if (plan.source !== "project" || hooks === undefined) continue;
      if (toldMissing.has(session)) return undefined;
      toldMissing.add(session);
      spent.set(session, (spent.get(session) ?? 0) + 1);
      return { continue: true, additionalContext: missingToolReason(hooks) };
    }
    if (result.code === 0) continue;

    const used = (spent.get(session) ?? 0) + 1;
    spent.set(session, used);
    const output = tail(`${result.stdout}\n${result.stderr}`.trim());
    return {
      continue: true,
      additionalContext:
        `jig gate: \`${command.label}\` failed (exit ${result.code}). ` +
        `Fix what it reports before finishing — continuation ${used} of ${cap}, ` +
        `after which the turn ends whatever the gate says.\n\n${output}`,
    };
  }
  return undefined;
}
