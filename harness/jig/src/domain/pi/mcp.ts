/**
 * The MCP servers jig owns in pi-mcp-adapter's user-global config, as pure
 * transforms over a file jig does not own whole.
 *
 * pi itself has no MCP client and will not get one
 * (`rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md` §Q1: "pi does
 * not and will not support MCP"); the MCP-list decision
 * (`rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md`, 届け方)
 * delivers `mcp/servers.json` to pi through the community extension
 * pi-mcp-adapter, which reads the same `mcpServers` map every other host
 * does and connects lazily. The adapter's README
 * (https://github.com/nicobailon/pi-mcp-adapter, "Quick Start" and "Config →
 * File Layout") names `~/.config/mcp/mcp.json` the "Preferred user-global
 * shared config" ("for all projects"), with `<Pi agent dir>/mcp.json` as
 * "Pi global override and compatibility imports" — the file the adapter
 * writes itself for adapter-only settings such as `directTools`. Precedence
 * ("later entries win"): `~/.config/mcp/mcp.json`, `~/.agents/mcp.json`,
 * `~/.agents/mcp/mcp.json`, `<Pi agent dir>/mcp.json`, `.mcp.json`,
 * `.pi/mcp.json`. jig writes the shared user-global file and leaves the
 * adapter's own override file alone.
 *
 * "Server Options" documents the entry fields: `command` ("Executable for
 * stdio transport; mutually exclusive with `url`"), `args`, `env` ("supports
 * `${VAR}` ... interpolation"), `url` ("HTTP endpoint (StreamableHTTP with
 * SSE fallback)"), `headers` (same interpolation), `lifecycle` (`lazy` is the
 * default: "Don't connect at startup. Connect on first tool call"), and
 * `disabled`. No `type` field is documented — the transport is which of
 * `command`/`url` is present — so none is written, and a source `sse` server
 * becomes a `url` entry the adapter reaches with its SSE fallback. `${VAR}`
 * is left for the adapter to interpolate at connection time; `{{HOME}}` is
 * jig's and substituted here. `lifecycle` is not written: lazy is the
 * documented default and the reason the decision picked this adapter.
 *
 * `/mcp disable <server>` "persist[s] only the `disabled` field in the
 * project-local `.pi/mcp.json`" and "the source file is never rewritten", so
 * unlike omp's a switch-off never edits jig's entry; a `disabled: true`
 * written by hand into jig's file is a conflict all the same, and the
 * non-colliding place for it is `.pi/mcp.json`.
 */

import type { JsonObject } from "../compose/merge";
import { applyTemplate, type TemplateVars } from "../compose/template";
import {
  type McpJsonEntry,
  type McpJsonPlan,
  planMcpJson,
  renderMcpJsonBlock,
} from "../mcp/mcp-json";
import type { McpServer } from "../mcp/types";

/** The user-global shared config relative to `$HOME`, as the adapter's README spells it (no XDG variable is documented). */
export const PI_MCP_USER_CONFIG = ".config/mcp/mcp.json";

/** The package spec `pi install` takes for the adapter (README, "Install": `pi install npm:pi-mcp-adapter`). */
export const PI_MCP_ADAPTER_PACKAGE = "pi-mcp-adapter";

export type PiMcpEntry = McpJsonEntry;

function applyPiOverride(server: McpServer): McpServer {
  const override = server.targetOverrides?.pi;
  return override ? { ...server, ...override } : server;
}

/** The key/value pairs one entry carries, in the order they are written; the transport is implied by `command` vs `url`. */
function entryFields(server: McpServer): JsonObject {
  const nonEmpty = (record: Readonly<Record<string, string>> | undefined) =>
    record && Object.keys(record).length > 0 ? { ...record } : undefined;
  if (server.transport !== "stdio") {
    const headers = nonEmpty(server.headers);
    return {
      ...(server.url === undefined ? {} : { url: server.url }),
      ...(headers === undefined ? {} : { headers }),
    };
  }
  const env = nonEmpty(server.env);
  const args = server.args ?? [];
  return {
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(args.length === 0 ? {} : { args: [...args] }),
    ...(env === undefined ? {} : { env }),
  };
}

/**
 * One entry per server with `targets.pi: true`, the pi override applied and
 * `{{HOME}}` substituted. Order is the source's.
 */
export function buildPiMcpServers(
  servers: readonly McpServer[],
  vars: TemplateVars,
): readonly PiMcpEntry[] {
  const out: PiMcpEntry[] = [];
  for (const server of servers) {
    if (server.targets?.pi !== true) continue;
    const effective = applyPiOverride(server);
    out.push({
      name: effective.name,
      entry: applyTemplate(entryFields(effective), vars) as JsonObject,
    });
  }
  return out;
}

/** The text hand-edit detection hashes: jig's entries alone, in source order. */
export function renderPiMcpBlock(entries: readonly PiMcpEntry[]): string {
  return renderMcpJsonBlock(entries);
}

export type PiMcpPlan = McpJsonPlan;

/**
 * Upsert jig's entries (`domain/mcp/mcp-json.ts`, the rule shared with the
 * omp target). No `$schema` is added: the adapter documents none, and the
 * file is shared with every host that reads the standard path.
 */
export function planPiMcpJson(
  current: string | undefined,
  entries: readonly PiMcpEntry[],
): PiMcpPlan {
  return planMcpJson(current, entries);
}
