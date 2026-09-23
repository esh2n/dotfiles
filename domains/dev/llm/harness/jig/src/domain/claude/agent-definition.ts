/**
 * The source format of `agents/*.md`: a Claude Code subagent — YAML
 * frontmatter with `name`, `description`, `tools` and `model`, then the
 * system prompt as the body. Every harness target translates from this one
 * shape (`../codex/agents.ts` into TOML, `../omp/agents.ts` into omp's own
 * frontmatter), so the parser and the model question live here, once.
 *
 * `model:` is a Claude tier name (`haiku`/`sonnet`/`opus`) or `inherit`. No
 * other harness knows those names; each target looks the tier up in a map
 * its composition root supplies and leaves `model` out when the map does not
 * know it, reporting the gap. The generator never invents a model id.
 *
 * Pure: text in, a record out.
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
 * The `model` a target's agent gets for a source tier, or why it gets none.
 * `inherit` is Claude Code's "the caller's model" and has no form elsewhere
 * either, but it is not a gap: leaving `model` out is exactly what it means.
 */
export type ModelChoice =
  | { readonly kind: "mapped"; readonly tier: string; readonly model: string }
  | { readonly kind: "inherit" }
  | { readonly kind: "unmapped"; readonly tier: string };

export function modelChoiceFor(
  tier: string | undefined,
  map: Readonly<Record<string, string>>,
): ModelChoice {
  if (tier === undefined || tier === "inherit") return { kind: "inherit" };
  const key = tier.toLowerCase();
  const model = map[key];
  return model === undefined ? { kind: "unmapped", tier } : { kind: "mapped", tier, model };
}
