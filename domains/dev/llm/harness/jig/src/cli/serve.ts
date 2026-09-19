/**
 * The judgment service's transport and composition root.
 *
 * This process is the ONE place that holds the key to the judgment model: it is
 * started once at login, reads `TYPESAFE_API_KEY` a single time, and answers the
 * harnesses over the loopback. Harnesses get a `RemoteDecisionProvider`; they
 * never get the key, and never talk to the model vendor directly.
 *
 * Two layers live here on purpose, and only these two: the `respondTo*` functions
 * map an application result to a status code (transport's job), and
 * `serveDecisionService` is the HTTP shell around them. The dispatch itself lives
 * in `app/decision/*`, which is where it is tested.
 */

import { timingSafeEqual } from "node:crypto";
import { type AnswerCompactionDeps, answerCompaction } from "../app/compaction/answer-compaction";
import type { CompactionResult } from "../app/compaction/compact";
import { type AnswerDecisionDeps, answerDecision } from "../app/decision/answer-decision";
import { type AnswerTierDeps, type TierDecision, answerTier } from "../app/decision/answer-tier";
import type { DecisionProvider } from "../domain/decision/provider";
import type {
  RemoteDecisionErrorResponse,
  RemoteDecisionResponse,
} from "../domain/decision/remote";
import { JevProvider, type JevUsage } from "../infra/decision/jev-provider";
import { ensureDecisionToken, tokenFilePath } from "../infra/decision/token-file";
import { createTypesafeClient, typesafeKeyFromEnv } from "../infra/decision/typesafe-client";
import { METRICS_CONTENT_TYPE, MetricsRegistry } from "../infra/metrics/registry";

/** A JSON reply: the endpoint's own body, or the shared error envelope. */
export type HttpResponse<Body> = {
  readonly status: number;
  readonly body: Body | RemoteDecisionErrorResponse;
};

export type DecisionHttpResponse = HttpResponse<RemoteDecisionResponse>;
export type TierHttpResponse = HttpResponse<TierDecision>;
export type CompactionHttpResponse = HttpResponse<CompactionResult>;

/**
 * Application result -> HTTP. A malformed request is the caller's bug (400); a
 * judgment that could not be made is an upstream failure (502). The error body
 * keeps the distinction, so a caller can tell "I asked wrong" from "the model
 * did not answer" without parsing prose.
 */
