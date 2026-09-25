/**
 * Claude Code's user-scope MCP servers, delivered into `~/.claude.json`
 * (rules/decisions/2026-09-25-jig-writes-claude-json-mcp.md).
 *
 * Claude Code reads user-scope MCP servers from the `mcpServers` key of
 * `~/.claude.json` (not from `~/.claude/settings.json`). The rest of that file
 * is Claude Code's own state, so this module changes that one key and
 * nothing else: every other key, and every server jig did not put there,
 * comes back exactly as read.
 *
 * Which servers are jig's is the list jig recorded on its last write (the
 * caller keeps it in the manifest). A server jig once wrote that
 * `mcp/servers.json` no longer has is removed; one jig never wrote is
 * reported and left alone, even under a name jig is about to use — that is
 * a conflict, not an overwrite.
 */

import type { ClaudeMcpAdd } from "../mcp/to-claude";

/** One `mcpServers` entry in Claude Code's own shape. */
export type ClaudeMcpEntry =
  | {
      readonly type: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
    }
  | {
      readonly type: "http" | "sse";
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    };

export function toClaudeEntry(add: ClaudeMcpAdd): ClaudeMcpEntry {
  if (add.transport === "stdio") {
    return { type: "stdio", command: add.command ?? "", args: add.args, env: add.env };
  }
  return { type: add.transport, url: add.url ?? "", headers: add.headers };
}

export interface ClaudeJsonMcpPlan {
  /** "write": the key changes; "noop": already current; "conflict": nothing is written. */
  readonly outcome: "write" | "noop" | "conflict";
  /** The whole file after the change (undefined unless outcome is "write"). */
  readonly content?: string;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  /** Servers in the file that are not jig's and not in the inventory: left alone. */
  readonly others: readonly string[];
  /** Why nothing is written, when outcome is "conflict". */
  readonly reason?: string;
  /** The names jig owns after this write, for the manifest. */
  readonly owned: readonly string[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Plans the `mcpServers` change. `current` is the file's text (undefined when
 * it does not exist yet); `owned` is the names jig wrote last time.
 */
export function planClaudeJsonMcp(
  current: string | undefined,
  servers: readonly ClaudeMcpAdd[],
  owned: readonly string[],
): ClaudeJsonMcpPlan {
  const empty = { added: [], changed: [], removed: [], others: [] };
  let doc: { [key: string]: Json } = {};
  if (current !== undefined && current.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(current);
    } catch (error) {
      return {
        ...empty,
        outcome: "conflict",
        owned,
        reason: `~/.claude.json is not valid JSON (${(error as Error).message})`,
      };
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ...empty,
        outcome: "conflict",
        owned,
        reason: "~/.claude.json is not a JSON object",
      };
    }
    doc = parsed as { [key: string]: Json };
  }
  const existing = doc.mcpServers;
  if (
    existing !== undefined &&
    (existing === null || typeof existing !== "object" || Array.isArray(existing))
  ) {
    return {
      ...empty,
      outcome: "conflict",
      owned,
      reason: "mcpServers in ~/.claude.json is not an object",
    };
  }
  const before = (existing ?? {}) as { [name: string]: Json };
  const wanted = new Map(servers.map((s) => [s.name, toClaudeEntry(s)]));
  const mine = new Set(owned);

  const clash = [...wanted.keys()].filter(
    (name) => name in before && !mine.has(name) && !same(before[name], wanted.get(name)),
  );
  if (clash.length > 0) {
    return {
      ...empty,
      outcome: "conflict",
      owned,
      reason: `~/.claude.json already has ${clash.join(", ")}, not written by jig; remove it (claude mcp remove --scope user <name>) or rename the server in mcp/servers.json`,
    };
  }

  const after: { [name: string]: Json } = {};
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  const others: string[] = [];
  for (const [name, entry] of Object.entries(before)) {
    if (wanted.has(name)) {
      const next = wanted.get(name) as unknown as Json;
      if (!same(entry, next)) changed.push(name);
      after[name] = next;
    } else if (mine.has(name)) {
      removed.push(name);
    } else {
      others.push(name);
      after[name] = entry;
    }
  }
  for (const [name, entry] of wanted) {
    if (!(name in before)) {
      added.push(name);
      after[name] = entry as unknown as Json;
    }
  }
  const nextOwned = [...wanted.keys()];
  const report = { added, changed, removed, others, owned: nextOwned };
  if (added.length + changed.length + removed.length === 0) {
    return { ...report, outcome: "noop" };
  }
  const content = `${JSON.stringify({ ...doc, mcpServers: after }, null, 2)}\n`;
  return { ...report, outcome: "write", content };
}
