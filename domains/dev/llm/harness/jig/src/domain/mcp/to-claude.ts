/**
 * Builds the `mcpServers` object for Claude Code's settings.json from the
 * canonical mcp.json inventory — ported from the Claude-only subset of
 * yoki's `runtime/yoki/scripts/lib/mcp-inventory/writers/claude.js`
 * (`toClaudeEntry`, `buildMcpServers`). yoki's version goes through a
 * harness-id indirection table (`claude` <-> `claude-code`) to stay generic
 * across writers; jig only has the Claude writer today, so this reads
 * `server.targets.claude` / `targetOverrides.claude` directly.
 *
 * `{{HOME}}` placeholders are left untouched here, same as yoki's writer —
 * the template pass (./domain/compose/template.ts) substitutes them
 * afterwards over the whole composed object.
 */

import type { JsonObject } from "../compose/merge";
import type { ClaudeMcpEntry, McpServer, McpServerOverride } from "./types";

function applyClaudeOverride(server: McpServer): McpServer {
  const override = server.targetOverrides?.claude;
  return override ? { ...server, ...override } : server;
}

function toClaudeEntry(server: McpServer): ClaudeMcpEntry {
  const env = server.env && Object.keys(server.env).length > 0 ? server.env : undefined;

  if (server.transport === "http") {
    return {
      type: "http",
      ...(server.url === undefined ? {} : { url: server.url }),
      ...(env === undefined ? {} : { env }),
    };
  }

  return {
    type: "stdio",
    ...(server.command === undefined ? {} : { command: server.command }),
    args: server.args ?? [],
    ...(env === undefined ? {} : { env }),
  };
}

/**
 * @param mergedServers canonical, already core -> packs -> personal merged
 *   servers (domain/mcp/merge.ts's mergeMcpLayers)
 */
export function buildClaudeMcpServers(mergedServers: readonly McpServer[]): JsonObject {
  const result: Record<string, ClaudeMcpEntry> = {};
  for (const server of mergedServers) {
    if (server.targets?.claude !== true) continue;
    const effective = applyClaudeOverride(server);
    result[effective.name] = toClaudeEntry(effective);
  }
  return result as unknown as JsonObject;
}

export type { McpServerOverride };
