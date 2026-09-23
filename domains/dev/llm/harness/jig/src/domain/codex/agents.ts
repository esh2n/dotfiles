/**
 * `~/.codex/agents/<name>.toml`, one generated file per `agents/*.md`.
 *
 * The source is a Claude Code subagent: YAML frontmatter with `name`,
 * `description`, `tools` and `model`, then the system prompt as the body.
 * Codex's custom agent is a TOML file with three required keys and a few
 * optional ones (https://learn.chatgpt.com/docs/agent-configuration/subagents,
 * "Custom agents": `name`, `description`, `developer_instructions` required;
 * `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`,
 * `skills.config` optional). The translation is one-to-one where a field
 * exists on both sides and explicit where it does not:
 *
 * - `name` and `description` are copied verbatim.
 * - the body becomes `developer_instructions`.
 * - `tools`: Codex has no per-agent tool list — the page names none, and a
 *   custom agent inherits the session's tools — so the list is rendered as
 *   one trailing sentence of the instructions rather than dropped.
 * - `model`: a Claude tier name (`haiku`/`sonnet`/`opus`) means nothing to
 *   Codex. It is looked up in the `codex` table of `agents/models.json`
 *   (`../claude/agent-models.ts`; the ruling of 2026-09-23 maps `sonnet` and
 *   `haiku` to `gpt-6-luna`, `opus` to `gpt-6-sol` —
 *   https://learn.chatgpt.com/docs/models, prices at
 *   https://developers.openai.com/api/docs/pricing), or overridden by the
 *   agent's own `models.codex` block. A tier the table does not know is left
 *   out, so Codex applies its own default, and reported. Omitting `model`
 *   inherits: "explicit spawn → `[agents]` default → parent" (subagents
 *   page). The generator never invents a Codex model id.
 * - `model_reasoning_effort`: written whenever the mapping or override
 *   carries a `reasoningEffort`. The config reference lists
 *   `low | medium | high | xhigh | max | ultra` and says "Available levels
 *   depend on the model and client"
 *   (https://learn.chatgpt.com/docs/config-file/config-reference); a value
 *   outside that list is refused here rather than written for Codex to
 *   reject at spawn.
 *
 * The source parser and the model question are `../claude/agent-definition.ts`,
 * shared with the omp target; the Codex names below are kept for callers.
 *
 * Pure: text in, text out. The caller reads the file and validates the
 * result as TOML if it wants to.
 */

import {
  type AgentDefinition,
  type ModelChoice,
  type ModelMapping,
  modelChoiceFor,
  parseAgentDefinition,
} from "../claude/agent-definition";

export { parseAgentDefinition };
export type { AgentDefinition, ModelMapping };

/** See `ModelChoice`: the same three answers, for a Codex model id. */
export type CodexModelChoice = ModelChoice;

/**
 * The `model_reasoning_effort` levels the config reference lists
 * (https://learn.chatgpt.com/docs/config-file/config-reference). Which of
 * them a given model accepts is Codex's to say; the official guidance is
 * "start with medium for GPT-6 Sol, high for GPT-6 Luna".
 */
export const CODEX_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;

/**
 * `modelChoiceFor`, plus the one check Codex adds: a reasoning effort must be
 * a level the config reference names. The error says which entry, so the
 * caller can add the file.
 */
export function codexModelFor(
  tier: string | undefined,
  map: Readonly<Record<string, ModelMapping>>,
  override?: ModelMapping,
): CodexModelChoice {
  const choice = modelChoiceFor(tier, map, override);
  if (
    choice.kind === "mapped" &&
    choice.reasoningEffort !== undefined &&
    !(CODEX_REASONING_EFFORTS as readonly string[]).includes(choice.reasoningEffort)
  ) {
    const where = choice.override === true ? "the models.codex override" : `tier "${choice.tier}"`;
    throw new Error(
      `reasoningEffort "${choice.reasoningEffort}" for ${where} is not a Codex model_reasoning_effort (${CODEX_REASONING_EFFORTS.join(", ")})`,
    );
  }
  return choice;
}

/**
 * A TOML basic string (https://toml.io/en/v1.0.0#string): `"` and `\`
 * escaped, every control character other than tab escaped (`\n` and `\r`
 * by name, the rest as `\uXXXX`, DEL included), tab and the rest of Unicode
 * raw. The two Unicode line separators are escaped as well: the spec allows
 * them raw, but Bun's parser — the one that validates the generated text
 * here — reads them as line ends. Not `JSON.stringify`, whose `\t` the same
 * parser decodes as a form feed; a raw tab is what the spec asks for anyway.
 */
export function tomlString(value: string): string {
  let out = '"';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += char;
    else if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) {
      out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    } else out += char;
  }
  return `${out}"`;
}

export interface CodexAgentInput {
  readonly definition: AgentDefinition;
  readonly model: CodexModelChoice;
  /** Absolute path of the source `agents/<name>.md`, for the header comment. */
  readonly sourcePath: string;
}

/** The trailing sentence that carries `tools:` into a format that has no such field. */
export function toolsSentence(tools: readonly string[]): string {
  return tools.length === 0
    ? ""
    : `The source definition limits this agent to these tools: ${tools.join(", ")}. Codex has no per-agent tool list, so honour it as an instruction.`;
}

/**
 * The whole `<name>.toml`. Required keys first, `model` and
 * `model_reasoning_effort` only when mapped, instructions last.
 */
export function renderCodexAgent(input: CodexAgentInput): string {
  const { definition, model } = input;
  const sentence = toolsSentence(definition.tools);
  const instructions = sentence === "" ? definition.body : `${definition.body}\n\n${sentence}`;
  const lines = [
    `# generated by jig apply --target codex from ${input.sourcePath} — edit the source, not this file`,
    "# format: https://learn.chatgpt.com/docs/agent-configuration/subagents",
    `name = ${tomlString(definition.name)}`,
    `description = ${tomlString(definition.description)}`,
    ...(model.kind === "mapped" ? [`model = ${tomlString(model.model)}`] : []),
    ...(model.kind === "mapped" && model.reasoningEffort !== undefined
      ? [`model_reasoning_effort = ${tomlString(model.reasoningEffort)}`]
      : []),
    `developer_instructions = ${tomlString(instructions)}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** `research.md` → `research.toml`; the file name, not the frontmatter `name`, keys the destination. */
export function codexAgentFileName(sourceFile: string): string {
  return `${sourceFile.replace(/\.md$/, "")}.toml`;
}
