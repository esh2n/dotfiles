/**
 * Tier routing for omp — ask jig which tier a prompt needs, switch the model.
 *
 * The same judgment pi runs (`domains/dev/config/pi/extensions/tier-router.ts`):
 * the raw prompt goes to the judgment service's `/tier`, and the tier that
 * comes back (`main` / `complex` / `deterministic`, the LiteLLM aliases from
 * `rules/decisions/2026-09-23-model-routing-per-harness.md`) becomes the
 * session model through omp's `ctx.setModel("<provider>/<tier>")`. The
 * question, its criteria and the confidence gate live in the service; two
 * harnesses asking in their own words would be two judgments, so neither
 * harness holds any wording.
 *
 * Why this is not "omp's roles": `modelRoles` (default / smol / slow / …) is
 * omp's table of which model each of ITS OWN features uses; nothing in omp
 * classifies a prompt's difficulty. Without this handler every prompt runs
 * on `default` and the `complex` tier is never reached.
 *
 * Fail-open, loudly once: an unreachable service keeps the current model and
 * says so on the first failure only (then stderr). The handler never throws
 * into omp's runner and never cancels a turn.
 *
 * Two guarantees, so nobody ever picks a tier by hand and omp never runs on
 * a direct provider (the ruling's "never a provider directly"):
 *   - at session start the model is forced to `proxy/main` unless it already
 *     is a proxy tier — omp's own startup order ("saved default provider/
 *     model" before anything from `modelRoles`) would otherwise bring back
 *     whatever it last fell to (measured 2026-09-23: lm-studio's qwen);
 *   - on every prompt the tier judgment decides; when the judgment is
 *     unavailable the model stays only if it is a proxy tier, else `main`.
 *
 * Modes: `auto` (default; `OMP_TIER_ROUTER=off` makes `off` the default),
 * `off`, or a forced tier. `/tier [auto|off|main|complex|deterministic]`.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OmpBeforeAgentStartEvent, OmpCommandContext, OmpContext } from "./omp";

export const TIERS = ["main", "complex", "deterministic"] as const;
export type Tier = (typeof TIERS)[number];
export type TierMode = "off" | "auto" | Tier;

export interface TierDecision {
  readonly tier: Tier;
  readonly confidence: number;
  readonly source: "decided" | "fallback";
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** `JIG_DECISION_URL` may name an endpoint; only its base is wanted. */
export function serviceBase(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.JIG_DECISION_URL ?? "http://127.0.0.1:4100";
  return configured.replace(/\/(decide|tier|compact)$/, "").replace(/\/$/, "");
}

const DEFAULT_TOKEN_FILE = join(homedir(), "Library/Application Support/jig/decision.token");

/** The service's bearer token from the shared file; absent → no header, and the 401 is a judgment failure like any other. */
async function decisionToken(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const path = env.JIG_DECISION_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  try {
    const trimmed = (await readFile(path, "utf8")).trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}

/** The reply, read strictly: a body without a known tier is an error carrying the service's message. */
export function readDecision(body: unknown): TierDecision {
  if (typeof body !== "object" || body === null) throw new Error("tier service replied with no body");
  const record = body as Record<string, unknown>;
  if (!isTier(record.tier)) {
    const detail =
      typeof record.error === "object" && record.error !== null
        ? String((record.error as Record<string, unknown>).message)
        : "no tier in the reply";
    throw new Error(detail);
  }
  return {
    tier: record.tier,
    confidence: typeof record.confidence === "number" ? record.confidence : 0,
    source: record.source === "decided" ? "decided" : "fallback",
  };
}

export function label(decision: TierDecision): string {
  const confidence = decision.confidence.toFixed(2);
  return decision.source === "fallback"
    ? `${decision.tier} (fallback ${confidence})`
    : `${decision.tier} (${confidence})`;
}

export interface TierDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
}

export async function askTier(request: string, timeoutMs: number, deps: TierDeps = {}): Promise<TierDecision> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const response = await doFetch(`${serviceBase(env)}/tier`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...((await decisionToken(env)) === undefined
        ? {}
        : { authorization: `Bearer ${await decisionToken(env)}` }),
    },
    body: JSON.stringify({ harness: "omp", request }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) throw new Error("judgment service has no /tier endpoint");
  return readDecision(await response.json());
}

/** The active model as `provider/id`, or undefined when omp hands over nothing usable. */
export function activeSelector(ctx: OmpContext): string | undefined {
  const current = ctx.models?.current?.();
  if (current !== undefined && current !== null && typeof current === "object") {
    const { provider, id } = current;
    if (typeof provider === "string" && typeof id === "string") return `${provider}/${id}`;
  }
  return undefined;
}

