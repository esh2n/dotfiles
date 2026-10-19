import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// tier-router — hold the session on ONE LiteLLM tier; never switch on its own.
//
// Ruling (rules/decisions/2026-09-23-tier-fixed-main-subagent-escalation.md):
// the main session's model is fixed for the session — `main` unless the owner
// picks another tier — and a stronger model is reached by delegating to a
// subagent whose `model:` maps to `complex`, not by swapping the main model
// mid-conversation. The per-prompt judgment this extension used to run
// (jig's `/tier`) is gone: no vendor harness switches the main model per turn
// (Claude Code: "The main session does not automatically switch models"),
// LiteLLM recommends session affinity because a switch drops provider-side
// prompt caching, and the one measured same-shape implementation lost most
// of its cache and overflowed a smaller model's window
// (see the ruling above).
//
// What is left is enforcement: if the active model is not `<provider>/<tier>`
// — a `/model` pick of a direct provider, or pi's own startup race that
// starts on another provider's default (pi #8810) — the handler puts it back
// before the turn. `/tier <main|complex|executor>` changes the session's
// tier (an owner's choice, applied from the next prompt); `/tier off` stops
// enforcing; `/tier` shows the state. `PI_TIER` sets the tier at launch; a
// value that is not a tier name or `off` (the retired `deterministic`
// included) is an error, never a silent `main`
// (rules/decisions/2026-10-19-model-assignment.md): the router still holds
// `main` — landing on a direct provider is the defect it exists to prevent —
// and reports the bad value before every prompt and in `/tier` until
// `/tier <tier>` or `/tier off` settles it.
//
// Resident cost: nothing — no HTTP call, no tools, no injected context.

const TIERS = ["main", "complex", "executor"] as const;
type Tier = (typeof TIERS)[number];
type Mode = "off" | Tier;

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * The router's one state: holding a tier, not enforcing, or holding `main`
 * while reporting a bad `PI_TIER`. One value, so settling the error cannot
 * be forgotten at one site.
 */
export type TierState =
  | { readonly kind: "held"; readonly tier: Tier }
  | { readonly kind: "off" }
  | { readonly kind: "error"; readonly message: string; readonly tier: "main" };

/** The mode a state shows: its tier, or `off`. */
function modeOf(state: TierState): Mode {
  return state.kind === "off" ? "off" : state.tier;
}

/**
 * The launch-time state: unset (or empty) is `main`, `PI_TIER=off` stops
 * enforcing, a tier name is that tier; any other word holds `main` and
 * carries an error naming it.
 */
export function initialMode(env: NodeJS.ProcessEnv): TierState {
  const wanted = env.PI_TIER;
  if (wanted === undefined || wanted === "") return { kind: "held", tier: "main" };
  if (wanted === "off") return { kind: "off" };
  if (isTier(wanted)) return { kind: "held", tier: wanted };
  return {
    kind: "error",
    tier: "main",
    message: `unknown PI_TIER "${wanted}"; holding main until /tier <tier> or /tier off (valid: ${TIERS.join(", ")}, off)`,
  };
}

export default function (pi: ExtensionAPI) {
  let state: TierState = initialMode(process.env);
  const providerId = process.env.PI_TIER_PROVIDER ?? "proxy";

  /** Switch to `tier` if that is not already the active model. */
  async function holdTo(
    tier: Tier,
    ctx: ExtensionContext,
  ): Promise<{ switched: boolean; message: string }> {
    if (ctx.model?.id === tier && ctx.model.provider === providerId) {
      ctx.ui.setStatus("tier", tier);
      return { switched: false, message: `already ${tier}` };
    }
    const model = ctx.modelRegistry.find(providerId, tier);
    if (model === undefined) {
      return { switched: false, message: `no model ${providerId}/${tier} in the registry` };
    }
    const ok = await pi.setModel(model);
    if (!ok) return { switched: false, message: `cannot switch to ${providerId}/${tier}` };
    ctx.ui.setStatus("tier", tier);
    return { switched: true, message: `switched to ${providerId}/${tier}` };
  }

  pi.on("before_agent_start", async (_event, ctx) => {
    if (state.kind === "off") return;
    if (state.kind === "error") ctx.ui.notify(`tier-router: ${state.message}`, "error");
    const tier = state.tier;
    const result = await holdTo(tier, ctx);
    if (result.switched) {
      ctx.ui.notify(`tier-router: ${result.message} (the session's tier is ${tier})`, "info");
    } else if (!result.message.startsWith("already")) {
      console.error(`tier-router: ${result.message}`);
    }
  });

  pi.registerCommand("tier", {
    description:
      "Session tier: /tier [main|complex|executor|off] — fixed for the session, never automatic",
    handler: async (args, ctx) => {
      const wanted = (args ?? "").trim();

      if (wanted === "") {
        const active = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
        const shown = state.kind === "error" ? state.message : `session tier ${modeOf(state)}`;
        ctx.ui.notify(
          `tier-router: ${shown} — active model ${active}`,
          state.kind === "error" ? "error" : "info",
        );
        return;
      }

      if (wanted === "off") {
        state = { kind: "off" };
        ctx.ui.setStatus("tier", "off");
        ctx.ui.notify(
          "tier-router: not holding the model; /model is yours until /tier <tier>.",
          "info",
        );
        return;
      }

      if (!isTier(wanted)) {
        ctx.ui.notify(
          `tier-router: unknown tier "${wanted}". Use main, complex, executor, or off.`,
          "error",
        );
        return;
      }

      state = { kind: "held", tier: wanted };
      const result = await holdTo(wanted, ctx);
      ctx.ui.notify(
        result.switched || result.message.startsWith("already")
          ? `tier-router: session tier is now ${wanted} (${result.message}).`
          : `tier-router: ${result.message}`,
        result.switched || result.message.startsWith("already") ? "info" : "error",
      );
    },
  });
}
