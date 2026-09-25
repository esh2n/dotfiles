/**
 * `jig box resume <name>` — re-attach to a box and pick the session back up.
 *
 * Which argument resumes a session is the agent's business, not sbx's, so the
 * agent is read from the box's own listing rather than asked for again. A box
 * whose agent jig does not know how to resume is still attached to, with no
 * resume argument, which is better than refusing.
 */

import { normalizeAgent } from "./kit";
import { locateBox } from "./list";
import type { BoxPorts, BoxResult } from "./ports";
import { formatSbxCommand, runArgs } from "./sbx";

/**
 * Verified on this machine 2026-09-22: `claude --help` has `--continue, -c`;
 * `codex --help` has a `resume` subcommand, "picker by default; use --last to
 * continue the most recent" — a box holds one session, so `--last` is the one
 * that needs no keystroke.
 *
 * Keyed by the *built-in* agent: a box created from jig's fork kit is
 * reported by `sbx ls --json` as `jig-claude` / `jig-codex`, which
 * `normalizeAgent` maps back.
 */
const RESUME_ARGS: Readonly<Record<string, readonly string[]>> = {
  claude: ["--continue"],
  codex: ["resume", "--last"],
};

export interface ResumeBoxInput {
  readonly name: string;
  /** The repository the caller is in, when there is one: a name alone is ambiguous. */
  readonly repoRoot?: string;
  readonly dryRun: boolean;
}

export async function resumeBox(input: ResumeBoxInput, ports: BoxPorts): Promise<BoxResult> {
  const located = await locateBox("jig box resume", input.name, input.repoRoot, ports);
  if ("failure" in located) return located.failure;

  const agentArgs = RESUME_ARGS[normalizeAgent(located.box.agent)] ?? [];
  const args = runArgs({ name: input.name, agentArgs });

  if (input.dryRun) {
    return { lines: [formatSbxCommand(args)], code: 0 };
  }
  return { lines: [], code: await ports.sbx.attach(args) };
}
