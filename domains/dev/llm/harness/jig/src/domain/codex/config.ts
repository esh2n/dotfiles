/**
 * The MCP servers jig owns in `~/.codex/config.toml`, as pure text
 * transforms over a file jig does not own.
 *
 * Codex reads its MCP servers from `[mcp_servers.<id>]` tables
 * (https://learn.chatgpt.com/docs/config-file/config-reference, "MCP servers"):
 * a stdio server carries `command`, `args` ("Arguments passed to the MCP
 * stdio server command.") and `env` ("Environment variables forwarded to the
 * MCP stdio server."); a streamable HTTP server carries `url`. The optional
 * keys the page lists (`enabled`, `startup_timeout_sec`, `tool_timeout_sec`,
 * `enabled_tools`, `disabled_tools`) have no counterpart in
 * `mcp/servers.json` and are not written.
 *
 * The tables go inside one managed block, `# jig:begin mcp` … `# jig:end mcp`,
 * beside the `# jig:begin hooks` block `jig codex register` keeps for its
 * trust entries (`./register.ts`). Each block holds only complete tables, so
 * appending either after any other table is valid TOML, and each command
 * rewrites its own block and no other. Every other table in the file —
 * `[projects.*]` that Codex itself writes when a directory is trusted,
 * `[features]`, `[sandbox_workspace_write]`, whatever yoki left — is carried
 * through byte for byte.
 *
 * Codex loads nothing when a table is declared twice, so a `[mcp_servers.x]`
 * outside jig's block for a server jig also writes is a conflict the
 * generator names and refuses to write over, not something it merges: per
 * `rules/decisions/2026-09-22-config-layout-no-personal-layer.md` the
 * reconciliation of a setting that exists in two places is a one-time manual
 * step, exactly as with `~/.claude.json`.
 */

import type { Json, JsonObject } from "../compose/merge";
import { type TemplateVars, applyTemplate } from "../compose/template";
import type { McpServer } from "../mcp/types";
import { tomlString } from "./agents";
import { removeMarkedBlock } from "./register";

export const MCP_BLOCK_BEGIN = "# jig:begin mcp";
export const MCP_BLOCK_END = "# jig:end mcp";

/** One server's table, ready to print. */
export interface CodexMcpTable {
  readonly name: string;
  readonly text: string;
}

function applyCodexOverride(server: McpServer): McpServer {
  const override = server.targetOverrides?.codex;
  return override ? { ...server, ...override } : server;
}

/** The key/value pairs one server's table carries, in the order they are written. */
function tableFields(server: McpServer): JsonObject {
  const env = server.env && Object.keys(server.env).length > 0 ? { ...server.env } : undefined;
  if (server.transport === "http") {
    return {
      ...(server.url === undefined ? {} : { url: server.url }),
      ...(env === undefined ? {} : { env }),
    };
  }
  return {
    ...(server.command === undefined ? {} : { command: server.command }),
    args: [...(server.args ?? [])],
    ...(env === undefined ? {} : { env }),
  };
}

/** A bare key where TOML allows one (`A-Za-z0-9_-`), a quoted key otherwise. */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

