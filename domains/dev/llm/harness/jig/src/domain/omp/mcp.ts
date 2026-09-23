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

import type { JsonObject } from "../compose/merge";
import { type TemplateVars, applyTemplate } from "../compose/template";
import {
  type McpJsonEntry,
  type McpJsonPlan,
  planMcpJson,
  renderMcpJsonBlock,
} from "../mcp/mcp-json";
import type { McpServer } from "../mcp/types";

/** The schema line omp itself writes into files it manages (docs/mcp-config.md, "Add a schema reference"). */
export const OMP_MCP_SCHEMA_URL =
  "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json";

/** One server's entry, ready to place under `mcpServers`. */
export type OmpMcpEntry = McpJsonEntry;

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

/** The text hand-edit detection hashes: jig's entries alone, in source order. */
export function renderOmpMcpBlock(entries: readonly OmpMcpEntry[]): string {
  return renderMcpJsonBlock(entries);
}

export type OmpMcpPlan = McpJsonPlan;

/**
 * Upsert jig's entries (`domain/mcp/mcp-json.ts`, the rule shared with the
 * pi target): managed entries first in source order, then every foreign
 * entry in the order the file had them, every other top-level key kept;
 * `$schema` is added when absent, with the URL omp writes itself.
 */
export function planOmpMcpJson(
  current: string | undefined,
  entries: readonly OmpMcpEntry[],
): OmpMcpPlan {
  return planMcpJson(current, entries, { schema: OMP_MCP_SCHEMA_URL });
}
