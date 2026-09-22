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

import { existsSync } from "node:fs";
import type { OmpContext, OmpSessionStopEvent, OmpSessionStopResult } from "./omp";
import { type Runner, runCommand } from "./run";

/** Continuations this gate will ask for, per session. omp's own ceiling is 8. */
export const MAX_CONTINUATIONS = 2;

const TIMEOUT_MS = 180_000;
const TAIL_LINES = 40;
const TAIL_CHARS = 4_000;

export interface GateCommand {
  readonly label: string;
  readonly bin: string;
  readonly args: readonly string[];
}

/**
 * The check this project answers to, by what is in its root. One project,
 * one check: the gate is a backstop, not a build.
 */
export function gateCommandFor(
  cwd: string,
  exists: (p: string) => boolean = existsSync,
): GateCommand | undefined {
  const has = (name: string): boolean => exists(`${cwd}/${name}`);
  if (has("tsconfig.json")) {
    return { label: "bunx tsc --noEmit", bin: "bunx", args: ["tsc", "--noEmit"] };
  }
  if (has("go.mod")) return { label: "go vet ./...", bin: "go", args: ["vet", "./..."] };
  if (has("pyproject.toml") || has("ruff.toml") || has(".ruff.toml")) {
    return { label: "ruff check", bin: "ruff", args: ["check", "."] };
  }
  if (has("Cargo.toml")) {
    return { label: "cargo check", bin: "cargo", args: ["check", "--quiet"] };
  }
  return undefined;
}

/** The last lines of a failed run, which is all the model needs to act. */
export function tail(text: string, lines = TAIL_LINES, chars = TAIL_CHARS): string {
  const kept = text.trimEnd().split("\n").slice(-lines).join("\n");
  return kept.length <= chars ? kept : kept.slice(kept.length - chars);
}

/** Continuations already spent, per session id. Lives as long as the process. */
const spent = new Map<string, number>();

/** Test seam: forget what this process has counted. */
export function resetGate(): void {
  spent.clear();
}

export interface GateDeps {
  readonly run?: Runner;
  readonly exists?: (path: string) => boolean;
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

  const command = gateCommandFor(ctx.cwd, deps.exists ?? existsSync);
  if (command === undefined) return undefined;

  const run = deps.run ?? runCommand;
  const result = await run(command.bin, command.args, {
    cwd: ctx.cwd,
    timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
  });
  // A missing toolchain is not a failing check: a repo whose `tsc` is not
  // installed must still be able to finish a turn.
  if (result.missing || result.code === 0) return undefined;

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
