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
  | "skill-body"
  | "harness-nudge"
  | "harness-notice"
  | "workflow-task"
  | "slash-noop"
  | "command-body"
  | "probe";

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
 *
 * A second pass (`domains/dev/llm/harness/rules/research/skill-selection-experiment`,
 * README.md §2, extracted by that dir's `tools/sample.mjs`) found six more machine shapes
 * that these seven signatures let through as "human" — 750 of 7,406 prompts, 32% of what
 * this classifier called human before they were added, from the same 30-day window:
 *
 *  - `[Your previous response had no visible output` — 478 (`harness-nudge`). The harness's
 *    own auto-continue nudge after a turn produced nothing visible.
 *  - Four openings, one reason (`harness-notice`, 94 total): `[Request interrupted by user`,
 *    `Your claude.ai usage limit has reset`, `<local-command-caveat>`, `Continue from where
 *    you left off`.
 *  - `## Acceptance Contract` — 80 (`workflow-task`). A workflow's subagent task template.
 *    Not a prefix (it sits partway through the template), and in pi this child runs as its
 *    own session, so it carries no `agentType`/`agentId` for the structural check above to
 *    catch. See `isWorkflowTask` for how this is matched without falling back to a bare
 *    substring search.
 *  - `/clear`, `/compact`, `/init` as the WHOLE prompt, bare or `<command-name>`/
 *    `<command-message>`-wrapped with no args — 42 (`slash-noop`). See `isSlashNoop`.
 *  - A slash command's own expanded body, re-submitted as a prompt — 41 (`command-body`):
 *    `# /`, a `---` frontmatter block opening with `name:`, `description:` or
 *    `argument-hint:`, or `Approach this as the design lead`.
 *  - `Reply with exactly:` — 15 (`probe`). The owner's own router smoke tests.
 */
const SIGNATURES: readonly (readonly [NonHumanReason, string])[] = [
  ["hook-event", "[MESSAGE FROM NON-USER SOURCE"],
  ["compaction", "Below is a conversation log"],
  ["task-notification", "<task-notification>"],
  ["session-resume", "This session is being continued"],
  ["agent-message", "Another Claude session sent a message"],
  ["agent-message", "[Subagent hand-back]"],
  ["skill-body", "Base directory for this skill:"],
  ["harness-nudge", "[Your previous response had no visible output"],
  ["harness-notice", "[Request interrupted by user"],
  ["harness-notice", "Your claude.ai usage limit has reset"],
  ["harness-notice", "<local-command-caveat>"],
  ["harness-notice", "Continue from where you left off"],
  ["command-body", "# /"],
  ["command-body", "---\nname:"],
  ["command-body", "---\ndescription:"],
  ["command-body", "---\nargument-hint:"],
  ["command-body", "Approach this as the design lead"],
  ["probe", "Reply with exactly:"],
];

/**
 * `/clear`, `/compact` and `/init` are ordinary words in a real request too ("what does
 * /compact do?"), so this only fires when one of them IS the entire trimmed prompt — the
 * shape Claude Code actually re-submits for a no-op slash command — either bare or wrapped
 * in the `<command-name>`/`<command-message>` tags with no (or empty) `<command-args>`.
 */
const SLASH_NOOP_COMMANDS = "clear|compact|init";
const BARE_SLASH_NOOP = new RegExp(`^/(?:${SLASH_NOOP_COMMANDS})$`);
const WRAPPED_SLASH_NOOP = new RegExp(
  `^<command-(name|message)>/(?:${SLASH_NOOP_COMMANDS})</command-\\1>(?:\\s*<command-args>\\s*</command-args>)?$`,
);

function isSlashNoop(wholeTrimmedPrompt: string): boolean {
  return BARE_SLASH_NOOP.test(wholeTrimmedPrompt) || WRAPPED_SLASH_NOOP.test(wholeTrimmedPrompt);
}

/**
 * `## Acceptance Contract` is the heading a workflow's task template opens its body with,
 * not the start of the prompt (the template preamble comes first) — so this is a per-line
 * check, not a prefix or a bare `includes`. Requiring the WHOLE line to be exactly that
 * heading (rather than "a line that mentions it") keeps a request that merely discusses the
 * marker in running prose — which is never alone on its own line — from being misread as a
 * workflow task.
 */
function isWorkflowTask(prompt: string): boolean {
  return prompt.split("\n").some((line) => line.trim() === "## Acceptance Contract");
}

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

  if (isSlashNoop(input.prompt.trim())) {
    return { human: false, reason: "slash-noop" };
  }
  if (isWorkflowTask(input.prompt)) {
    return { human: false, reason: "workflow-task" };
  }

  const text = input.prompt.trimStart();
  for (const [reason, prefix] of SIGNATURES) {
    if (text.startsWith(prefix)) return { human: false, reason };
  }

  return { human: true };
}
