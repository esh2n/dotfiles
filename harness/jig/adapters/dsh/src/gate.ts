/**
 * The gate at the end of a DSH turn: typecheck and lint once, and hand a
 * failure back to the model — at most twice per session.
 *
 * `rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` puts DSH's gate
 * on `agent/turn-stopping` "with a self-imposed retry cap". That event is
 * serial and returns nothing; a listener objects by steering
 * (`agent.steer(message)`), and DSH runs another step when fresh steering is
 * in the inbox. DSH has no ceiling of its own, and its Claude Code bridge
 * sends `stop_hook_active: false` on every Stop, so the cap has to live here:
 * two continuations per session, the same as pi and omp.
 *
 * What is checked — the project's lefthook / pre-commit on the files this
 * turn touched first, jig's marker table only without one — is jig's own
 * (`src/domain/hooks/gate.ts`), shared with Claude Code, pi and omp. A missing
 * toolchain is not a failing check; a missing project hook runner is said
 * once. A subagent's turn is not gated: the parent's turn gates the tree.
 */

import { existsSync, readdirSync } from "node:fs";
import type { ChangedFiles } from "../../../src/domain/hooks/changed";
import type { ReadDir } from "../../../src/domain/hooks/format";
import {
  gatePlanFor,
  gateWantsChangedFiles,
  projectHooksFor,
  tail,
} from "../../../src/domain/hooks/gate";
import { missingToolReason } from "../../../src/domain/hooks/project-hooks";
import type { Runner } from "../../../src/domain/hooks/run";
import { changedFiles } from "../../../src/infra/proc/changed-files";
import { runCommand } from "../../../src/infra/proc/exec-file";
import { type DshUserMessage, pluginMessage } from "./message";

export type { DshUserMessage };

/** Continuations this gate asks for, per session. */
export const MAX_CONTINUATIONS = 2;

const TIMEOUT_MS = 180_000;

/** The slice of DSH's `Agent` the gate reads and steers. */
export interface DshStoppingAgent {
  readonly session: {
    readonly header: {
      readonly id: string;
      readonly cwd?: string;
      readonly origin?: "subagent";
    };
  };
  steer(message: DshUserMessage): void;
}

const readDirSync: ReadDir = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

const spent = new Map<string, number>();
const toldMissing = new Set<string>();

/** Test seam: forget what this process has counted. */
export function resetGate(): void {
  spent.clear();
  toldMissing.clear();
}

export interface GateDeps {
  readonly run?: Runner;
  readonly exists?: (path: string) => boolean;
  readonly readDir?: ReadDir;
  readonly changedFiles?: ChangedFiles;
  readonly timeoutMs?: number;
  readonly maxContinuations?: number;
  /** Where to run when the session has no cwd. */
  readonly fallbackCwd?: string;
}

/**
 * One turn boundary, gated. Returns the text it steered with, or `undefined`
 * when the turn may close.
 */
export async function gateOnTurnStopping(
  agent: DshStoppingAgent,
  deps: GateDeps = {},
): Promise<string | undefined> {
  const header = agent.session.header;
  if (header.origin === "subagent") return undefined;
  const session = header.id;
  const cap = deps.maxContinuations ?? MAX_CONTINUATIONS;
  if ((spent.get(session) ?? 0) >= cap) return undefined;

  const cwd = header.cwd ?? deps.fallbackCwd ?? process.cwd();
  const exists = deps.exists ?? existsSync;
  const readDir = deps.readDir ?? readDirSync;
  const hooks = projectHooksFor(cwd, exists);
  const changed = gateWantsChangedFiles(cwd, exists, readDir)
    ? await (deps.changedFiles ?? changedFiles)(hooks?.root ?? cwd)
    : undefined;
  const plan = gatePlanFor(cwd, exists, changed, readDir);
  if (plan.kind === "nothing") return undefined;

  const run = deps.run ?? runCommand;
  for (const command of plan.commands) {
    const result = await run(command.bin, command.args, {
      cwd: plan.cwd,
      timeoutMs: deps.timeoutMs ?? TIMEOUT_MS,
    });
    if (result.missing) {
      if (plan.source !== "project" || hooks === undefined) continue;
      if (toldMissing.has(session)) return undefined;
      toldMissing.add(session);
      spent.set(session, (spent.get(session) ?? 0) + 1);
      const text = missingToolReason(hooks);
      agent.steer(pluginMessage(text));
      return text;
    }
    if (result.code === 0) continue;

    const used = (spent.get(session) ?? 0) + 1;
    spent.set(session, used);
    const output = tail(`${result.stdout}\n${result.stderr}`.trim());
    const text =
      `jig gate: \`${command.label}\` failed (exit ${result.code}). ` +
      `Fix what it reports before finishing — continuation ${used} of ${cap}, ` +
      `after which the turn ends whatever the gate says.\n\n${output}`;
    agent.steer(pluginMessage(text));
    return text;
  }
  return undefined;
}
