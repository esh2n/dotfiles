/**
 * The `mcpServers` JSON file two harnesses read — omp's `~/.omp/agent/mcp.json`
 * and, for pi, pi-mcp-adapter's `~/.config/mcp/mcp.json` — as one pure
 * transform over a file jig does not own whole. The file shape is the same in
 * both (a top-level `mcpServers` map of server name → server config, beside
 * other top-level keys the harness or extension defines), so the ownership
 * rule is written once here and each harness's module supplies only its
 * entries and its optional `$schema` line.
 *
 * Ownership is per entry, not per file. jig owns the entries of `mcpServers`
 * whose names the source produces; every other entry — a server added by hand
 * or by the harness's own `/mcp add` — and every other top-level key is
 * carried through byte-for-byte in value and reported. Hand-edit detection
 * compares jig's entries alone (`block` against `currentBlock`), not the
 * file, because the harness writes into this file itself and a whole-file
 * hash would call every one of those writes a conflict.
 */

import type { Json, JsonObject } from "../compose/merge";

/** One server's entry, ready to place under `mcpServers`. */
export interface McpJsonEntry {
  readonly name: string;
  readonly entry: JsonObject;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text hand-edit detection hashes: jig's entries alone, in source order. */
export function renderMcpJsonBlock(entries: readonly McpJsonEntry[]): string {
  const block: Record<string, Json> = {};
  for (const { name, entry } of entries) block[name] = entry;
  return `${JSON.stringify(block, null, 2)}\n`;
}

export interface McpJsonPlan {
  /** The file as it should read afterwards. */
  readonly text: string;
  /** jig's entries as generated (`renderMcpJsonBlock`). */
  readonly block: string;
  /** jig's entries as they stand in the file today; absent when none of them is there. */
  readonly currentBlock: string | undefined;
  /** `mcpServers` entries no source produces: carried through, named. */
  readonly foreign: readonly string[];
  /** Top-level keys other than `mcpServers`: carried through, named. */
  readonly carried: readonly string[];
  /** Set when the file could not be read as an object: nothing can be carried through, so nothing is written. */
  readonly invalid?: string;
}

export interface McpJsonOptions {
  /**
   * A `$schema` URL to add when the file has none (omp writes one into files
   * it manages). Absent: no `$schema` is added, and one already there is
   * carried through like any other key.
   */
  readonly schema?: string;
}

/**
 * Upsert jig's entries. Managed entries come first in source order (so a
 * server dropped from the source leaves nothing behind and one renamed
 * moves), then every foreign entry in the order the file had them. Every
 * other top-level key keeps its value.
 */
export function planMcpJson(
  current: string | undefined,
  entries: readonly McpJsonEntry[],
  options: McpJsonOptions = {},
): McpJsonPlan {
  const block = renderMcpJsonBlock(entries);
  const managed = new Set(entries.map((entry) => entry.name));

  let parsed: Record<string, unknown> = {};
  if (current !== undefined && current.trim() !== "") {
    let value: unknown;
    try {
      value = JSON.parse(current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        text: current,
        block,
        currentBlock: undefined,
        foreign: [],
        carried: [],
        invalid: message,
      };
    }
    if (!isObject(value)) {
      return {
        text: current,
        block,
        currentBlock: undefined,
        foreign: [],
        carried: [],
        invalid: "the top level is not a JSON object",
      };
    }
    parsed = value;
  }

  const servers = isObject(parsed.mcpServers) ? parsed.mcpServers : {};
  const present: McpJsonEntry[] = [];
  const foreign: [string, unknown][] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (managed.has(name)) present.push({ name, entry: entry as JsonObject });
    else foreign.push([name, entry]);
  }
  // In source order, so a reordering by hand is not a change and the
  // comparison is entry against entry.
  const currentBlock =
    present.length === 0
      ? undefined
      : renderMcpJsonBlock(
          entries.flatMap((entry) => present.filter((found) => found.name === entry.name)),
        );

  const mcpServers: Record<string, unknown> = {};
  for (const { name, entry } of entries) mcpServers[name] = entry;
  for (const [name, entry] of foreign) mcpServers[name] = entry;

  const schema = parsed.$schema ?? options.schema;
  const out: Record<string, unknown> = {
    ...(schema === undefined ? {} : { $schema: schema }),
    mcpServers,
  };
  const carried: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "mcpServers" || key === "$schema") continue;
    out[key] = value;
    carried.push(key);
  }
  if (parsed.$schema !== undefined) carried.unshift("$schema");

  return {
    text: `${JSON.stringify(out, null, 2)}\n`,
    block,
    currentBlock,
    foreign: foreign.map(([name]) => name),
    carried,
  };
}
