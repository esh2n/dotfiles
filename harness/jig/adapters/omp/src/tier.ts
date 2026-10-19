/**
 * Session tier for omp — hold the session on ONE LiteLLM tier; never switch
 * on its own.
 *
 * Ruling (`rules/decisions/2026-09-23-tier-fixed-main-subagent-escalation.md`):
 * the main session's model is fixed for the session — `proxy/main` unless
 * the owner picks another tier — and a stronger model is reached through a
 * subagent whose `model:` maps to `proxy/complex` (`agents/models.json`),
 * not by swapping the main model mid-conversation. The per-prompt judgment
 * that briefly lived here on 2026-09-23 (jig's `/tier`) was removed the same
 * day: no vendor harness switches the main model per turn, LiteLLM
 * recommends session affinity because a switch drops provider-side prompt
 * caching, and the one measured same-shape implementation lost most of its
 * cache (see the ruling above).
 *
 * What is left is enforcement, which omp needs more than pi does: omp's own
 * startup order restores "the saved default provider/model" before anything
 * from `modelRoles`, and its implicit providers are keyless, so a session
 * can open on a direct provider (measured 2026-09-23: lm-studio's qwen). At
 * session start and before every prompt the active model is checked and put
 * back on `<provider>/<tier>` when it is anything else. `/tier <main|complex|
 * executor>` changes the session's tier; `/tier off` stops enforcing;
 * `/tier` shows the state. `OMP_TIER` sets the tier at launch; a value that
 * is not a tier name or `off` (the retired `deterministic` included) is an
 * error, never a silent `main` (`2026-10-19-model-assignment.md`): the router
 * still holds `main` — landing on a direct provider is the defect it exists
 * to prevent — and reports the bad value at session start, before every
 * prompt and in `/tier` until `/tier <tier>` or `/tier off` settles it.
 *
 * Failures are reported, never thrown: an unknown model, a build without
 * `ctx.setModel`, a refused switch — each becomes one notice, and the turn
 * proceeds on whatever model omp has.
 */

import type { OmpBeforeAgentStartEvent, OmpCommandContext, OmpContext } from "./omp";

export const TIERS = ["main", "complex", "executor"] as const;
export type Tier = (typeof TIERS)[number];
export type TierMode = "off" | Tier;

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * The router's one state: holding a tier, not enforcing, or holding `main`
 * while reporting a bad `OMP_TIER`. One value, so settling the error cannot
 * be forgotten at one site.
 */
export type TierState =
  | { readonly kind: "held"; readonly tier: Tier }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly message: string; readonly tier: "main" };

/** The tier a state holds, or undefined when the router is off. */
function heldTier(state: TierState): Tier | undefined {
  return state.kind === "off" ? undefined : state.tier;
}

/**
 * The launch-time state: unset (or empty) is `main`, `OMP_TIER=off` stops
 * enforcing, a tier name is that tier; any other word holds `main` and
 * carries an error naming it.
 */
export function initialMode(env: NodeJS.ProcessEnv): TierState {
  const wanted = env.OMP_TIER;
  if (wanted === undefined || wanted === "") return { kind: "held", tier: "main" };
  if (wanted === "off") return { kind: "off" };
  if (isTier(wanted)) return { kind: "held", tier: wanted };
  return {
    kind: "error",
    tier: "main",
    message: `unknown OMP_TIER "${wanted}"; holding main until /tier <tier> or /tier off (valid: ${TIERS.join(", ")}, off)`,
  };
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
    return {
      switched: false,
      message: `no model ${wanted} in omp's registry (models.yml provider "${providerId}", LITELLM_API_KEY resolved?)`,
    };
  }
  if (ctx.setModel === undefined)
    return { switched: false, message: "this omp build exposes no ctx.setModel" };
  try {
    await ctx.setModel(wanted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { switched: false, message: `cannot switch to ${wanted}: ${message}` };
  }
  return { switched: true, message: `switched to ${wanted}` };
}

export interface TierDeps {
  readonly env?: NodeJS.ProcessEnv;
}

export interface TierRouter {
  readonly mode: () => TierMode;
  readonly onSessionStart: (ctx: OmpContext) => Promise<void>;
  readonly onPrompt: (event: OmpBeforeAgentStartEvent, ctx: OmpContext) => Promise<void>;
  readonly onCommand: (args: string, ctx: OmpCommandContext) => Promise<void>;
}

/** The session-tier state and its entry points; `index.ts` wires them to omp. */
export function createTierRouter(deps: TierDeps = {}): TierRouter {
  const env = deps.env ?? process.env;
  let state: TierState = initialMode(env);
  const providerId = env.OMP_TIER_PROVIDER ?? "proxy";

  const status = (ctx: OmpContext, text: string): void => {
    ctx.ui?.setStatus?.("jig-tier", `tier: ${text}`);
  };
  const notify = (ctx: OmpContext, text: string, level: "info" | "warn" | "error"): void => {
    ctx.ui?.notify?.(text, level);
  };

  /** Put the session back on its tier; say so only when something changed or failed. */
  const hold = async (ctx: OmpContext, why: string): Promise<void> => {
    const tier = heldTier(state);
    if (tier === undefined) return;
    if (state.kind === "error") notify(ctx, `tier-router: ${state.message}`, "error");
    const was = activeSelector(ctx) ?? "no model";
    const result = await routeTo(tier, providerId, ctx);
    if (result.switched) {
      status(ctx, tier);
      notify(
        ctx,
        `tier-router: ${was} → ${providerId}/${tier} (${why}; the session's tier is ${tier})`,
        "info",
      );
    } else if (result.message.startsWith("already")) {
      status(ctx, tier);
    } else {
      status(ctx, "not on a tier");
      notify(ctx, `tier-router: ${result.message}`, "error");
    }
  };

  return {
    mode: () => heldTier(state) ?? "off",

    async onSessionStart(ctx) {
      await hold(ctx, "session start");
    },

    async onPrompt(event, ctx) {
      const prompt = (event.prompt ?? "").trim();
      if (prompt.startsWith("/")) return;
      await hold(ctx, "before the prompt");
    },

    async onCommand(args, ctx) {
      const wanted = (args ?? "").trim();
      if (wanted === "") {
        const shown =
          state.kind === "error" ? state.message : `session tier ${heldTier(state) ?? "off"}`;
        notify(
          ctx,
          `tier-router: ${shown} — active model ${activeSelector(ctx) ?? "unknown"}`,
          state.kind === "error" ? "error" : "info",
        );
        return;
      }
      if (wanted === "off") {
        state = { kind: "off" };
        status(ctx, "off");
        notify(
          ctx,
          "tier-router: not holding the model; /model is yours until /tier <tier>.",
          "info",
        );
        return;
      }
      if (!isTier(wanted)) {
        notify(
          ctx,
          `tier-router: unknown tier "${wanted}". Use main, complex, executor, or off.`,
          "error",
        );
        return;
      }
      state = { kind: "held", tier: wanted };
      const result = await routeTo(wanted, providerId, ctx);
      const ok = result.switched || result.message.startsWith("already");
      status(ctx, ok ? wanted : "not on a tier");
      notify(
        ctx,
        ok
          ? `tier-router: session tier is now ${wanted} (${result.message}).`
          : `tier-router: ${result.message}`,
        ok ? "info" : "error",
      );
    },
  };
}
