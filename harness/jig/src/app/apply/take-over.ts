/**
 * `jig apply --write --take-over`: for content jig itself wrote under an
 * older layout, where its record no longer matches (a moved checkout, an
 * earlier installer that registered the same MCP servers), so every write
 * stops as a hand-edit conflict. The files are copied aside first
 * (`<file>.pre-dotfiles`, never overwriting an earlier copy), then jig's
 * records for them are forgotten, so the next write is judged like a first
 * one. What jig does not own in those files is still carried through as
 * read; only jig's own part is replaced.
 */

import type { ApplyPorts } from "./ports";

export interface TakeOver {
  /** Files to copy aside before writing. */
  readonly files: readonly string[];
  /** Manifest keys to forget. */
  readonly records: readonly string[];
}

export async function prepareTakeOver(ports: ApplyPorts, plan: TakeOver): Promise<string[]> {
  const kept: string[] = [];
  for (const file of plan.files) {
    const content = await ports.readFile(file);
    if (content === undefined) continue;
    let aside = `${file}.pre-dotfiles`;
    for (let n = 1; (await ports.readFile(aside)) !== undefined; n++) {
      aside = `${file}.pre-dotfiles.${n}`;
    }
    await ports.writeAtomic(aside, content);
    kept.push(aside);
  }
  const manifest = { ...(await ports.readManifest()) };
  for (const key of plan.records) delete manifest[key];
  await ports.writeManifest(manifest);
  return kept;
}
