/**
 * Validating the items the parent model hands to `swarm start`. The model's
 * output is external data (AGENTS.md: validate at every boundary): a bad
 * item is refused with a message the model can act on, never guessed at.
 */

import { EFFORTS, type Effort, TIERS, type Tier, type WorkerSpec } from "./types";

/** Worker names become worktree directories and branch names. */
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

export type SpecResult =
  | { readonly ok: true; readonly specs: readonly WorkerSpec[] }
  | { readonly ok: false; readonly error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(item: unknown, index: number, defaultTier: Tier): WorkerSpec | string {
  const at = `items[${index}]`;
  if (!isPlainObject(item)) return `${at} must be an object`;
  const { name, task, tier, effort, files, isolated } = item;
  if (typeof name !== "string" || !NAME.test(name)) {
    return `${at}.name must be lowercase letters, digits and hyphens (up to 48), starting with a letter or digit`;
  }
  if (typeof task !== "string" || task.trim() === "")
    return `${at}.task must be a non-empty string`;
  if (tier !== undefined && !(TIERS as readonly unknown[]).includes(tier)) {
    return `${at}.tier must be one of ${TIERS.join(", ")}`;
  }
  if (effort !== undefined && !(EFFORTS as readonly unknown[]).includes(effort)) {
    return `${at}.effort must be one of ${EFFORTS.join(", ")}`;
  }
  if (
    files !== undefined &&
    (!Array.isArray(files) || files.some((f) => typeof f !== "string" || f.trim() === ""))
  ) {
    return `${at}.files must be a list of paths or globs`;
  }
  if (
    Array.isArray(files) &&
    files.some((f) => typeof f === "string" && (f.startsWith("/") || f.split("/").includes("..")))
  ) {
    return `${at}.files must stay inside the checkout (no absolute paths, no ..)`;
  }
  if (isolated !== undefined && typeof isolated !== "boolean")
    return `${at}.isolated must be true or false`;
  return {
    name,
    task,
    tier: (tier as Tier | undefined) ?? defaultTier,
    ...(effort === undefined ? {} : { effort: effort as Effort }),
    files: (files as string[] | undefined) ?? [],
    isolated: isolated === true,
  };
}

/**
 * @param taken names already used in this session: a name is never reused,
 *   because it names a log, and for an isolated worker a branch.
 */
export function parseSpecs(
  items: unknown,
  defaultTier: Tier,
  taken: ReadonlySet<string>,
  room: number,
): SpecResult {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "items must be a non-empty list" };
  }
  if (items.length > room) {
    return {
      ok: false,
      error: `${items.length} workers asked, but only ${room} more fit this session's limit (maxWorkers in harness/policy/swarm.json)`,
    };
  }
  const specs: WorkerSpec[] = [];
  const seen = new Set(taken);
  for (const [index, item] of items.entries()) {
    const parsed = parseItem(item, index, defaultTier);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    if (seen.has(parsed.name)) {
      return {
        ok: false,
        error: `items[${index}].name "${parsed.name}" is already used in this session`,
      };
    }
    seen.add(parsed.name);
    specs.push(parsed);
  }
  return { ok: true, specs };
}