export async function respondToDecision(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerDecisionDeps = {},
): Promise<DecisionHttpResponse> {
  const result = await answerDecision(body, provider, deps);
  if (result.ok) return { status: 200, body: result.response };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/**
 * Application result -> HTTP for the tier endpoint. Same mapping rule as
 * judgments: a malformed request is the caller's bug, a tier that could not be
 * judged is an upstream failure.
 */
export async function respondToTier(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerTierDeps = {},
): Promise<TierHttpResponse> {
  const result = await answerTier(body, provider, deps);
  if (result.ok) return { status: 200, body: result.decision };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/**
 * Application result -> HTTP for the compaction endpoint. Same mapping rule: a
 * malformed item list is the caller's bug, a judgment that could not be made is
 * an upstream failure (the caller then keeps its context as it is).
 */
export async function respondToCompaction(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerCompactionDeps = {},
): Promise<CompactionHttpResponse> {
  const result = await answerCompaction(body, provider, deps);
  if (result.ok) return { status: 200, body: result.result };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/** The service's own composition root: build the credentialed provider exactly once. */
export function buildJudgmentProvider(
  env: Record<string, string | undefined> = process.env,
  onUsage?: (usage: JevUsage) => void,
): JevProvider {
  return new JevProvider({
    client: createTypesafeClient({ apiKey: typesafeKeyFromEnv(env) }),
    ...(onUsage === undefined ? {} : { onUsage }),
  });
}

export interface ServeDecisionOptions {
  readonly provider: DecisionProvider;
  readonly port: number;
  readonly hostname?: string;
  readonly logger?: AnswerDecisionDeps["logger"];
  readonly clock?: AnswerDecisionDeps["clock"];
  /** Compaction options, for tests and for an operator changing the caution level. */
  readonly compaction?: AnswerCompactionDeps["options"];
  /**
   * Where the service's own counters live. Pass one when the caller also feeds it
   * (the provider's token usage is reported to the caller, not to this function),
   * so `/metrics` and the usage hook share a single registry.
   */
  readonly metrics?: MetricsRegistry;
}

export interface RunningDecisionService {
  readonly url: string;
  stop(): void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The metric families this service owns, with the help text an operator reads. */
function describeMetrics(metrics: MetricsRegistry): void {
  metrics.describe(
    "jig_judgment_requests_total",
    "Judgment requests served, by endpoint and outcome. bad_request is a caller's bug, provider_error is an unmade judgment.",
  );
  metrics.describe(
    "jig_judgment_seconds",
    "Wall time the service spent producing an answer, by endpoint. Includes the model call.",
  );
  metrics.describe(
    "jig_judgment_tokens_total",
    "Tokens the judgment model reported, by model and direction. This is what the judgment service costs.",
  );
}

function outcomeOf(status: number): string {
  if (status === 200) return "ok";
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  return "provider_error";
}

const UNAUTHORIZED: RemoteDecisionErrorResponse = {
  op: "error",
  error: { kind: "unauthorized", message: "missing or invalid bearer token" },
};

/**
 * Constant-time bearer check: a length mismatch is rejected before comparison
 * (`timingSafeEqual` requires equal-length buffers, and unequal length is
 * itself not a judgment's answer to have to time-hide from every caller — a
 * caller with no credential at all learns nothing from this branch that the
 * 401 doesn't already tell it).
 */
function isAuthorized(header: string | null, token: string): boolean {
  if (header === null || !header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * Serve the decision endpoint. Bind to the loopback only: this process holds a
 * credential, so nothing outside the machine has any business reaching it —
 * and since any other local process can still open a loopback socket, `/decide`,
 * `/tier` and `/compact` also require a bearer token read from a 0600 file
 * (`../infra/decision/token-file.ts`). `/health` stays open: it reveals nothing
 * a caller could use.
 */
export function serveDecisionService(
  options: ServeDecisionOptions,
  env: Record<string, string | undefined> = process.env,
): RunningDecisionService {
  const hostname = options.hostname ?? "127.0.0.1";
  const deps: AnswerDecisionDeps = {
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  const compactionDeps: AnswerCompactionDeps = {
    ...deps,
    ...(options.compaction === undefined ? {} : { options: options.compaction }),
  };

  const metrics = options.metrics ?? new MetricsRegistry();
  describeMetrics(metrics);

  const routes = new Set(["/decide", "/tier", "/compact"]);
  // Kicked off now, at server start, so the token file exists (0600, created or
  // reused) before the first request rather than being generated lazily on it.
  const token = ensureDecisionToken(tokenFilePath(env));

  const server = Bun.serve({
    port: options.port,
    hostname,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (request.method === "GET" && pathname === "/health") {
        return json(200, { ok: true, provider: options.provider.name });
      }
      if (request.method === "GET" && pathname === "/metrics") {
        // Prometheus 3.0 fails the scrape outright without a parsable type.
        return new Response(metrics.render(), {
          status: 200,
          headers: { "content-type": METRICS_CONTENT_TYPE },
        });
      }
      if (request.method !== "POST" || !routes.has(pathname)) {
        return new Response("not found", { status: 404 });
      }

      if (!isAuthorized(request.headers.get("authorization"), await token)) {
        // Counted so a consumer left behind without the token shows up on the
        // dashboard instead of failing silently into its fallback.
        metrics.increment("jig_judgment_requests_total", {
          kind: pathname.slice(1),
          outcome: outcomeOf(401),
        });
        return json(401, UNAUTHORIZED);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }

      // Three endpoints, one provider: `/decide` answers a caller's own typed
      // question, `/tier` answers jig's tier question, `/compact` answers jig's
      // keep-or-drop question — so no harness has to restate either one.
      const kind = pathname.slice(1);
      const startedAt = performance.now();
      let response: HttpResponse<unknown>;
      if (pathname === "/tier") response = await respondToTier(body, options.provider, deps);
      else if (pathname === "/compact") {
        response = await respondToCompaction(body, options.provider, compactionDeps);
      } else response = await respondToDecision(body, options.provider, deps);

      metrics.increment("jig_judgment_requests_total", {
        kind,
        outcome: outcomeOf(response.status),
      });
      metrics.observe("jig_judgment_seconds", (performance.now() - startedAt) / 1000, { kind });
      return json(response.status, response.body);
    },
  });

  const url = `http://${hostname}:${server.port}`;
  options.logger?.info("decision.service.listening", { url, provider: options.provider.name });

  return { url, stop: () => void server.stop(true) };
}
