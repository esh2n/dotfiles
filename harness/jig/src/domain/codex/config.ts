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
 * jig finds its tables by name, not by position: Codex regroups the file's
 * tables whenever it writes it (`./toml-sections.ts`), so the
 * `# jig:begin mcp` … `# jig:end mcp` markers jig writes are a courtesy to a
 * reader and are never relied on. Each run removes every table it owns,
 * wherever it stands, and appends them again at the end. Every other table in the file —
 * `[projects.*]` that Codex itself writes when a directory is trusted,
 * `[features]`, `[sandbox_workspace_write]`, whatever yoki left — is carried
 * through byte for byte.
 *
 * Codex loads nothing when a table is declared twice, so a server jig writes
 * is jig's in every place it appears. A hand edit to one of them shows as a
 * changed canonical block (`currentMcpBlock`) and stops the write as a
 * conflict, as with every file jig owns part of.
 */

import type { Json, JsonObject } from "../compose/merge";
import { type TemplateVars, applyTemplate } from "../compose/template";
import type { McpServer } from "../mcp/types";
import { tomlString } from "./agents";
import {
  type Section,
  hasKeys,
  joinSections,
  parseSections,
  sectionText,
  tidy,
  under,
  withoutLines,
} from "./toml-sections";

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
  if (server.transport !== "stdio") {
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

/**
 * Codex's status line: its built-in items only (`[tui].status_line`, codex-rs
 * bottom_pane/status_line_setup.rs, rust-v0.155.1 — Codex runs no script,
 * issue #17827), chosen to match what Claude Code's statusline.sh shows:
 * model and effort, directory, branch, context used, tokens. Codex has no
 * session-duration item, and its cost item is for Enterprise workspaces only
 * (rules/knowledge/statusline-across-harnesses.md).
 */
export const CODEX_STATUS_LINE = [
  "model-with-reasoning",
  "current-dir",
  "git-branch",
  "context-used",
  "used-tokens",
] as const;

function tuiTable(): string {
  return `[tui]\nstatus_line = [${CODEX_STATUS_LINE.map((item) => `"${item}"`).join(", ")}]\n`;
}

/**
 * The canonical form of what jig owns in the file: its MCP tables, then the
 * status line as a `[tui]` table, between the markers. This is what the
 * manifest hashes and what a clean file carries at its end. When the file
 * already has a `[tui]` table (Codex writes `[tui.*]` keys of its own), the
 * status line goes into that table instead, and the canonical form is
 * rebuilt from the file by `currentMcpBlock` for the hand-edit check.
 */
export function renderMcpBlock(tables: readonly CodexMcpTable[]): string {
  const body = [...tables.map((table) => table.text), tuiTable()].join("\n");
  return `${MCP_BLOCK_BEGIN}\n${body}${MCP_BLOCK_END}\n`;
}

export interface McpBlockPlan {
  /** config.toml as it should read afterwards. */
  readonly configToml: string;
  readonly changed: boolean;
  /** What jig owns in the file today, in canonical form; absent when the file has none of it. */
  readonly currentBlock: string | undefined;
}

const STATUS_LINE_RE = /^\s*status_line\s*=/;

function isTui(section: Section): boolean {
  return section.path?.length === 1 && section.path[0] === "tui";
}

function isOwnedServer(section: Section, names: ReadonlySet<string>): boolean {
  return under(section.path, ["mcp_servers"]) && names.has(section.path?.[1] ?? "");
}

function statusLine(): string {
  return `status_line = [${CODEX_STATUS_LINE.map((item) => `"${item}"`).join(", ")}]`;
}

/**
 * Rewrite what jig owns, wherever Codex has moved it: every
 * `[mcp_servers.<name>]` (and its sub-tables) for a name jig writes now or
 * wrote last time goes, the markers go, and `status_line` leaves any `[tui]`
 * table. Then the tables are appended at the end between the markers, and
 * the status line is put back into the file's own `[tui]` when it has one,
 * or appended as a `[tui]` table when it does not. Every other line of the
 * file is carried through.
 */
export function planMcpBlock(
  existing: string | undefined,
  tables: readonly CodexMcpTable[],
  previousNames: readonly string[] = [],
): McpBlockPlan {
  const before = existing ?? "";
  const owned = new Set([...tables.map((table) => table.name), ...previousNames]);
  const kept = parseSections(withoutLines(before, [MCP_BLOCK_BEGIN, MCP_BLOCK_END]))
    .filter((section) => !isOwnedServer(section, owned))
    .map((section) =>
      isTui(section)
        ? { ...section, lines: section.lines.filter((line) => !STATUS_LINE_RE.test(line)) }
        : section,
    )
    // a [tui] left with no key was jig's own (status_line only): it goes with the block
    .filter((section) => !isTui(section) || hasKeys(section));
  const hasTui = kept.some(isTui);
  const placed = kept.map((section) =>
    isTui(section)
      ? {
          ...section,
          lines: [section.lines[0] ?? "[tui]", statusLine(), ...section.lines.slice(1)],
        }
      : section,
  );
  const stripped = tidy(joinSections(placed));
  const body = [...tables.map((table) => table.text), ...(hasTui ? [] : [tuiTable()])].join("\n");
  const block = `${MCP_BLOCK_BEGIN}\n${body}${MCP_BLOCK_END}\n`;
  const configToml = stripped === "" ? block : `${stripped}\n\n${block}`;
  return {
    configToml,
    changed: configToml !== before,
    currentBlock: currentMcpBlock(before, [...owned]),
  };
}

function withoutMarkers(section: Section): Section {
  const markers = new Set([MCP_BLOCK_BEGIN, MCP_BLOCK_END, "# jig:begin hooks", "# jig:end hooks"]);
  return { ...section, lines: section.lines.filter((line) => !markers.has(line.trim())) };
}

/**
 * What jig owns in the file, rebuilt in the canonical form `renderMcpBlock`
 * produces: the owned servers' tables in the order `names` gives, then the
 * status line. Nothing when the file holds none of it. A file jig wrote and
 * nobody touched yields exactly the block jig rendered, wherever Codex has
 * since moved the pieces.
 */
export function currentMcpBlock(configToml: string, names: readonly string[]): string | undefined {
  const sections = parseSections(configToml);
  const tables = names.flatMap((name) => {
    const own = sections.filter((section) => under(section.path, ["mcp_servers", name]));
    return own.length === 0
      ? []
      : [own.map((section) => sectionText(withoutMarkers(section))).join("")];
  });
  const status = sections
    .filter(isTui)
    .flatMap((section) => section.lines.filter((line) => STATUS_LINE_RE.test(line)))[0];
  if (tables.length === 0 && status === undefined) return undefined;
  const tui = status === undefined ? [] : [`[tui]\n${status.trim()}\n`];
  return `${MCP_BLOCK_BEGIN}\n${[...tables, ...tui].join("\n")}${MCP_BLOCK_END}\n`;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Values as Codex means them: empty arrays and tables dropped (Codex drops `args = []`), keys sorted. */
function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const inner = normalized(value[key]);
    const empty =
      (Array.isArray(inner) && inner.length === 0) ||
      (isRecord(inner) && Object.keys(inner).length === 0);
    if (!empty) out[key] = inner;
  }
  return out;
}

/**
 * What jig owns in a parsed config.toml, as a stable string: the servers
 * under `names` and the status line, by value. Codex rewrites the text of
 * these tables (drops `args = []`, moves them), so ownership is compared by
 * what they mean. Nothing when the file holds none of it.
 */
export function ownedView(parsed: unknown, names: readonly string[]): string | undefined {
  const root = isRecord(parsed) ? parsed : {};
  const servers = isRecord(root.mcp_servers) ? root.mcp_servers : {};
  const owned: Record<string, unknown> = {};
  for (const name of names) if (name in servers) owned[name] = servers[name];
  const tui = isRecord(root.tui) ? root.tui : {};
  const statusLine = tui.status_line;
  if (Object.keys(owned).length === 0 && statusLine === undefined) return undefined;
  return JSON.stringify(normalized({ servers: owned, status_line: statusLine ?? null }));
}