function tomlValue(value: Json): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (value === null) throw new Error("config.toml: TOML has no null");
  const pairs = Object.entries(value).map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`);
  return `{ ${pairs.join(", ")} }`;
}

/**
 * `[mcp_servers.<name>]` for every server with `targets.codex: true`, the
 * codex override applied and `{{HOME}}` substituted. Order is the source's.
 */
export function buildCodexMcpTables(
  servers: readonly McpServer[],
  vars: TemplateVars,
): readonly CodexMcpTable[] {
  const tables: CodexMcpTable[] = [];
  for (const server of servers) {
    if (server.targets?.codex !== true) continue;
    const effective = applyCodexOverride(server);
    const fields = applyTemplate(tableFields(effective), vars) as JsonObject;
    const lines = [`[mcp_servers.${tomlKey(effective.name)}]`];
    for (const [key, value] of Object.entries(fields)) {
      lines.push(`${key} = ${tomlValue(value)}`);
    }
    tables.push({ name: effective.name, text: `${lines.join("\n")}\n` });
  }
  return tables;
}

/** The managed block, markers included. Empty tables still produce a block, so the markers seed the file. */
export function renderMcpBlock(tables: readonly CodexMcpTable[]): string {
  return `${MCP_BLOCK_BEGIN}\n${tables.map((table) => table.text).join("\n")}${MCP_BLOCK_END}\n`;
}

export interface McpBlockPlan {
  /** config.toml as it should read afterwards. */
  readonly configToml: string;
  readonly changed: boolean;
  /** The block as it stands in the file today, markers included; absent when there is none. */
  readonly currentBlock: string | undefined;
}

/**
 * Upsert the block at the end of the file. A previous block is removed
 * wholesale first, so a server dropped from the source leaves no table
 * behind. Hand-edit detection compares blocks, not files: Codex writes
 * `[projects.*]` into this file on its own, and a whole-file hash would call
 * every trusted directory a conflict.
 */
export function planMcpBlock(existing: string | undefined, block: string): McpBlockPlan {
  const before = existing ?? "";
  const stripped = removeMarkedBlock(before, MCP_BLOCK_BEGIN, MCP_BLOCK_END).replace(/\s+$/, "");
  const configToml = stripped === "" ? block : `${stripped}\n\n${block}`;
  return { configToml, changed: configToml !== before, currentBlock: currentMcpBlock(before) };
}

/** The block as written today, markers included, or nothing. */
export function currentMcpBlock(configToml: string): string | undefined {
  const begin = configToml.indexOf(MCP_BLOCK_BEGIN);
  if (begin === -1) return undefined;
  const endAt = configToml.indexOf(MCP_BLOCK_END, begin);
  if (endAt === -1) return undefined;
  return configToml.slice(begin, endAt + MCP_BLOCK_END.length + 1);
}

const MCP_TABLE_HEADER_RE =
  /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*[.\]]/;

/** A `[mcp_servers.<name>]` (or a sub-table of it) outside the block, with the line it is on (1-based). */
export interface ForeignMcpTable {
  readonly name: string;
  readonly line: number;
}

/**
 * Servers jig would write that are already declared somewhere else in the
 * file — in yoki's block, or by hand. Each is a conflict: a duplicate table
 * stops Codex from loading its configuration at all.
 */
export function mcpServersDeclaredOutside(
  configToml: string,
  names: readonly string[],
): readonly ForeignMcpTable[] {
  const wanted = new Set(names);
  const seen = new Set<string>();
  const found: ForeignMcpTable[] = [];
  const lines = configToml.split("\n");
  const block = blockLineRange(lines);
  lines.forEach((text, index) => {
    if (block !== undefined && index >= block.first && index <= block.last) return;
    const match = MCP_TABLE_HEADER_RE.exec(text);
    const name = match?.[1] ?? match?.[2] ?? match?.[3];
    if (name === undefined || !wanted.has(name) || seen.has(name)) return;
    seen.add(name);
    found.push({ name, line: index + 1 });
  });
  return found;
}

/** The 0-based line span of jig's MCP block, markers included; nothing when the file has none. */
function blockLineRange(
  lines: readonly string[],
): { readonly first: number; readonly last: number } | undefined {
  const first = lines.findIndex((line) => line.startsWith(MCP_BLOCK_BEGIN));
  if (first === -1) return undefined;
  const rest = lines.slice(first).findIndex((line) => line.startsWith(MCP_BLOCK_END));
  return { first, last: rest === -1 ? lines.length - 1 : first + rest };
}

const YOKI_BLOCK_BEGIN = "# yoki:begin";
const YOKI_BLOCK_END = "# yoki:end";

/**
 * What the retiring generator left in the file, named for milestone 4. The
 * generator reports these and touches none of them: its block is its own,
 * and the file's other tables are carried through whoever wrote them.
 */
export function yokiLeftovers(configToml: string): readonly string[] {
  const found: string[] = [];
  const begin = configToml.indexOf(YOKI_BLOCK_BEGIN);
  if (begin !== -1) {
    const end = configToml.indexOf(YOKI_BLOCK_END, begin);
    // The slice stops at the end marker's first character, so the split's last
    // element is the (empty) start of the marker's own line: the count is exact.
    const lineCount = end === -1 ? undefined : configToml.slice(begin, end).split("\n").length;
    found.push(
      `${YOKI_BLOCK_BEGIN} … ${YOKI_BLOCK_END} block${lineCount === undefined ? " (unterminated)" : ` (${lineCount} lines)`}`,
    );
  }
  for (const table of ["[permissions.yoki]", "[permissions.yoki.filesystem]"]) {
    if (configToml.includes(table)) found.push(table);
  }
  return found;
}
