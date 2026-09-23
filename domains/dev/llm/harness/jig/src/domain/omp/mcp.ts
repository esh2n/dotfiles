/**
 * The MCP servers jig owns in `~/.omp/agent/mcp.json`, as pure transforms
 * over a file jig does not own whole.
 *
 * omp reads its user-level MCP servers from that file
 * (https://github.com/can1357/oh-my-pi/blob/main/docs/mcp-config.md,
 * "Preferred config locations": "User: `~/.omp/agent/mcp.json` (or
 * `~/.omp/profiles/<name>/agent/mcp.json` when a named profile is active)").
 * "File shape": top-level `$schema` (optional), `mcpServers` ("map of server
 * name to server config"), `disabledServers` and `enabledServers` (the
 * user-level denylist and allowlist). "Supported server fields": a `stdio`
 * server carries `command` (required), `args`, `env`, `cwd`, and `type` may
 * be omitted ("`stdio` is the default when `type` is omitted"); `http` and
 * `sse` require `type` and `url` and may carry `headers`. `${VAR}` in any of
 * those is expanded by omp at discovery time, so a reference is written
 * through as it stands in the source.
 *
 * Ownership is per entry, not per file. jig owns the entries of `mcpServers`
 * whose names are in `mcp/servers.json` with `targets.omp`; every other
 * entry — a server added by hand or by `/mcp add` — and every other
 * top-level key is carried through byte-for-byte in value and reported.
 * Hand-edit detection compares jig's entries, not the file: omp writes into
 * this file itself (`/mcp add`, and "`/mcp enable` and `/mcp disable` update
 * `enabled` directly when the definition is in an OMP-owned writable file"),
 * and a whole-file hash would call every one of those a conflict. A change
 * inside a jig-owned entry IS a conflict — the source has no `enabled`
 * field, so the setting would exist in two places, and reconciling that is
 * the one-time manual step of
 * `rules/decisions/2026-09-22-config-layout-no-personal-layer.md`; the
 * non-conflicting way to switch a jig server off is `disabledServers`,
 * which the same page calls "the highest-precedence denylist" and which jig
 * carries through.
 */

import type { Json, JsonObject } from "../compose/merge";
import { type TemplateVars, applyTemplate } from "../compose/template";
import type { McpServer } from "../mcp/types";

/** The schema line omp itself writes into files it manages (docs/mcp-config.md, "Add a schema reference"). */
export const OMP_MCP_SCHEMA_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";

/** One server's entry, ready to place under `mcpServers`. */
export interface OmpMcpEntry {
  readonly name: string;
  readonly entry: JsonObject;
}

function applyOmpOverride(server: McpServer): McpServer {
  const override = server.targetOverrides?.omp;
  return override ? { ...server, ...override } : server;
}

/** The key/value pairs one entry carries, in the order they are written. `type` is always explicit. */
function entryFields(server: McpServer): JsonObject {
  const nonEmpty = (record: Readonly<Record<string, string>> | undefined) =>
    record && Object.keys(record).length > 0 ? { ...record } : undefined;
  if (server.transport !== "stdio") {
    const headers = nonEmpty(server.headers);
    return {
      type: server.transport,
      ...(server.url === undefined ? {} : { url: server.url }),
      ...(headers === undefined ? {} : { headers }),
    };
  }
  const env = nonEmpty(server.env);
  const args = server.args ?? [];
  return {
    type: "stdio",
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(args.length === 0 ? {} : { args: [...args] }),
    ...(env === undefined ? {} : { env }),
  };
}

/**
 * One entry per server with `targets.omp: true`, the omp override applied
 * and `{{HOME}}` substituted. Order is the source's.
 */
export function buildOmpMcpServers(
  servers: readonly McpServer[],
  vars: TemplateVars,
): readonly OmpMcpEntry[] {
  const out: OmpMcpEntry[] = [];
  for (const server of servers) {
    if (server.targets?.omp !== true) continue;
    const effective = applyOmpOverride(server);
    out.push({
      name: effective.name,
      entry: applyTemplate(entryFields(effective), vars) as JsonObject,
    });
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The text hand-edit detection hashes: jig's entries alone, in source order. */
export function renderOmpMcpBlock(entries: readonly OmpMcpEntry[]): string {
  const block: Record<string, Json> = {};
  for (const { name, entry } of entries) block[name] = entry;
  return `${JSON.stringify(block, null, 2)}\n`;
}

export interface OmpMcpPlan {
  /** mcp.json as it should read afterwards. */
  readonly text: string;
  /** jig's entries as generated (`renderOmpMcpBlock`). */
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

/**
 * Upsert jig's entries. Managed entries come first in source order (so a
 * server dropped from the source leaves nothing behind and one renamed
 * moves), then every foreign entry in the order the file had them. Every
 * other top-level key keeps its value; `$schema` is added when absent, with
 * the URL omp writes itself.
 */
export function planOmpMcpJson(
  current: string | undefined,
  entries: readonly OmpMcpEntry[],
): OmpMcpPlan {
  const block = renderOmpMcpBlock(entries);
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
  const present: OmpMcpEntry[] = [];
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
      : renderOmpMcpBlock(
          entries.flatMap((entry) => present.filter((found) => found.name === entry.name)),
        );

  const mcpServers: Record<string, unknown> = {};
  for (const { name, entry } of entries) mcpServers[name] = entry;
  for (const [name, entry] of foreign) mcpServers[name] = entry;

  const out: Record<string, unknown> = {
    $schema: parsed.$schema ?? OMP_MCP_SCHEMA_URL,
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
