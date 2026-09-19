/**
 * The judgment service's transport and composition root.
 *
 * This process is the ONE place that holds the key to the judgment model: it is
 * started once at login, reads `TYPESAFE_API_KEY` a single time, and answers the
 * harnesses over the loopback. Harnesses get a `RemoteDecisionProvider`; they
 * never get the key, and never talk to the model vendor directly.
 *
 * Two layers live here on purpose, and only these two: `respondToDecision` maps
 * an application result to a status code (transport's job), and
 * `serveDecisionService` is the HTTP shell around it. The dispatch itself is in
 * `app/decision/answer-decision.ts`, which is where it is tested.
 */

import { type AnswerDecisionDeps, answerDecision } from "../app/decision/answer-decision";
import type { DecisionProvider } from "../domain/decision/provider";
import type { RemoteDecisionReply } from "../domain/decision/remote";
import { JevProvider, type JevUsage } from "../infra/decision/jev-provider";
import { createTypesafeClient, typesafeKeyFromEnv } from "../infra/decision/typesafe-client";

export interface DecisionHttpResponse {
  readonly status: number;
  readonly body: RemoteDecisionReply;
}

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

  const server = Bun.serve({
    port: options.port,
    hostname,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (request.method === "GET" && pathname === "/health") {
        return json(200, { ok: true, provider: options.provider.name });
      }
      if (request.method !== "POST" || pathname !== "/decide") {
        return new Response("not found", { status: 404 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }
      const response = await respondToDecision(body, options.provider, deps);
      return json(response.status, response.body);
    },
  });

  const url = `http://${hostname}:${server.port}`;
  options.logger?.info("decision.service.listening", { url, provider: options.provider.name });

  return { url, stop: () => void server.stop(true) };
}
