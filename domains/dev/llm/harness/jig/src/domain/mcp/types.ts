/**
 * Types for the `mcp.json` sidecar — the `jig.mcp.v1` canonical MCP source
 * of truth (core/mcp.json, packs/<name>/mcp.json, personal/mcp.json),
 * compiled into Claude's settings.json `mcpServers` instead of being read
 * from the settings JSON layers directly.
 *
 * Mirrors the claude-relevant subset of yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/{source,writers/claude}.js`.
 */

export const MCP_SCHEMA_VERSION = "jig.mcp.v1";

export type McpTransport = "stdio" | "http";

/** `targets.<key>` / `targetOverrides.<key>` — only the keys mcp.json ever uses. */
export interface McpTargets {
  readonly claude?: boolean;
  readonly codex?: boolean;
  readonly omp?: boolean;
}

/** A partial server shape — what a `targetOverrides.<harness>` block may set. */
export interface McpServerOverride {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface McpServer {
  readonly name: string;
  readonly transport: McpTransport;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly targets?: McpTargets;
  readonly targetOverrides?: {
    readonly claude?: McpServerOverride;
    readonly codex?: McpServerOverride;
    readonly omp?: McpServerOverride;
  };
}

/** One parsed `mcp.json` layer (core, a pack, or personal). */
export interface McpLayer {
  readonly schemaVersion: string;
  readonly servers: readonly McpServer[];
}

/** The shape one server takes in Claude's settings.json `mcpServers`. */
export interface ClaudeMcpEntry {
  readonly type: "http" | "stdio";
  readonly url?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}
