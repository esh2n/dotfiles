/**
 * A worker's cost comes from LiteLLM, not from the worker's harness: pi and
 * omp price the proxy tiers at nothing, and the owner ruled (2026-09-30) that
 * LiteLLM's own calculation is the only one, shown as "—" until it exists
 * (rules/research/2026-09-30-agent-cost-method.md).
 *
 * Each worker tags its requests with one tag of its own (`metadata.tags` in
 * the request body, which LiteLLM stores with the request's spend), and the
 * Swarm sums the spend log by that tag. The log is written in batches
 * (`PROXY_BATCH_WRITE_AT`, 10 s plus up to 5 s), so a worker is looked up
 * while it runs and for a while after it ends, then no more.
 */

import type { Workers } from "./state";

/** Set in a worker's environment: the tag its harness adds to every proxy request. */
export const SPEND_TAG_ENV = "JIG_SWARM_TAG";

/** How often the spend log is read while any worker's cost may still change. */
export const SPEND_POLL_MS = 15_000;

/** How long after a worker ends its cost is still read (four batch writes). */
export const SPEND_SETTLE_MS = 60_000;

/** One worker's tag: unique per parent session and worker name. */
export function spendTag(sessionId: string, name: string): string {
  return `jig-swarm:${sessionId}:${name}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The request body with `tag` added to `metadata.tags`, keeping whatever
 * metadata and tags it had. Anything that is not a JSON object is returned
 * as it came.
 */
export function withSpendTag(payload: unknown, tag: string): unknown {
  const body = record(payload);
  if (body === undefined) return payload;
  const metadata = record(body.metadata) ?? {};
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((t): t is string => typeof t === "string")
    : [];
  if (tags.includes(tag)) return payload;
  return { ...body, metadata: { ...metadata, tags: [...tags, tag] } };
}

/** Workers whose cost may still change: started, and running or ended less than SPEND_SETTLE_MS ago. */
export function costPending(workers: Workers, now: number): readonly string[] {
  return workers
    .filter(
      (w) =>
        w.startedAt !== undefined && (w.endedAt === undefined || now - w.endedAt < SPEND_SETTLE_MS),
    )
    .map((w) => w.spec.name);
}
