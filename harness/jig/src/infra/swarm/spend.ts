/**
 * LiteLLM's spend by request tag, read from the local proxy — the Swarm's one
 * source of cost (src/domain/swarm/spend.ts).
 *
 * `GET /global/spend/tags?start_date&end_date&tags=a,b` (LiteLLM
 * `proxy/spend_tracking/spend_management_endpoints.py`, `global_view_spend_tags`;
 * no premium check) sums `spend` from the `DailyTagSpend` view, a plain view
 * over `LiteLLM_SpendLogs` (`proxy/db/create_views.py`), so a row counts as
 * soon as the batch writer has flushed it. Each row is
 * `{individual_request_tag, log_count, total_spend}`.
 *
 * `spend_date` is `DATE(startTime)` in the database's time zone, so the
 * window is yesterday to tomorrow (UTC): a worker that crosses midnight is
 * still found, and tags are unique per session, so the wide window adds
 * nothing that is not the worker's.
 */

import type { SpendLookup } from "../../app/swarm/ports";

/** The proxy's root: tiers.json's `connections.proxy.baseUrl` without its `/v1`. */
export function proxyRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function day(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The request for `tags` around `now`. */
export function spendRequestUrl(root: string, tags: readonly string[], now: number): string {
  const params = new URLSearchParams({
    start_date: day(now - 86_400_000),
    end_date: day(now + 86_400_000),
    tags: tags.join(","),
  });
  return `${root}/global/spend/tags?${params.toString()}`;
}

/** Rows → tag → USD; rows that are not the documented shape are skipped. */
export function parseSpendRows(body: unknown): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(body)) throw new Error("spend by tag: the proxy did not return a list");
  for (const row of body) {
    if (typeof row !== "object" || row === null) continue;
    const { individual_request_tag: tag, total_spend: spend } = row as Record<string, unknown>;
    const usd = typeof spend === "string" ? Number(spend) : spend;
    if (typeof tag === "string" && typeof usd === "number" && Number.isFinite(usd)) {
      out.set(tag, (out.get(tag) ?? 0) + usd);
    }
  }
  return out;
}

export interface SpendClientOptions {
  /** tiers.json's `connections.proxy.baseUrl`. */
  readonly baseUrl: string;
  /** The proxy key the harness itself uses (`LITELLM_API_KEY`). */
  readonly apiKey: string;
  readonly now: () => number;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export function litellmSpendLookup(options: SpendClientOptions): SpendLookup {
  const root = proxyRoot(options.baseUrl);
  const doFetch = options.fetch ?? fetch;
  return async (tags) => {
    if (tags.length === 0) return new Map();
    const response = await doFetch(spendRequestUrl(root, tags, options.now()), {
      headers: { Authorization: `Bearer ${options.apiKey}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
    if (!response.ok) {
      throw new Error(`spend by tag: the proxy answered ${response.status}`);
    }
    return parseSpendRows(await response.json());
  };
}
