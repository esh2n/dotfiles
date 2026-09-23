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
 *   Codex. It is looked up in a map the caller supplies; a tier the map does
 *   not know is left out, so Codex applies its own default, and reported.
 *   The generator never invents a Codex model id.
 *
 * Pure: text in, text out. The caller reads the file and validates the
 * result as TOML if it wants to.
 */

export interface AgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  /** The `model:` value as written, trimmed; absent when the frontmatter has none. */
  readonly model?: string;
  /** The prompt, frontmatter removed, surrounding blank lines trimmed. */
  readonly body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * The four fields, read off the frontmatter as text. A scalar may be bare or
 * quoted; `tools` may be a flow list (`["Read", "Grep"]`), a comma-separated
 * scalar, or a block list. Nothing else in the frontmatter is looked at.
 */
export function parseAgentDefinition(text: string, fileStem: string): AgentDefinition {
  const match = FRONTMATTER_RE.exec(text);
  const front = match?.[1] ?? "";
  const body = (match === null ? text : text.slice(match[0].length)).replace(/^\n+|\n+$/g, "");
  const lines = front.split(/\r?\n/);

  const scalar = (key: string): string | undefined => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}:`));
    if (line === undefined) return undefined;
    const raw = line.slice(key.length + 1).trim();
    return raw === "" ? undefined : unquote(raw);
  };

  const model = scalar("model");
  return {
    name: scalar("name") ?? fileStem,
    description: scalar("description") ?? "",
    tools: parseTools(lines),
    ...(model === undefined ? {} : { model }),
    body,
  };
}

function parseTools(lines: readonly string[]): readonly string[] {
  const at = lines.findIndex((line) => line.startsWith("tools:"));
  if (at === -1) return [];
  const raw = (lines[at] ?? "").slice("tools:".length).trim();
  if (raw !== "") {
    const flow = /^\[(.*)\]$/.exec(raw)?.[1];
    return (flow ?? raw)
      .split(",")
      .map((tool) => unquote(tool.trim()))
      .filter((tool) => tool !== "");
  }
  const items: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s*(.+?)\s*$/.exec(line)?.[1];
    if (item === undefined) break;
    items.push(unquote(item));
  }
  return items;
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/**
 * The `model` a Codex agent gets for a source tier, or why it gets none.
 * `inherit` is Claude Code's "the caller's model" and has no Codex form
 * either, but it is not a gap: leaving `model` out is exactly what it means.
 */
export type CodexModelChoice =
  | { readonly kind: "mapped"; readonly tier: string; readonly model: string }
  | { readonly kind: "inherit" }
  | { readonly kind: "unmapped"; readonly tier: string };

export function codexModelFor(
  tier: string | undefined,
  map: Readonly<Record<string, string>>,
): CodexModelChoice {
  if (tier === undefined || tier === "inherit") return { kind: "inherit" };
  const key = tier.toLowerCase();
  const model = map[key];
  return model === undefined ? { kind: "unmapped", tier } : { kind: "mapped", tier, model };
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

/** The whole `<name>.toml`. Required keys first, `model` only when mapped, instructions last. */
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
    `developer_instructions = ${tomlString(instructions)}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** `research.md` → `research.toml`; the file name, not the frontmatter `name`, keys the destination. */
export function codexAgentFileName(sourceFile: string): string {
  return `${sourceFile.replace(/\.md$/, "")}.toml`;
}
