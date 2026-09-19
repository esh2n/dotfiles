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
import { createTypesafeClient, typesafeKeyFromEnv } from "../infra/decision/typesafe-client";

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

/**
 * Serve the decision endpoint. Bind to the loopback only: this process holds a
 * credential, so nothing outside the machine has any business reaching it.
 */
export function serveDecisionService(options: ServeDecisionOptions): RunningDecisionService {
  const hostname = options.hostname ?? "127.0.0.1";
  const deps: AnswerDecisionDeps = {
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  const compactionDeps: AnswerCompactionDeps = {
    ...deps,
    ...(options.compaction === undefined ? {} : { options: options.compaction }),
  };

  const routes = new Set(["/decide", "/tier", "/compact"]);

  const server = Bun.serve({
    port: options.port,
    hostname,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (request.method === "GET" && pathname === "/health") {
        return json(200, { ok: true, provider: options.provider.name });
      }
      if (request.method !== "POST" || !routes.has(pathname)) {
        return new Response("not found", { status: 404 });
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
      let response: HttpResponse<unknown>;
      if (pathname === "/tier") response = await respondToTier(body, options.provider, deps);
      else if (pathname === "/compact") {
        response = await respondToCompaction(body, options.provider, compactionDeps);
      } else response = await respondToDecision(body, options.provider, deps);
      return json(response.status, response.body);
    },
  });

  const url = `http://${hostname}:${server.port}`;
  options.logger?.info("decision.service.listening", { url, provider: options.provider.name });

  return { url, stop: () => void server.stop(true) };
}
