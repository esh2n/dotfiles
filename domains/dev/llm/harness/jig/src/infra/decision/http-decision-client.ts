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
 *
 * The service requires a bearer token (see `token-file.ts`); this client reads
 * it fresh on every call — cheap, and it means a service restart that rotates
 * or first-creates the token file needs no restart on this side. A missing or
 * unreadable token file is not fatal here: the request goes out with no
 * `authorization` header, the service answers 401, and that reply is passed
 * through like any other service error — the caller already has a fallback for
 * a failed judgment.
 */

import type { RemoteDecisionRequest } from "../../domain/decision/remote";
import type { Logger } from "../../domain/ports";
import { type RemoteDecisionClient, RemoteDecisionError } from "./remote-provider";
import { readDecisionToken, tokenFilePath } from "./token-file";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpDecisionClientOptions {
  /** Full URL of the service's decision endpoint, e.g. `http://127.0.0.1:4100/decide`. */
  readonly url: string;
  /** Injected for tests; defaults to the runtime's global `fetch`. */
  readonly fetch?: FetchLike;
  /** Ceiling for the whole judgment. Default 30s. */
  readonly timeoutMs?: number;
  /** Where the bearer token lives; defaults to `JIG_DECISION_TOKEN_FILE` or the shared default path. */
  readonly tokenFilePath?: string;
  /** Warned once per process when the token file is missing or unreadable. */
  readonly logger?: Pick<Logger, "warn">;
}

export function createHttpDecisionClient(options: HttpDecisionClientOptions): RemoteDecisionClient {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 30_000;
  const tokenPath = options.tokenFilePath ?? tokenFilePath();
  let warnedMissingToken = false;

  return async (request: RemoteDecisionRequest): Promise<unknown> => {
    const token = await readDecisionToken(tokenPath);
    if (token === undefined && !warnedMissingToken) {
      warnedMissingToken = true;
      options.logger?.warn("decision.client.token-missing", { path: tokenPath });
    }

    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
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
