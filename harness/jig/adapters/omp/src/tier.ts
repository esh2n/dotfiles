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
 * cache (`rules/research/2026-09-23-tier-routing-switch-vs-subagent-vs-gateway.md`).
 *
 * What is left is enforcement, which omp needs more than pi does: omp's own
 * startup order restores "the saved default provider/model" before anything
 * from `modelRoles`, and its implicit providers are keyless, so a session
 * can open on a direct provider (measured 2026-09-23: lm-studio's qwen). At
 * session start and before every prompt the active model is checked and put
 * back on `<provider>/<tier>` when it is anything else. `/tier <main|complex|
 * deterministic>` changes the session's tier; `/tier off` stops enforcing;
 * `/tier` shows the state. `OMP_TIER` sets the tier at launch.
 *
 * Failures are reported, never thrown: an unknown model, a build without
 * `ctx.setModel`, a refused switch — each becomes one notice, and the turn
 * proceeds on whatever model omp has.
 */

import type { OmpBeforeAgentStartEvent, OmpCommandContext, OmpContext } from "./omp";

export const TIERS = ["main", "complex", "deterministic"] as const;
export type Tier = (typeof TIERS)[number];
export type TierMode = "off" | Tier;

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The launch-time mode: `OMP_TIER=off` or a tier name; anything else is `main`. */
export function initialMode(env: NodeJS.ProcessEnv): TierMode {
  const wanted = env.OMP_TIER;
  if (wanted === "off") return "off";
  return isTier(wanted) ? wanted : "main";
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
  let mode: TierMode = initialMode(env);
  const providerId = env.OMP_TIER_PROVIDER ?? "proxy";

  const status = (ctx: OmpContext, text: string): void => {
    ctx.ui?.setStatus?.("jig-tier", `tier: ${text}`);
  };
  const notify = (ctx: OmpContext, text: string, level: "info" | "warn" | "error"): void => {
    ctx.ui?.notify?.(text, level);
  };

  /** Put the session back on its tier; say so only when something changed or failed. */
  const hold = async (ctx: OmpContext, why: string): Promise<void> => {
    if (mode === "off") return;
    const was = activeSelector(ctx) ?? "no model";
    const result = await routeTo(mode, providerId, ctx);
    if (result.switched) {
      status(ctx, mode);
      notify(
        ctx,
        `tier-router: ${was} → ${providerId}/${mode} (${why}; the session's tier is ${mode})`,
        "info",
      );
    } else if (result.message.startsWith("already")) {
      status(ctx, mode);
    } else {
      status(ctx, "not on a tier");
      notify(ctx, `tier-router: ${result.message}`, "error");
    }
  };

  return {
    mode: () => mode,

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
        notify(
          ctx,
          `tier-router: session tier ${mode} — active model ${activeSelector(ctx) ?? "unknown"}`,
          "info",
        );
        return;
      }
      if (wanted === "off") {
        mode = "off";
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
          `tier-router: unknown tier "${wanted}". Use main, complex, deterministic, or off.`,
          "error",
        );
        return;
      }
      mode = wanted;
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
