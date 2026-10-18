/**
 * What the Codex and omp targets share about a directory of generated agent
 * files: which leftovers jig may remove, and which agent sources may fail
 * without stopping the apply.
 *
 * A skill pack follows its upstream `main` (rules/decisions/2026-10-18-pstack-shared-skills.md),
 * so an agent can disappear or arrive malformed on any `make up`. A file jig
 * wrote whose source is gone is stale and goes, the way a skill link does;
 * one edited since jig wrote it stays, named. A pack agent that does not
 * parse is excluded with its reason; a house agent that does not parse still
 * stops the apply, because that is this repository's own mistake.
 */

import { describePathState } from "../../domain/claude/managed-dir";
import { listEntries } from "./delivery";
import type { ClaudeApplyPorts } from "./ports";

export interface StaleAgentFile {
  readonly name: string;
  readonly path: string;
}

export interface Leftovers {
  /** Files jig wrote, unchanged since, that no source produces now: removed on `--write`. */
  readonly stale: readonly StaleAgentFile[];
  /** Everything else no source produces: not jig's, or edited since jig wrote it. Left alone. */
  readonly foreign: readonly { readonly name: string; readonly what: string }[];
}

export async function sortLeftovers(
  ports: ClaudeApplyPorts,
  dir: string,
  produced: ReadonlySet<string>,
  manifest: Readonly<Record<string, string>>,
): Promise<Leftovers> {
  const stale: StaleAgentFile[] = [];
  const foreign: { name: string; what: string }[] = [];
  const entries = (await listEntries(ports, dir))
    .filter((entry) => !produced.has(entry.name))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    const recorded = manifest[path];
    if (recorded === undefined || entry.state.kind !== "file") {
      foreign.push({ name: entry.name, what: describePathState(entry.state) });
      continue;
    }
    const text = await ports.readFile(path);
    if (text !== undefined && ports.sha256(text) === recorded)
      stale.push({ name: entry.name, path });
    else foreign.push({ name: entry.name, what: "written by jig, edited since" });
  }
  return { stale, foreign };
}

/** Remove the stale files and forget them, so a later file of the same name is judged fresh. */
export async function removeStale(
  ports: ClaudeApplyPorts,
  stale: readonly StaleAgentFile[],
  manifest: Record<string, string>,
): Promise<void> {
  for (const file of stale) {
    await ports.remove(file.path);
    delete manifest[file.path];
  }
}

/** Is this agent source from a skill pack rather than the house's `agents/`? */
export function fromPack(sourcePath: string, houseDir: string): boolean {
  return !sourcePath.startsWith(`${houseDir}/`);
}

export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
