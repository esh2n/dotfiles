/**
 * Selects and shapes the servers Claude Code should have, from the canonical
 * mcp.json inventory — the Claude-only subset of yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/writers/claude.js` (`toClaudeEntry`,
 * `buildMcpServers`), reading `server.targets.claude` /
 * `targetOverrides.claude` directly.
 *
 * Claude Code does not read MCP servers from `~/.claude/settings.json`; its
 * user-scope source is the `mcpServers` key of `~/.claude.json`, which
 * `domain/claude/claude-json.ts` fills from the result here — the parsed,
 * overridden and templated form of each server.
 *
 * `{{HOME}}` placeholders are substituted here, field by field, because the
 * result is a typed record and not a Json tree the compose template pass could
 * walk.
 */

import { type TemplateVars, templateString } from "../compose/template";
import type { McpServer, McpServerOverride, McpTransport } from "./types";

/** One server for Claude Code — the parsed, overridden, templated form. */
export interface ClaudeMcpAdd {
  readonly name: string;
  readonly transport: McpTransport;
  /** stdio: the executable after `--`. */
  readonly command?: string;
  /** stdio: the arguments after the command. */
  readonly args: readonly string[];
  /** http / sse: the positional URL. */
  readonly url?: string;
  /** `-e KEY=value`, in source order. */
  readonly env: Readonly<Record<string, string>>;
  /** `-H 'Key: value'`, in source order. */
  readonly headers: Readonly<Record<string, string>>;
}

function applyClaudeOverride(server: McpServer): McpServer {
  const override = server.targetOverrides?.claude;
  return override ? { ...server, ...override } : server;
}

function templateRecord(
  record: Readonly<Record<string, string>> | undefined,
  vars: TemplateVars,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) out[key] = templateString(value, vars);
  return out;
}

function toClaudeAdd(server: McpServer, vars: TemplateVars): ClaudeMcpAdd {
  const base = {
    name: server.name,
    transport: server.transport,
    env: templateRecord(server.env, vars),
    headers: templateRecord(server.headers, vars),
  };
  if (server.transport === "stdio") {
    return {
      ...base,
      ...(server.command === undefined ? {} : { command: templateString(server.command, vars) }),
      args: (server.args ?? []).map((arg) => templateString(arg, vars)),
    };
  }
  return {
    ...base,
    args: [],
    ...(server.url === undefined ? {} : { url: templateString(server.url, vars) }),
  };
}

/**
 * The servers Claude Code should have, in source order: `targets.claude: true`
 * only, with `targetOverrides.claude` applied and `{{HOME}}`-style placeholders
 * substituted.
 *
 * @param mergedServers canonical, already core -> packs -> personal merged
 *   servers (domain/mcp/merge.ts's mergeMcpLayers)
 */
export function buildClaudeMcpServers(
  mergedServers: readonly McpServer[],
  vars: TemplateVars,
): readonly ClaudeMcpAdd[] {
  const out: ClaudeMcpAdd[] = [];
  for (const server of mergedServers) {
    if (server.targets?.claude !== true) continue;
    out.push(toClaudeAdd(applyClaudeOverride(server), vars));
  }
  return out;
}

export type { McpServerOverride };
