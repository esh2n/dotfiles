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
// before the turn. `/tier <main|complex|deterministic>` changes the session's
// tier (an owner's choice, applied from the next prompt); `/tier off` stops
// enforcing; `/tier` shows the state. `PI_TIER` sets the tier at launch.
//
// Resident cost: nothing — no HTTP call, no tools, no injected context.

const TIERS = ["main", "complex", "deterministic"] as const;
type Tier = (typeof TIERS)[number];
type Mode = "off" | Tier;

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The launch-time mode: `PI_TIER=off` or a tier name; anything else is `main`. */
export function initialMode(env: NodeJS.ProcessEnv): Mode {
  const wanted = env.PI_TIER;
  if (wanted === "off") return "off";
  return isTier(wanted) ? wanted : "main";
}

export default function (pi: ExtensionAPI) {
  let mode: Mode = initialMode(process.env);
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
    if (mode === "off") return;
    const result = await holdTo(mode, ctx);
    if (result.switched) {
      ctx.ui.notify(`tier-router: ${result.message} (the session's tier is ${mode})`, "info");
    } else if (!result.message.startsWith("already")) {
      console.error(`tier-router: ${result.message}`);
    }
  });

  pi.registerCommand("tier", {
    description:
      "Session tier: /tier [main|complex|deterministic|off] — fixed for the session, never automatic",
    handler: async (args, ctx) => {
      const wanted = (args ?? "").trim();

      if (wanted === "") {
        const active = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
        ctx.ui.notify(`tier-router: session tier ${mode} — active model ${active}`, "info");
        return;
      }

      if (wanted === "off") {
        mode = "off";
        ctx.ui.setStatus("tier", "off");
        ctx.ui.notify(
          "tier-router: not holding the model; /model is yours until /tier <tier>.",
          "info",
        );
        return;
      }

      if (!isTier(wanted)) {
        ctx.ui.notify(
          `tier-router: unknown tier "${wanted}". Use main, complex, deterministic, or off.`,
          "error",
        );
        return;
      }

      mode = wanted;
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
