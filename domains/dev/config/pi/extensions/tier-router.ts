import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// tier-router — ask jig which tier a request needs, and switch the model.
//
// The judgment (the question, its per-option criteria, the confidence threshold)
// lives in jig, not here: this extension posts the raw prompt to the judgment
// service's `/tier` endpoint and switches to the tier that comes back. Two
// harnesses asking the same question with their own wording would be two
// different judgments, so there is exactly one wording and it is not in this
// file.
//
// The service holds the API key; this extension holds none. If the service is
// down, routing silently keeps the current model — never blocks a prompt, never
// throws into pi's extension loader.
//
// ON by default: every user prompt is judged, because a tier that is never asked
// for is a tier nobody can review. `/tier off` returns to whatever the model was,
// and `PI_TIER_ROUTER=off` makes that the default. `/tier <main|complex|
// deterministic>` forces a tier and stops asking.
//
// Measured cost of the judgment itself: 391 input tokens for a 39-character prompt,
// 4,959 for a 7,917-character one — the whole prompt is the judgment's material, so
// the cost grows with the prompt. A weak judgment does not switch anything (the
// service returns `main` with `source: "fallback"`, which the service counts
// separately, so a routing that is not really deciding is visible).
//
// Resident cost: one HTTP call per user prompt in `auto`, nothing at all in `off`
// or when a tier is forced. No tools, no per-turn context injection.

const TIERS = ["main", "complex", "deterministic"] as const;
type Tier = (typeof TIERS)[number];
type Mode = "off" | "auto" | Tier;

interface TierDecision {
  readonly tier: Tier;
  readonly confidence: number;
  readonly source: "decided" | "fallback";
}

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** `JIG_DECISION_URL` may point at an endpoint; the base is what we need. */
function serviceBase(): string {
  const configured = process.env.JIG_DECISION_URL ?? "http://127.0.0.1:4100";
  return configured.replace(/\/(decide|tier)$/, "").replace(/\/$/, "");
}

const DEFAULT_TOKEN_FILE = join(homedir(), "Library/Application Support/jig/decision.token");

/**
 * The judgment service's bearer token, read from the same file the service and
 * every other consumer share. Never throws: a missing or unreadable file just
 * means the request goes out with no `authorization` header, and the service's
 * 401 is handled the same as any other judgment failure below.
 */
async function decisionToken(): Promise<string | undefined> {
  const path = process.env.JIG_DECISION_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  try {
    const trimmed = (await readFile(path, "utf8")).trim();
    return trimmed === "" ? undefined : trimmed;
  } catch {
    return undefined;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await decisionToken();
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

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

async function askTier(request: string, timeoutMs: number): Promise<TierDecision> {
  const response = await fetch(`${serviceBase()}/tier`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ request }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) throw new Error("judgment service has no /tier endpoint");
  return readDecision(await response.json());
}

export default function (pi: ExtensionAPI) {
  // Opt out, not opt in: `PI_TIER_ROUTER=off` is the switch, and anything else
  // (including unset) routes. A tier decision that is never exercised cannot be
  // judged, and the service counts every judgment it makes.
  let mode: Mode = process.env.PI_TIER_ROUTER === "off" ? "off" : "auto";
  let announcedFailure = false;

  const providerId = process.env.PI_TIER_PROVIDER ?? "proxy";
  const timeoutMs = Number.parseInt(process.env.PI_TIER_TIMEOUT_MS ?? "", 10) || 15_000;

  function label(decision: TierDecision): string {
    const confidence = decision.confidence.toFixed(2);
    return decision.source === "fallback"
      ? `${decision.tier} (fallback ${confidence})`
      : `${decision.tier} (${confidence})`;
  }

  /** Switch to `tier` if that is not already the active model. Returns the model id in use. */
  async function routeTo(
    tier: Tier,
    reason: string,
    ctx: ExtensionContext,
  ): Promise<{ switched: boolean; message: string }> {
    if (ctx.model?.id === tier && ctx.model.provider === providerId) {
      ctx.ui.setStatus("tier", `${tier}${reason}`);
      return { switched: false, message: `already ${tier}` };
    }
    const model = ctx.modelRegistry.find(providerId, tier);
    if (model === undefined) {
      return { switched: false, message: `no model ${providerId}/${tier} in the registry` };
    }
    const ok = await pi.setModel(model);
    if (!ok) return { switched: false, message: `cannot switch to ${providerId}/${tier}` };
    ctx.ui.setStatus("tier", `${tier}${reason}`);
    return { switched: true, message: `switched to ${providerId}/${tier}` };
  }

  pi.on("before_agent_start", async (event, ctx) => {
    if (mode === "off") return;

    const prompt = (event.prompt ?? "").trim();
    // Slash commands are not requests to route, and an empty prompt has nothing to judge.
    if (prompt === "" || prompt.startsWith("/")) return;

    if (mode !== "auto") {
      const result = await routeTo(mode, " (forced)", ctx);
      if (!result.switched) console.error(`tier-router: ${result.message}`);
      return;
    }

    try {
      const decision = await askTier(prompt, timeoutMs);
      const result = await routeTo(decision.tier, ` ${label(decision)}`, ctx);
      ctx.ui.notify(`tier-router: ${result.message} — ${label(decision)}`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setStatus("tier", "judgment unavailable");
      if (!announcedFailure) {
        announcedFailure = true;
        ctx.ui.notify(
          `tier-router: judgment service unavailable (${message}); keeping the current model`,
          "error",
        );
      } else {
        console.error(`tier-router: judgment service unavailable (${message})`);
      }
    }
  });

  pi.registerCommand("tier", {
    description: "Model routing: /tier [auto|off|main|complex|deterministic]",
    handler: async (args, ctx) => {
      const wanted = (args ?? "").trim();

      if (wanted === "") {
        const active = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
        ctx.ui.notify(`tier-router mode: ${mode} — active model: ${active}`, "info");
        return;
      }

      if (wanted === "auto" || wanted === "off") {
        mode = wanted;
        ctx.ui.setStatus("tier", wanted === "auto" ? "auto" : "off");
        ctx.ui.notify(
          wanted === "auto"
            ? "tier-router: judging every request (one judgment call per prompt)."
            : "tier-router: automatic routing off; the model will not change on its own.",
          "info",
        );
        return;
      }

      if (!isTier(wanted)) {
        ctx.ui.notify(`tier-router: unknown mode "${wanted}". Use auto, off, or a tier name.`, "error");
        return;
      }

      mode = wanted;
      const result = await routeTo(wanted, " (forced)", ctx);
      ctx.ui.notify(
        result.switched
          ? `tier-router: ${result.message}; automatic routing off until /tier auto.`
          : `tier-router: ${result.message}`,
        result.switched ? "info" : "error",
      );
    },
  });
}
