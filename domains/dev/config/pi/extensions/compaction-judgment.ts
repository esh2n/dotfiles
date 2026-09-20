import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { convertToLlm, type ExtensionAPI, type ExtensionContext, serializeConversation } from "@earendil-works/pi-coding-agent";

// compaction-judgment — let jig decide which items a compaction keeps.
//
// pi's built-in compaction hands the whole span to a summarizer. This extension
// asks jig, item by item, whether the item is worth keeping, and only the kept
// items are given to the summarizer — the dropped ones are passed as one line
// each, so the summarizer knows they existed without paying for their text. Tool
// results are the bulk of a long context, so that is where the saving is.
//
// Nothing about the question, the pinning rules or the confidence threshold lives
// here: the service answers `POST /compact` with jig's own use-case
// (`app/compaction/compact.ts`), and a weak judgment keeps the item.
//
// The summarizer is pi's own model (`ctx.model`) with its own `complete()` call,
// exactly as the official custom-compaction example does; `usage` is returned so
// the session's token totals stay honest.
//
// OFF by default: one judgment call is spent per compaction, so turning it on is
// the user's decision (`/compact-judgment on`, or PI_COMPACT_JUDGMENT=on to make it
// the default). Measured against the live judgment model, the question it asks
// currently drops a 31k-char file read and a byte-identical repeat of it
// (confidence 0.95/0.94) and a 48-char `ls` (0.66), while keeping an ask (0.88) and
// a conclusion (0.94) — one round trip for all of them.
//
// Every failure path returns undefined, which means "let pi do its normal
// compaction" — this extension can slow compaction down but cannot lose context by
// failing.

const SERVICE_DEFAULT = "http://127.0.0.1:4100";
/** How much of each item the judgment reads. Enough to recognize the item, not to summarize it. */
const JUDGMENT_CHARS = 200;
/** Upper bound per kept item in the summarizer's input: only a pathological message hits this. */
const KEPT_CHARS = 20_000;
/** Below this many items there is nothing to judge: the first and the last two are always kept. */
const MIN_ITEMS = 4;
const MAX_SUMMARY_TOKENS = 8192;

interface CompactItem {
  readonly id: string;
  readonly summary: string;
  readonly pinned?: boolean;
}

interface CompactDecision {
  readonly id: string;
  readonly kept: boolean;
  readonly confidence: number;
  readonly source: "pinned" | "decided" | "fallback";
}

interface CompactAnswer {
  readonly kept: readonly { readonly id: string }[];
  readonly decisions: readonly CompactDecision[];
}

/** A message as far as this file cares: a role, some content, maybe a tool name. */
interface Messageish {
  readonly role?: string;
  readonly content?: unknown;
  readonly toolName?: string;
}

function serviceBase(): string {
  const configured = process.env.JIG_DECISION_URL ?? SERVICE_DEFAULT;
  return configured.replace(/\/(decide|tier|compact)$/, "").replace(/\/$/, "");
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

function textParts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
  }
  return parts;
}

function toolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as { type?: unknown; name?: unknown };
    if (record.type === "toolCall" && typeof record.name === "string") names.push(record.name);
  }
  return names;
}

function clip(text: string, limit: number): string {
  const squeezed = text.replace(/\s+/g, " ").trim();
  return squeezed.length <= limit ? squeezed : `${squeezed.slice(0, limit)}…`;
}

function textOf(message: Messageish): string {
  return textParts(message.content).join("\n");
}

/** One line per item: what the judgment reads, and all the summarizer gets of a dropped item. */
function oneLineOf(message: Messageish): string {
  const body = clip(textOf(message), JUDGMENT_CHARS);
  if (message.role === "toolResult") {
    return `tool result ${message.toolName ?? "?"}: ${body}`;
  }
  if (message.role === "assistant") {
    const calls = toolNames(message.content);
    const suffix = calls.length === 0 ? "" : ` [calls: ${calls.join(", ")}]`;
    return `assistant: ${body}${suffix}`;
  }
  return `${message.role ?? "message"}: ${body}`;
}

/**
 * The human's asks are pinned: they are short, they are the ground truth of the
 * session, and a compaction that loses what was asked for is worse than one that
 * keeps too much.
 */
function isPinned(message: Messageish): boolean {
  return message.role === "user";
}

async function askKeepOrDrop(
  items: readonly CompactItem[],
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<CompactAnswer> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const abort = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const response = await fetch(`${serviceBase()}/compact`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ items }),
    signal: abort,
  });
  if (response.status === 404) throw new Error("judgment service has no /compact endpoint");
  const body = (await response.json()) as unknown;
  if (typeof body !== "object" || body === null) throw new Error("judgment service replied with no body");
  const record = body as Partial<CompactAnswer> & { error?: { message?: string } };
  if (!Array.isArray(record.kept) || !Array.isArray(record.decisions)) {
    throw new Error(record.error?.message ?? "judgment service replied without decisions");
  }
  return { kept: record.kept, decisions: record.decisions };
}

