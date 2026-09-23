/**
 * The source format of `agents/*.md`: a Claude Code subagent — YAML
 * frontmatter with `name`, `description`, `tools` and `model`, then the
 * system prompt as the body. Every harness target translates from this one
 * shape (`../codex/agents.ts` into TOML, `../omp/agents.ts` into omp's own
 * frontmatter), so the parser and the model question live here, once.
 * The fields are documented for authors in `agents/README.md`.
 *
 * `model:` is a Claude tier name (`haiku`/`sonnet`/`opus`) or `inherit`. No
 * other harness knows those names; each target looks the tier up in the
 * table `agents/models.json` supplies for it (`./agent-models.ts`) and leaves
 * `model` out when the table does not know it, reporting the gap. An agent
 * may override that lookup for one target with a `models:` block —
 * `models: { codex: { model, reasoningEffort } }` — which wins over the tier
 * whether or not `model:` is set. The generator never invents a model id.
 *
 * Pure: text in, a record out. A malformed `models:` block is an error
 * naming the key, not a silently dropped override.
 */

/** What a target gets for one agent: its own model id, and optionally how hard to think. */
export interface ModelMapping {
  readonly model: string;
  /** Codex: `model_reasoning_effort`. omp ignores it (the selector carries the effort). */
  readonly reasoningEffort?: string;
}

export interface AgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  /** The `model:` value as written, trimmed; absent when the frontmatter has none. */
  readonly model?: string;
  /** Per-target overrides from the `models:` block, keyed by target (`codex`, `omp`); absent when there is no block. */
  readonly models?: Readonly<Record<string, ModelMapping>>;
  /** The prompt, frontmatter removed, surrounding blank lines trimmed. */
  readonly body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * The fields, read off the frontmatter as text. A scalar may be bare or
 * quoted; `tools` may be a flow list (`["Read", "Grep"]`), a comma-separated
 * scalar, or a block list; `models` may be a block mapping or a flow mapping.
 * Nothing else in the frontmatter is looked at.
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
  const models = parseModels(lines, fileStem);
  return {
    name: scalar("name") ?? fileStem,
    description: scalar("description") ?? "",
    tools: parseTools(lines),
    ...(model === undefined ? {} : { model }),
    ...(models === undefined ? {} : { models }),
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

/** A two-level mapping as text: target → field → scalar. What both forms of `models:` parse to before validation. */
type NestedScalars = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * The `models:` block, either form, validated into one `ModelMapping` per
 * target. `undefined` when the frontmatter has no such key.
 */
function parseModels(
  lines: readonly string[],
  fileStem: string,
): Readonly<Record<string, ModelMapping>> | undefined {
  const at = lines.findIndex((line) => line.startsWith("models:"));
  if (at === -1) return undefined;
  const label = `${fileStem}.md: models`;
  const raw = (lines[at] ?? "").slice("models:".length).trim();
  const nested = raw === "" ? parseBlockMapping(lines, at, label) : parseFlowMapping(raw, label);

  const models: Record<string, ModelMapping> = {};
  for (const [target, fields] of Object.entries(nested)) {
    const entryLabel = `${label}.${target}`;
    const { model, reasoningEffort, ...rest } = fields;
    if (model === undefined || model === "") {
      throw new Error(`${entryLabel}: "model" must be a non-empty string`);
    }
    for (const key of Object.keys(rest)) {
      throw new Error(`${entryLabel}: unknown key "${key}" (expected model, reasoningEffort)`);
    }
    if (reasoningEffort === "") {
      throw new Error(`${entryLabel}: "reasoningEffort" must be a non-empty string when present`);
    }
    models[target] = {
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    };
  }
  return Object.keys(models).length === 0 ? undefined : models;
}

/**
 * Block form: the lines after `models:` indented past it, targets at one
 * indent and their fields deeper. Blank lines are skipped; the block ends at
 * the first line back at column 0.
 */
function parseBlockMapping(lines: readonly string[], at: number, label: string): NestedScalars {
  const out: Record<string, Record<string, string>> = {};
  let target: string | undefined;
  let targetIndent: number | undefined;
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break;
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (pair === null) throw new Error(`${label}: cannot read line ${JSON.stringify(line)}`);
    const key = pair[1] ?? "";
    const value = pair[2] ?? "";
    if (targetIndent === undefined) targetIndent = indent;
    if (indent === targetIndent) {
      if (value !== "") throw new Error(`${label}.${key}: expected a mapping, not a scalar`);
      target = key;
      out[key] = {};
    } else if (indent > targetIndent && target !== undefined) {
      const fields = out[target];
      if (fields !== undefined) fields[key] = unquote(value);
    } else {
      throw new Error(`${label}: unexpected indentation at ${JSON.stringify(line)}`);
    }
  }
  return out;
}

