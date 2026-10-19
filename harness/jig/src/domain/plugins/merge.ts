/**
 * One managed directory fed from several source trees: the house's own
 * (`harness/skills`, `harness/agents`) and each external pack's. The house
 * wins a name both have; the pack's entry is reported as not linked, with
 * the pack named, so a pack that later adds a same-named skill never
 * replaces the house's silently.
 *
 * Pure. No IO.
 */

import type { ManagedSelection } from "../claude/managed-dir";

export interface SourceSelection {
  /** Who the source is, for the report: `house` or the plugin's name. */
  readonly label: string;
  readonly dir: string;
  readonly selection: ManagedSelection;
}

export interface MergedSelection {
  readonly selection: ManagedSelection;
  /** Each linked name's source directory. */
  readonly dirOf: ReadonlyMap<string, string>;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The first source is the house; later sources are packs, in the order given. */
export function mergeSelections(sources: readonly SourceSelection[]): MergedSelection {
  const dirOf = new Map<string, string>();
  const excluded: { name: string; reason: string }[] = [];
  const [house, ...packs] = sources;
  for (const name of house?.selection.linked ?? []) dirOf.set(name, house?.dir ?? "");
  excluded.push(...(house?.selection.excluded ?? []));
  for (const pack of packs) {
    for (const name of pack.selection.linked) {
      if (dirOf.has(name)) {
        excluded.push({
          name,
          reason: `${pack.label}: an entry of the same name is already linked; that one stays`,
        });
      } else {
        dirOf.set(name, pack.dir);
      }
    }
    for (const entry of pack.selection.excluded) {
      excluded.push({ name: entry.name, reason: `${pack.label}: ${entry.reason}` });
    }
  }
  return {
    selection: { linked: [...dirOf.keys()].sort(compare), excluded },
    dirOf,
  };
}