function summarizerPrompt(kept: string, dropped: readonly string[], previous: string | undefined): string {
  const previousBlock =
    previous === undefined || previous.trim() === ""
      ? ""
      : `\n\nA previous summary of this session exists. Merge it into yours so nothing from it is lost:\n<previous_summary>\n${previous}\n</previous_summary>\n`;
  const droppedBlock =
    dropped.length === 0
      ? ""
      : `\n\nThese items were judged expendable and are NOT included in full. You may mention that they happened, but do not invent their content:\n${dropped
          .map((line) => `- ${line}`)
          .join("\n")}\n`;
  return `You are a conversation summarizer. Produce a structured summary of the session below that captures:
1. What the user asked for, in their own terms
2. Decisions made and why
3. Files changed and technical details that matter
4. The current state of any ongoing work
5. Open questions, blockers, and the next step${previousBlock}${droppedBlock}
The summary replaces the conversation history, so it must stand alone. Be thorough but concise; do not continue the conversation.

<conversation>
${kept}
</conversation>`;
}

export default function (pi: ExtensionAPI) {
  let enabled = process.env.PI_COMPACT_JUDGMENT === "on";
  let announcedFailure = false;

  const timeoutMs = Number.parseInt(process.env.PI_COMPACT_JUDGMENT_TIMEOUT_MS ?? "", 10) || 30_000;

  async function summarize(
    prompt: string,
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
  ): Promise<{ text: string; usage: unknown } | undefined> {
    const model = ctx.model;
    if (model === undefined) return undefined;
    const response = await ctx.modelRegistry.complete(
      model,
      { messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }] }] },
      { maxTokens: MAX_SUMMARY_TOKENS, ...(signal === undefined ? {} : { signal }), cacheRetention: "none", sessionId: crypto.randomUUID() },
    );
    const text = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (text.trim() === "") return undefined;
    return { text, usage: response.usage };
  }

  pi.on("session_before_compact", async (event, ctx) => {
    if (!enabled) return;

    const { preparation, signal } = event;
    const messages = [
      ...preparation.messagesToSummarize,
      ...preparation.turnPrefixMessages,
    ] as readonly Messageish[];

    // Too little material to judge, or nothing jig could drop: pi's own
    // summarization is cheaper than a judgment call.
    if (messages.length < MIN_ITEMS) return;

    const items: CompactItem[] = messages.map((message, index) => ({
      id: `m${index}`,
      summary: oneLineOf(message),
      ...(isPinned(message) ? { pinned: true } : {}),
    }));

    let answer: CompactAnswer;
    try {
      answer = await askKeepOrDrop(items, timeoutMs, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.setStatus("compact", "judgment unavailable");
      if (!announcedFailure) {
        announcedFailure = true;
        ctx.ui.notify(
          `compaction: judgment service unavailable (${message}); using pi's own compaction`,
          "error",
        );
      } else {
        console.error(`compaction-judgment: judgment service unavailable (${message})`);
      }
      return;
    }

    const keptIds = new Set(answer.kept.map((entry) => entry.id));
    const kept = messages.filter((_, index) => keptIds.has(`m${index}`));
    const droppedIndexes = messages
      .map((_, index) => index)
      .filter((index) => !keptIds.has(`m${index}`));

    // Nothing was judged expendable, so there is nothing to gain by taking over.
    if (droppedIndexes.length === 0) return;

    // Serialize each kept message on its own: that keeps the message boundaries the
    // summarizer expects AND gives the per-item cap somewhere to apply.
    const keptText = kept
      .map((message) =>
        serializeConversation(convertToLlm([message] as never)).slice(0, KEPT_CHARS),
      )
      .join("\n");
    const droppedLines = droppedIndexes.map((index) => clip(items[index]?.summary ?? "", JUDGMENT_CHARS));

    try {
      const summary = await summarize(
        summarizerPrompt(keptText, droppedLines, preparation.previousSummary),
        ctx,
        signal,
      );
      if (summary === undefined) return;

      ctx.ui.setStatus("compact", `kept ${kept.length}/${messages.length}`);
      ctx.ui.notify(
        `compaction: judged ${messages.length} items, kept ${kept.length}, dropped ${droppedIndexes.length}`,
        "info",
      );
      return {
        compaction: {
          summary: summary.text,
          firstKeptEntryId: preparation.firstKeptEntryId,
          tokensBefore: preparation.tokensBefore,
          ...(summary.usage === undefined ? {} : { usage: summary.usage as never }),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`compaction: summarizer failed (${message}); using pi's own compaction`, "error");
      return;
    }
  });

  pi.registerCommand("compact-judgment", {
    description: "Judge which items a compaction keeps: /compact-judgment [on|off]",
    handler: async (args, ctx) => {
      const wanted = (args ?? "").trim();
      if (wanted === "") {
        ctx.ui.notify(`compaction-judgment: ${enabled ? "on" : "off"}`, "info");
        return;
      }
      if (wanted !== "on" && wanted !== "off") {
        ctx.ui.notify(`compaction-judgment: unknown mode "${wanted}". Use on or off.`, "error");
        return;
      }
      enabled = wanted === "on";
      ctx.ui.setStatus("compact", enabled ? "on" : "off");
      ctx.ui.notify(
        enabled
          ? "compaction-judgment: on — jig decides what a compaction keeps (one judgment call per compaction)."
          : "compaction-judgment: off — pi's own compaction.",
        "info",
      );
    },
  });
}