/** Switch to `tier` under `providerId` unless that is already the model. */
export async function routeTo(
  tier: Tier,
  providerId: string,
  ctx: OmpContext,
): Promise<{ readonly switched: boolean; readonly message: string }> {
  const wanted = `${providerId}/${tier}`;
  if (activeSelector(ctx) === wanted) return { switched: false, message: `already ${tier}` };
  if (ctx.models?.resolve !== undefined && ctx.models.resolve(wanted) === undefined) {
    return { switched: false, message: `no model ${wanted} in omp's registry (models.yml provider "${providerId}", LITELLM_API_KEY resolved?)` };
  }
  if (ctx.setModel === undefined) return { switched: false, message: "this omp build exposes no ctx.setModel" };
  try {
    await ctx.setModel(wanted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { switched: false, message: `cannot switch to ${wanted}: ${message}` };
  }
  return { switched: true, message: `switched to ${wanted}` };
}

export interface TierRouter {
  readonly mode: () => TierMode;
  readonly onSessionStart: (ctx: OmpContext) => Promise<void>;
  readonly onPrompt: (event: OmpBeforeAgentStartEvent, ctx: OmpContext) => Promise<void>;
  readonly onCommand: (args: string, ctx: OmpCommandContext) => Promise<void>;
}

/** Is the active model one of the proxy tiers? */
export function onProxyTier(ctx: OmpContext, providerId: string): boolean {
  const active = activeSelector(ctx);
  return active !== undefined && TIERS.some((tier) => active === `${providerId}/${tier}`);
}

/** The router's state and its two entry points; `index.ts` wires them to omp. */
export function createTierRouter(deps: TierDeps = {}): TierRouter {
  const env = deps.env ?? process.env;
  let mode: TierMode = env.OMP_TIER_ROUTER === "off" ? "off" : "auto";
  let announcedFailure = false;
  const providerId = env.OMP_TIER_PROVIDER ?? "proxy";
  const timeoutMs = Number.parseInt(env.OMP_TIER_TIMEOUT_MS ?? "", 10) || 15_000;

  const status = (ctx: OmpContext, text: string): void => {
    ctx.ui?.setStatus?.(`tier: ${text}`);
  };
  const notify = (ctx: OmpContext, text: string, level: "info" | "warn" | "error"): void => {
    ctx.ui?.notify?.(text, level);
  };

  /** Off a proxy tier (a direct provider, or nothing) → `main`; the message names what was there. */
  const ensureProxy = async (ctx: OmpContext, why: string): Promise<void> => {
    if (onProxyTier(ctx, providerId)) return;
    const was = activeSelector(ctx) ?? "no model";
    const result = await routeTo("main", providerId, ctx);
    status(ctx, result.switched ? `main (${why})` : "no proxy tier");
    notify(
      ctx,
      result.switched
        ? `tier-router: ${was} is not a proxy tier — switched to ${providerId}/main (${why})`
        : `tier-router: ${was} is not a proxy tier and ${result.message}`,
      result.switched ? "info" : "error",
    );
  };

  return {
    mode: () => mode,

    async onSessionStart(ctx) {
      if (mode === "off") return;
      if (mode !== "auto") {
        await routeTo(mode, providerId, ctx);
        status(ctx, `${mode} (forced)`);
        return;
      }
      await ensureProxy(ctx, "session start");
    },

    async onPrompt(event, ctx) {
      if (mode === "off") return;
      const prompt = (event.prompt ?? "").trim();
      // Slash commands are not requests to route; an empty prompt has nothing to judge.
      if (prompt === "" || prompt.startsWith("/")) return;

      if (mode !== "auto") {
        const result = await routeTo(mode, providerId, ctx);
        status(ctx, `${mode} (forced)`);
        if (!result.switched && !result.message.startsWith("already")) console.error(`tier-router: ${result.message}`);
        return;
      }

      try {
        const decision = await askTier(prompt, timeoutMs, { env, fetch: deps.fetch });
        const result = await routeTo(decision.tier, providerId, ctx);
        status(ctx, label(decision));
        notify(ctx, `tier-router: ${result.message} — ${label(decision)}`, result.switched || result.message.startsWith("already") ? "info" : "error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        status(ctx, "judgment unavailable");
        if (!announcedFailure) {
          announcedFailure = true;
          notify(ctx, `tier-router: judgment service unavailable (${message}); staying on a proxy tier`, "error");
        } else {
          console.error(`tier-router: judgment service unavailable (${message})`);
        }
        await ensureProxy(ctx, "judgment unavailable");
      }
    },

    async onCommand(args, ctx) {
      const wanted = (args ?? "").trim();
      if (wanted === "") {
        notify(ctx, `tier-router mode: ${mode} — active model: ${activeSelector(ctx) ?? "unknown"}`, "info");
        return;
      }
      if (wanted === "auto" || wanted === "off") {
        mode = wanted;
        status(ctx, wanted);
        notify(
          ctx,
          wanted === "auto"
            ? "tier-router: judging every request (one judgment call per prompt)."
            : "tier-router: automatic routing off; the model will not change on its own.",
          "info",
        );
        return;
      }
      if (!isTier(wanted)) {
        notify(ctx, `tier-router: unknown mode "${wanted}". Use auto, off, or a tier name.`, "error");
        return;
      }
      mode = wanted;
      const result = await routeTo(wanted, providerId, ctx);
      status(ctx, `${wanted} (forced)`);
      notify(
        ctx,
        result.switched
          ? `tier-router: ${result.message}; automatic routing off until /tier auto.`
          : `tier-router: ${result.message}`,
        result.switched || result.message.startsWith("already") ? "info" : "error",
      );
    },
  };
}
