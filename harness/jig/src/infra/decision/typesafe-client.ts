/**
 * The credentialed client that speaks to the judgment model (TypeSafe's System
 * One, "jev"). This is the ONE place in jig that reads `TYPESAFE_API_KEY`, and it
 * runs inside the judgment service — never in a harness process, so an agent's
 * own tool calls can never reach the key that judges it.
 *
 * Hand-rolled instead of `@typesafe-ai/sdk` on purpose: jig has no runtime
 * dependencies, and the wire contract is already pinned by real code (request
 * shape and response shape were read out of `pi-typesafe@0.6.0`'s schema and
 * `validResult`). Owning the client also means owning the retry policy instead of
 * inheriting a second, invisible one.
 *
 * Retry policy, stated once and applied here only: up to `retries` extra attempts
 * after the first, on 429 / 529 / any 5xx, with exponential backoff capped at 8s
 * plus jitter. Everything else (401, 400, 422…) is our bug, not a transient
 * failure, so it fails immediately.
 */

import type { SystemOneClient, SystemOneRequest, SystemOneResult } from "./jev-provider";

/** The judgment model could not be reached, or refused the call for a transport-level reason. */
export class TypesafeError extends Error {}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TypesafeClientOptions {
  /** The resolved key. See `typesafeKeyFromEnv`. */
  readonly apiKey: string;
  /** Default `https://api.typesafe.ai`. */
  readonly baseUrl?: string;
  /** Injected for tests; defaults to the runtime's global `fetch`. */
  readonly fetch?: FetchLike;
  /** Extra attempts after the first. Default 2 (three attempts in total). */
  readonly retries?: number;
  /** Per-attempt ceiling. Default 20s. */
  readonly timeoutMs?: number;
  /** Injected for tests so backoff is not actually waited out. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source, injected so a test can pin the backoff. */
  readonly random?: () => number;
}

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const MAX_BACKOFF_MS = 8_000;
const JITTER_MS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the key from the environment, failing with the instruction that actually
 * fixes it. The established convention on this machine is `op run --env-file`
 * (or the service reading it once at startup) — a bare "401" would send the
 * reader looking in the wrong place.
 */
export function typesafeKeyFromEnv(env: Record<string, string | undefined> = process.env): string {
  const key = env.TYPESAFE_API_KEY;
  if (key === undefined || key.trim() === "") {
    throw new TypesafeError(
      "TYPESAFE_API_KEY is not set — start the judgment service through `op run --env-file …` " +
        "(or its launcher, which resolves op://llm-automation/typesafe/credential at startup)",
    );
  }
  return key;
}

/**
 * Resolve the client's transport config from the environment, so the service can
 * reach the judgment model one of two ways without the client knowing which.
 *
 * PROXY mode (JIG_JEV_BASE_URL set) routes the call through the local LiteLLM
 * boundary — e.g. `http://localhost:4000/typesafe`, composing
 * `http://localhost:4000/typesafe/v1/systemone`. It exists so jev traffic is
 * metered at that boundary and the one downstream `TYPESAFE_API_KEY` lives only
 * in the proxy: jig then holds JIG_JEV_API_KEY (the proxy's own master key), and
 * the proxy overwrites the Authorization header with the vendor key on its way
 * out. DIRECT mode (no base URL) is the fallback — talk to the vendor directly
 * with `TYPESAFE_API_KEY`, via `typesafeKeyFromEnv`.
 *
 * The key is read exactly once here, preserving the service's single-read
 * property; the missing-key error still comes from `typesafeKeyFromEnv`.
 */
export function resolveJudgmentClientConfig(
  env: Record<string, string | undefined> = process.env,
): { readonly apiKey: string; readonly baseUrl?: string } {
  const proxyKey = env.JIG_JEV_API_KEY;
  const apiKey =
    proxyKey !== undefined && proxyKey.trim() !== "" ? proxyKey : typesafeKeyFromEnv(env);
  const baseUrl = env.JIG_JEV_BASE_URL;
  return baseUrl !== undefined && baseUrl.trim() !== "" ? { apiKey, baseUrl } : { apiKey };
}

/** Retryable means "the same call could succeed later", not "the call was wrong". */
function isRetryable(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

function resultFrom(value: unknown): SystemOneResult {
  if (!isRecord(value)) throw new TypesafeError("judgment model replied with a non-object body");
  const answers = value.answers;
  if (!isRecord(answers)) {
    throw new TypesafeError("judgment model replied without an answers object");
  }
  const usage = isRecord(value.usage) ? value.usage : {};
  return {
    model: typeof value.model === "string" ? value.model : "",
    usage: {
      input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
      output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    },
    answers: answers as SystemOneResult["answers"],
  };
}

export function createTypesafeClient(options: TypesafeClientOptions): SystemOneClient {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = options.random ?? Math.random;

  const url = `${baseUrl}/v1/systemone`;

  return async (request: SystemOneRequest): Promise<SystemOneResult> => {
    let lastReason = "no attempt was made";

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0)
        await sleep(Math.min(1_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS) + random() * JITTER_MS);

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
            // In proxy mode these calls transit the LiteLLM gateway, which
            // buckets traffic by user-agent. Without this the judgment service
            // shows up as harness "none", mixed in with real harnesses; name
            // it so jev's own load is separable from pi/dsh/claude/codex.
            "user-agent": "jig-judgment",
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        lastReason = error instanceof Error ? error.message : String(error);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        lastReason = `HTTP ${response.status}: ${body.slice(0, 200)}`;
        if (!isRetryable(response.status)) throw new TypesafeError(lastReason);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        lastReason = "reply was not JSON";
        continue;
      }
      return resultFrom(parsed);
    }

    throw new TypesafeError(
      `judgment model call failed after ${retries + 1} attempts (${lastReason})`,
    );
  };
}
