/**
 * Is the text a `UserPromptSubmit` hook receives actually a request from a person?
 *
 * The hook fires on every prompt the harness submits, and most of those are not requests.
 * Measured over 30 days of this machine's transcripts (2026-09-22), 167 of the router's 209
 * injections landed on machine-generated text: 82 hook-event replays, 48 agent-to-agent
 * relays, 36 compaction passes and 1 skill body echoed back as a prompt. Their follow rate
 * is 0.0%, 2.1% and 0.0% — a compaction pass has no tool loop to follow anything with, and
 * a hook-event replay is a notification, not a request. Routing them spends a judgment (54
 * yes/no questions) and ~52 tokens of injected context to tell a summarizer to read a skill
 * it cannot act on.
 *
 * Two kinds of evidence, and they are deliberately not mixed:
 *
 *  - STRUCTURAL — `agent_type` / `agent_id`, which Claude Code puts on the hook input only
 *    when the hook runs inside a subagent (https://code.claude.com/docs/en/hooks.md,
 *    UserPromptSubmit common fields: "agent_id — Unique identifier for the subagent",
 *    "agent_type — Agent name"). A subagent's prompt is written by a model, so its presence
 *    settles the question without reading a byte of the text.
 *  - CONTENT SIGNATURES — for everything else, because the hook input has no field that
 *    marks a compaction pass or a replayed hook event. The docs describe no such field, so
 *    the only handle is the fixed preamble each of those carries. Each signature below is
 *    quoted from the actual samples in the 2026-09-22 investigation record and is an exact
 *    PREFIX match on the trimmed prompt: a prefix cannot be produced by quoting the phrase
 *    mid-request, which is what keeps a real request from being silently dropped.
 *
 * Conservative by construction: anything not matched is a human request. A pasted shell
 * transcript, a screenshot paste (`[Image: …]`) and a slash command are all real user
 * actions and stay routable. The cost of a false negative is one wasted judgment; the cost
 * of a false positive is a request the router silently refuses to help with.
 */

/** Why a prompt is not a human request. Recorded verbatim in the router log's `skipped`. */
export type NonHumanReason =
  | "subagent"
  | "hook-event"
  | "agent-message"
  | "task-notification"
  | "compaction"
  | "session-resume"
  | "skill-body";

export type PromptOrigin =
  | { readonly human: true }
  | { readonly human: false; readonly reason: NonHumanReason };

/** The parts of a `UserPromptSubmit` payload that say who wrote the prompt. */
export interface PromptOriginInput {
  readonly prompt: string;
  /** Present only inside a subagent. Any non-empty string counts; the value is the agent name. */
  readonly agentType?: unknown;
  /** Present only inside a subagent, alongside `agentType`. */
  readonly agentId?: unknown;
}

/**
 * The exact prefixes, in the shape the transcripts carry them (2026-09-22 sample counts over
 * 7,124 Claude Code prompts in the 30-day window):
 *
 *  - `[MESSAGE FROM NON-USER SOURCE` — 3,313. The harness's own label; the full line reads
 *    `[MESSAGE FROM NON-USER SOURCE - NOT USER INPUT]`, and only the stable head is matched
 *    so a change to the tail does not silently turn the rule off.
 *  - `Below is a conversation log` — 591. Claude Code's compaction prompt:
 *    "Below is a conversation log from a Claude Code coding session.\nCreate a summary…".
 *    This is the one that cost the most: `writeup` fired on it at 0.80-0.91 confidence 36
 *    times, correctly reading "create a summary" and injecting into a pass with no tool loop.
 *  - `<task-notification>` — 585. A subagent-completion notification.
 *  - `This session is being continued` — 437. The resume summary a continued session opens
 *    with ("…from a previous conversation that ran out of context").
 *  - `Another Claude session sent a message` — 103, and `[Subagent hand-back]` — 101 (the
 *    hand-back usually arrives inside the former, but is matched on its own because it also
 *    arrives standalone).
 *  - `Base directory for this skill:` — 40. A skill body replayed back as a prompt.
 */
const SIGNATURES: readonly (readonly [NonHumanReason, string])[] = [
  ["hook-event", "[MESSAGE FROM NON-USER SOURCE"],
  ["compaction", "Below is a conversation log"],
  ["task-notification", "<task-notification>"],
  ["session-resume", "This session is being continued"],
  ["agent-message", "Another Claude session sent a message"],
  ["agent-message", "[Subagent hand-back]"],
  ["skill-body", "Base directory for this skill:"],
];

function isPresent(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Classify one prompt. Structural evidence is checked first: it is the only evidence that
 * cannot be forged by a request that happens to quote a preamble.
 */
export function classifyPromptOrigin(input: PromptOriginInput): PromptOrigin {
  if (isPresent(input.agentType) || isPresent(input.agentId)) {
    return { human: false, reason: "subagent" };
  }

  const text = input.prompt.trimStart();
  for (const [reason, prefix] of SIGNATURES) {
    if (text.startsWith(prefix)) return { human: false, reason };
  }

  return { human: true };
}
