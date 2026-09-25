/**
 * The `hooks` key — the one key the generic merge does NOT handle.
 *
 * Rule: union the event keys of the three groups, and for each event concatenate
 * the entries in the order personal → packs (already merged) → core. That is the
 * reverse of the precedence every other key uses, and it is deliberate: personal
 * guards (e.g. git-guard) must see the original tool call before core's rewriter
 * hooks touch it. The event keys are sorted as well, so the emitted settings.json
 * is stable.
 *
 * A value that is not an array is an error — except null/false, which mean "no
 * entries".
 */

import type { Json, JsonObject } from "./merge";

export interface HookGroups {
  readonly core?: JsonObject | undefined;
  readonly packs?: JsonObject | undefined;
  readonly personal?: JsonObject | undefined;
}

function entries(value: Json | undefined, event: string): Json[] {
  if (value === undefined || value === null || value === false) return [];
  if (Array.isArray(value)) return value;
  throw new Error(`hooks.${event} must be an array, got ${typeof value}`);
}

/** Event keys unioned and sorted; entries concatenated personal → packs → core. */
export function mergeHooks(groups: HookGroups): JsonObject {
  const personal = groups.personal ?? {};
  const packs = groups.packs ?? {};
  const core = groups.core ?? {};

  const events = [
    ...new Set([...Object.keys(personal), ...Object.keys(packs), ...Object.keys(core)]),
  ].sort();

  const out: Record<string, Json> = {};
  for (const event of events) {
    out[event] = [
      ...entries(personal[event], event),
      ...entries(packs[event], event),
      ...entries(core[event], event),
    ];
  }
  return out;
}
