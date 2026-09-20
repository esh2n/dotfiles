import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// skill-router — ask jig which skill a request matches, and put that skill into the
// request as context.
//
// Why this exists. pi renders every installed skill's name and description into the
// system prompt before it sees a request, and an extension cannot remove what is
// already in that prompt. So the list is a fixed cost on every model request (4,674
// tokens for 58 skills on this machine, measured) and the model's own selection over
// it degrades as the list grows. Dropping the list from the prompt
// (`disable-model-invocation`) trades that fixed cost for one judgment per prompt;
// this extension supplies the one skill that fits.
//
// The judgment lives in jig, not here: this extension posts the prompt to the
// service's `/skill` endpoint, which owns the question, the per-option criteria and
// the confidence threshold. Two harnesses asking the same question in their own
// words would be two different judgments.
//
// Injected as a MESSAGE, never as a system-prompt rewrite. The system prompt is the
// cached prefix; rewriting it every turn changes the prefix, and everything after
// the change is then charged as a cache write (1.25x) instead of a cache read
// (0.1x). At 4,674 tokens that is about $0.016 per turn on Sonnet — eleven times
// the $0.0014 per request the removed list was costing. A message appended to the
// turn is cache-neutral.
//
// Failure is silence. A missing service, a slow one, a malformed reply or a `null`
// decision all leave the request exactly as it was; the extension never blocks a
// prompt and never throws into pi's extension loader. `PI_SKILL_ROUTER=off` turns it
// off without touching the list location.

export interface SkillDecision {
  /** Chosen skill's name, or `null` when nothing should be injected. */
  readonly skill: string | null;
  /** Where the chosen skill's body is, so the model can read it. */
  readonly path: string | null;
  readonly confidence: number;
  readonly source: "decided" | "fallback";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/** Read the service's reply. Throws only on a shape this extension cannot trust. */
export function readSkillDecision(body: unknown): SkillDecision {
  if (typeof body !== "object" || body === null) throw new Error("skill service replied with no body");
  const record = body as Record<string, unknown>;
  if (!isNullableString(record.skill) || !isNullableString(record.path)) {
    throw new Error("skill service reply has no skill/path");
  }
  if (typeof record.confidence !== "number") throw new Error("skill service reply has no confidence");
  if (record.source !== "decided" && record.source !== "fallback") {
    throw new Error("skill service reply has no source");
  }
  return {
    skill: record.skill,
    path: record.path,
    confidence: record.confidence,
    source: record.source,
  };
}

/**
 * The reminder the model receives. It names the skill, says why it appeared, and
 * points at the body rather than carrying it: a body is 1-15k characters, and
 * injecting it would hand back the context the router just freed.
 */
export function reminderFor(decision: SkillDecision): string | undefined {
  if (decision.skill === null || decision.path === null) return undefined;
  return [
    `jig skill router: this request matches the "${decision.skill}" skill (judgment confidence ${decision.confidence.toFixed(2)}).`,
    `Read ${decision.path} and follow it before doing the work.`,
  ].join("\n");
}

/** `JIG_DECISION_URL` may point at an endpoint; the base is what we need. */
function serviceBase(): string {
  const configured = process.env.JIG_DECISION_URL ?? "http://127.0.0.1:4100";
  return configured.replace(/\/(decide|tier|skill|compact)$/, "").replace(/\/$/, "");
}

const DEFAULT_TOKEN_FILE = join(homedir(), "Library/Application Support/jig/decision.token");

/**
 * The judgment service's bearer token, from the same file the service and every
 * other consumer share. Never throws: an unreadable file just means the request goes
 * out without an `authorization` header, and the resulting 401 is handled exactly
 * like any other failure (inject nothing).
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

async function askSkill(prompt: string, timeoutMs: number): Promise<SkillDecision> {
  const token = await decisionToken();
  const response = await fetch(`${serviceBase()}/skill`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    // `front` names the harness the judgment is for. The service cannot work it out —
    // every front posts this same shape over the same socket — and the router's log
    // records it so pi's numbers and Claude Code's are not read as one front's.
    body: JSON.stringify({ front: "pi", prompt }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) throw new Error("judgment service has no /skill endpoint");
  return readSkillDecision(await response.json());
}

export default function (pi: ExtensionAPI) {
  // Opt out, not opt in: `PI_SKILL_ROUTER=off` is the switch, anything else routes.
  // A router that is never exercised cannot be reviewed, and the service counts every
  // judgment it makes (kind `skill`) so the cost shows up on the dashboard.
  let mode = process.env.PI_SKILL_ROUTER === "off" ? "off" : "on";
  let announcedFailure = false;

  const timeoutMs = Number.parseInt(process.env.PI_SKILL_TIMEOUT_MS ?? "", 10) || 15_000;

  pi.on("before_agent_start", async (event, ctx) => {
    if (mode === "off") return;

    const prompt = (event.prompt ?? "").trim();
    // Slash commands carry their own instructions, and an empty prompt has nothing to
    // judge. Neither is a request to route.
    if (prompt === "" || prompt.startsWith("/")) return;

    try {
      const decision = await askSkill(prompt, timeoutMs);
      const reminder = reminderFor(decision);
      if (reminder === undefined) return;
      ctx.ui.setStatus("skill", `${decision.skill} (${decision.confidence.toFixed(2)})`);
      return {
        message: { customType: "jig-skill-router", content: reminder, display: false },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setStatus("skill", "judgment unavailable");
      if (!announcedFailure) {
        announcedFailure = true;
        ctx.ui.notify(
          `skill-router: judgment service unavailable (${message}); injecting nothing`,
          "error",
        );
      }
      return;
    }
  });
}
