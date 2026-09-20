/**
 * Merges permission layers — ported from yoki's
 * `runtime/yoki/scripts/lib/permissions/parse.js` (`dedupeEntries`,
 * `dedupeGuardFloor`, `mergeLayers`).
 */

import type { GuardFloorEntry, MergedPermissions, PermissionEntry, PermissionLayer } from "./types";

/**
 * Unions a list of same-key entries (allow or deny) across layers, deduping
 * by pattern text. First occurrence wins position; a later layer's `reason`
 * fills a gap but never overwrites an earlier one, and `enforce` arrays are
 * unioned so a pack/personal layer can add hook-enforcement to a pattern
 * core already declared without needing to repeat it.
 */
export function dedupeEntries(entries: readonly PermissionEntry[]): PermissionEntry[] {
  const order: string[] = [];
  const byPattern = new Map<string, { pattern: string; reason?: string; enforce?: string[] }>();

  for (const entry of entries) {
    const existing = byPattern.get(entry.pattern);
    if (!existing) {
      const copy: { pattern: string; reason?: string; enforce?: string[] } = {
        pattern: entry.pattern,
      };
      if (entry.reason) copy.reason = entry.reason;
      if (entry.enforce?.length) copy.enforce = [...entry.enforce];
      byPattern.set(entry.pattern, copy);
      order.push(entry.pattern);
      continue;
    }

    if (!existing.reason && entry.reason) {
      existing.reason = entry.reason;
    }
    if (entry.enforce?.length) {
      existing.enforce = [...new Set([...(existing.enforce ?? []), ...entry.enforce])];
    }
  }

  return order.map((pattern) => {
    const found = byPattern.get(pattern);
    if (!found) throw new Error(`unreachable: dedupeEntries lost pattern "${pattern}"`);
    return found;
  });
}

/**
 * Unions guardFloor entries across layers, deduping on the whole triple
 * (hook + event + matcher) rather than the hook name alone: the same script
 * legitimately appears twice when a layer wants it on a second event or a
 * wider matcher. There is no removal path — a later layer can only add.
 */
export function dedupeGuardFloor(entries: readonly GuardFloorEntry[]): GuardFloorEntry[] {
  const seen = new Set<string>();
  const out: GuardFloorEntry[] = [];

  for (const entry of entries) {
    if (!entry?.hook) continue;
    const key = `${entry.hook}\u0000${entry.event ?? ""}\u0000${entry.matcher ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const copy: { hook: string; event?: string; matcher?: string; reason?: string } = {
      hook: entry.hook,
    };
    if (entry.event) copy.event = entry.event;
    if (entry.matcher) copy.matcher = entry.matcher;
    if (entry.reason) copy.reason = entry.reason;
    out.push(copy);
  }

  return out;
}

/**
 * Merges permission layers in priority order (core, then packs, then
 * personal). allow/deny and guardFloor are unions (dedupe by pattern / by
 * hook+event+matcher); the last layer that sets defaultMode wins, falling
 * back to "auto" when none does.
 */
export function mergePermissionLayers(layers: readonly PermissionLayer[]): MergedPermissions {
  const allow = dedupeEntries(layers.flatMap((l) => l.allow));
  const deny = dedupeEntries(layers.flatMap((l) => l.deny));
  const guardFloor = dedupeGuardFloor(layers.flatMap((l) => l.guardFloor));

  let defaultMode: string | undefined;
  for (const l of layers) {
    if (l.defaultMode) defaultMode = l.defaultMode;
  }

  return { allow, deny, guardFloor, defaultMode: defaultMode ?? "auto" };
}