/**
 * Flow form: `{ codex: { model: "gpt-6-sol", reasoningEffort: "medium" } }`.
 * A small reader for exactly that shape — braces, commas, colons, bare or
 * quoted scalars — which is what a YAML flow mapping of two levels needs.
 */
function parseFlowMapping(text: string, label: string): NestedScalars {
  let pos = 0;
  const fail = (what: string): never => {
    throw new Error(`${label}: ${what} at offset ${pos} of ${JSON.stringify(text)}`);
  };
  const skipSpace = () => {
    while (pos < text.length && /\s/.test(text[pos] ?? "")) pos++;
  };
  const readScalar = (): string => {
    skipSpace();
    const quote = text[pos];
    if (quote === '"' || quote === "'") {
      const end = text.indexOf(quote, pos + 1);
      if (end === -1) fail("unterminated string");
      const value = text.slice(pos + 1, end);
      pos = end + 1;
      return value;
    }
    const start = pos;
    while (pos < text.length && !/[,:{}]/.test(text[pos] ?? "")) pos++;
    return text.slice(start, pos).trim();
  };
  const readMapping = (): Record<string, string | Record<string, string>> => {
    skipSpace();
    if (text[pos] !== "{") fail("expected {");
    pos++;
    const out: Record<string, string | Record<string, string>> = {};
    skipSpace();
    while (text[pos] !== "}") {
      const key = readScalar();
      if (key === "") fail("expected a key");
      skipSpace();
      if (text[pos] !== ":") fail("expected :");
      pos++;
      skipSpace();
      out[key] = text[pos] === "{" ? readLeaf() : readScalar();
      skipSpace();
      if (text[pos] === ",") {
        pos++;
        skipSpace();
      } else if (text[pos] !== "}") fail("expected , or }");
    }
    pos++;
    return out;
  };
  const readLeaf = (): Record<string, string> => {
    const leaf: Record<string, string> = {};
    for (const [key, value] of Object.entries(readMapping())) {
      if (typeof value !== "string") fail(`"${key}" nests too deep`);
      else leaf[key] = value;
    }
    return leaf;
  };

  const out: Record<string, Record<string, string>> = {};
  for (const [target, fields] of Object.entries(readMapping())) {
    if (typeof fields === "string") {
      throw new Error(`${label}.${target}: expected a mapping, not a scalar`);
    }
    out[target] = fields;
  }
  skipSpace();
  if (pos < text.length) fail("trailing text");
  return out;
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted?.[2] ?? value;
}

/**
 * The `model` a target's agent gets, or why it gets none. `inherit` is
 * Claude Code's "the caller's model" and has no form elsewhere either, but
 * it is not a gap: leaving `model` out is exactly what it means. A mapped
 * answer says where it came from: the tier table, or the agent's own
 * `models:` override (`override: true`, with the tier beside it when the
 * agent names one).
 */
export type ModelChoice =
  | {
      readonly kind: "mapped";
      readonly tier?: string;
      readonly model: string;
      readonly reasoningEffort?: string;
      readonly override?: true;
    }
  | { readonly kind: "inherit" }
  | { readonly kind: "unmapped"; readonly tier: string };

/**
 * @param tier the agent's `model:` as written, or nothing
 * @param map the target's table from `agents/models.json`, keyed by lower-cased tier
 * @param override the agent's `models.<target>` entry, which wins when present
 */
export function modelChoiceFor(
  tier: string | undefined,
  map: Readonly<Record<string, ModelMapping>>,
  override?: ModelMapping,
): ModelChoice {
  const named = tier === undefined || tier === "inherit" ? undefined : tier;
  if (override !== undefined) {
    return {
      kind: "mapped",
      ...(named === undefined ? {} : { tier: named }),
      model: override.model,
      ...(override.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: override.reasoningEffort }),
      override: true,
    };
  }
  if (named === undefined) return { kind: "inherit" };
  const mapping = map[named.toLowerCase()];
  if (mapping === undefined) return { kind: "unmapped", tier: named };
  return {
    kind: "mapped",
    tier: named,
    model: mapping.model,
    ...(mapping.reasoningEffort === undefined ? {} : { reasoningEffort: mapping.reasoningEffort }),
  };
}
