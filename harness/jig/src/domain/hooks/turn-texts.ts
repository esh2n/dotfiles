/**
 * The assistant text blocks of the owner's current turn, read from a Claude Code session
 * transcript (JSONL, one entry per line). The format is Claude Code's own and undocumented,
 * so anything unrecognised is skipped.
 *
 * The turn starts after the owner's last message: a user entry that is not a tool result,
 * not a meta entry (hook feedback, image notes, messages from other sessions) and not a task
 * notification. Everything the model wrote since, across tool calls, background-task
 * wake-ups and hook-forced continuations, belongs to it.
 */

interface Block {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: unknown;
}

interface Entry {
  readonly type?: unknown;
  readonly isMeta?: unknown;
  readonly isSidechain?: unknown;
  readonly origin?: { readonly kind?: unknown };
  readonly message?: { readonly content?: unknown };
}

export interface TurnTexts {
  /** What the model wrote this turn, in order. */
  readonly texts: readonly string[];
  /**
   * The Stop hook feedback and the guard's reply-language denials given this turn, so a
   * passage either already named is not named twice.
   */
  readonly feedback: readonly string[];
}

const FEEDBACK_PREFIX = "Stop hook feedback:";

/** Opens the guard's reply-language denial, which Claude Code hands back as the tool result. */
export const LANGUAGE_DENIAL_MARKER = "jig guard (reply language):";

function parse(line: string): Entry | undefined {
  if (line.trim() === "") return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Entry) : undefined;
  } catch {
    return undefined;
  }
}

function blocks(entry: Entry): readonly Block[] {
  const content = entry.message?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

function fromTheOwner(entry: Entry): boolean {
  if (entry.type !== "user" || entry.isMeta === true || entry.isSidechain === true) return false;
  if (entry.origin?.kind === "task-notification") return false;
  return blocks(entry).every((block) => block.type !== "tool_result");
}

function isToolResult(entry: Entry): boolean {
  return (
    entry.type === "user" &&
    entry.isSidechain !== true &&
    blocks(entry).some((block) => block.type === "tool_result")
  );
}

function resultTexts(block: Block): readonly string[] {
  if (typeof block.content === "string") return [block.content];
  if (!Array.isArray(block.content)) return [];
  return (block.content as Block[]).flatMap((part) =>
    typeof part.text === "string" ? [part.text] : [],
  );
}

function feedback(entry: Entry): readonly string[] {
  if (entry.type !== "user") return [];
  const content = entry.message?.content;
  if (typeof content === "string") return content.startsWith(FEEDBACK_PREFIX) ? [content] : [];
  return blocks(entry)
    .filter((block) => block.type === "tool_result")
    .flatMap(resultTexts)
    .filter((text) => text.includes(LANGUAGE_DENIAL_MARKER));
}

function texts(entry: Entry): readonly string[] {
  if (entry.type !== "assistant" || entry.isSidechain === true) return [];
  return blocks(entry).flatMap((block) =>
    block.type === "text" && typeof block.text === "string" && block.text.trim() !== ""
      ? [block.text]
      : [],
  );
}

/** Empty when the transcript has no turn yet. */
export function currentTurnTexts(transcript: string): TurnTexts {
  const lines = transcript.split("\n");
  const found: string[] = [];
  const given: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parse(lines[i] ?? "");
    if (entry === undefined) continue;
    if (fromTheOwner(entry)) break;
    found.unshift(...texts(entry));
    given.unshift(...feedback(entry));
  }
  return { texts: found, feedback: given };
}

/**
 * What the model wrote after its last tool result (or the owner's message) in the current
 * turn: the passage the owner sees just before the tool call a PreToolUse hook is judging.
 * The transcript may be only its tail; when the tail does not reach back to that boundary,
 * this is `undefined` so that nothing is judged on a cut passage.
 */
export function passageBeforeToolCall(transcript: string): string | undefined {
  const lines = transcript.split("\n");
  const found: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = parse(lines[i] ?? "");
    if (entry === undefined) continue;
    if (fromTheOwner(entry) || isToolResult(entry)) return found.join("\n\n");
    found.unshift(...texts(entry));
  }
  return undefined;
}
