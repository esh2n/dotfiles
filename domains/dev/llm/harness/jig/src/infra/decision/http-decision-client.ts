/**
 * The HTTP transport for `RemoteDecisionProvider`: one POST of the request
 * envelope, one parsed JSON reply.
 *
 * Deliberately unaware of *what* a judgment is — it moves bytes and reports
 * transport failures as `RemoteDecisionError`. A reply the service itself
 * produced as an error (`{op: "error", …}`) is passed through untouched, so the
 * message the provider throws is the service's own rejection and not a generic
 * "request failed".
 *
 * The timeout is a ceiling on the whole judgment, which is one call to a model
 * over the network: the service's own 30s is the budget here, and it is passed
 * explicitly rather than relying on a socket default nobody chose.
 */

import type { RemoteDecisionRequest } from "../../domain/decision/remote";
import { type RemoteDecisionClient, RemoteDecisionError } from "./remote-provider";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDecisionClientOptions {
  /** Full URL of the service's decision endpoint, e.g. `http://127.0.0.1:4100/decide`. */
  readonly url: string;
  /** Injected for tests; defaults to the runtime's global `fetch`. */
  readonly fetch?: FetchLike;
  /** Ceiling for the whole judgment. Default 30s. */
  readonly timeoutMs?: number;
}

export function createHttpDecisionClient(options: HttpDecisionClientOptions): RemoteDecisionClient {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 30_000;

  return async (request: RemoteDecisionRequest): Promise<unknown> => {
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new RemoteDecisionError(
        `judgment service unreachable at ${options.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new RemoteDecisionError(
        `judgment service answered ${response.status} with no JSON body`,
      );
    }
  };
}
