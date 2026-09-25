/**
 * `jig box list` — what boxes exist, newest first. Optionally narrowed to one
 * repository, which is what the interactive entry point offers.
 *
 * The narrowing is by workspace, not by name: a name carries only the
 * repository's basename, so two checkouts both called `app` would answer to
 * the same one and resume could attach to the wrong repository's box.
 * `sbx ls --json` reports the host paths a box was created against, and that
 * is identity rather than a label.
 */

import type { BoxPorts, BoxResult } from "./ports";
import { type Box, LIST_ARGS, belongsTo, byNewest, parseSandboxList } from "./sbx";

export interface ListBoxesInput {
  /** When given, only boxes whose clone came from this repository root. */
  readonly repoPath?: string;
}

export interface ListBoxesResult {
  readonly boxes: readonly Box[];
  readonly code: number;
  /** Set when sbx itself failed; the caller shows it instead of an empty list. */
  readonly error?: string;
}

/** Boxes cloned from this repository, whatever they are called. */
export function forRepo(boxes: readonly Box[], repoRoot: string): Box[] {
  return boxes.filter((box) => belongsTo(box, repoRoot));
}

/**
 * The one box a name refers to, refusing when it is not this repository's.
 *
 * Every command that takes a name (`resume`, `fetch`, `rm`) goes through
 * here, because a name alone is ambiguous across repositories and the cost
 * of getting it wrong is attaching to — or deleting — someone else's box.
 * When the caller is not inside a repository at all there is nothing to check
 * against, and the name is taken at face value.
 */
export async function locateBox(
  command: string,
  name: string,
  repoRoot: string | undefined,
  ports: BoxPorts,
): Promise<{ readonly box: Box } | { readonly failure: BoxResult }> {
  const listed = await listBoxes({}, ports);
  if (listed.error !== undefined) {
    return { failure: { lines: [`${command}: sbx ls failed`, listed.error], code: listed.code } };
  }

  const box = listed.boxes.find((candidate) => candidate.name === name);
  if (box === undefined) {
    return { failure: { lines: [`${command}: no box named ${name}`], code: 2 } };
  }
  if (repoRoot !== undefined && !belongsTo(box, repoRoot)) {
    const owner = box.workspaces[0] ?? "an unknown path";
    return {
      failure: {
        lines: [
          `${command}: box ${name} belongs to ${owner}, not ${repoRoot}`,
          "names carry only a repository's basename, so two checkouts can want the same one.",
        ],
        code: 2,
      },
    };
  }
  return { box };
}

export async function listBoxes(input: ListBoxesInput, ports: BoxPorts): Promise<ListBoxesResult> {
  const result = await ports.sbx.run(LIST_ARGS);
  if (result.code !== 0) {
    return { boxes: [], code: result.code, error: result.stderr.trimEnd() };
  }
  const all = byNewest(parseSandboxList(result.stdout));
  return {
    boxes: input.repoPath === undefined ? all : forRepo(all, input.repoPath),
    code: 0,
  };
}
