/**
 * `jig box rm <name>` — throw the box away. Irreversible, and the clone is
 * fetch-only, so anything not fetched first is gone: the caller is told so
 * rather than asked, because this command only runs when it was typed.
 *
 * Which makes getting the *right* box load-bearing: a name alone is ambiguous
 * across checkouts that share a basename, so from inside a repository the box
 * has to be that repository's.
 */

import { locateBox } from "./list";
import type { BoxPorts, BoxResult } from "./ports";
import { formatSbxCommand, removeArgs } from "./sbx";

export interface RemoveBoxInput {
  readonly name: string;
  /** The repository the caller is in, when there is one. */
  readonly repoRoot?: string;
  readonly dryRun: boolean;
}

export async function removeBox(input: RemoveBoxInput, ports: BoxPorts): Promise<BoxResult> {
  const located = await locateBox("jig box rm", input.name, input.repoRoot, ports);
  if ("failure" in located) return located.failure;

  const args = removeArgs(input.name);
  if (input.dryRun) {
    return { lines: [formatSbxCommand(args)], code: 0 };
  }

  const removed = await ports.sbx.run(args);
  if (removed.code !== 0) {
    return {
      lines: [`jig box rm: sbx rm failed (exit ${removed.code})`, removed.stderr.trimEnd()],
      code: removed.code,
    };
  }
  return { lines: [`removed ${input.name}`], code: 0 };
}
