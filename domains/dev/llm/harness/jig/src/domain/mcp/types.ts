/**
 * Types for the MCP inventory — the `jig.mcp.v1` canonical source of truth,
 * compiled into each harness's own shape instead of being read from that
 * harness's settings file.
 *
 * The source is now a single file, `llm/harness/mcp/servers.json`
 * (`rules/decisions/2026-09-22-config-layout-no-personal-layer.md` — no
 * core/pack/personal layers). The layer merge below still exists because the
 * merge order is what a later layer *would* mean, and the parser is shared
 * with yoki's remaining files during the migration.
 *
 * Mirrors the claude-relevant subset of yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/{source,writers/claude}.js`.
 */

export const MCP_SCHEMA_VERSION = "jig.mcp.v1";

export type McpTransport = "stdio" | "http";

/**
 * `targets.<key>` / `targetOverrides.<key>` — one key per harness the
 * generator can be asked about. `pi` and `dsh` are declared although no writer
 * exists for them yet (milestone 3 of the generator): the source file states
 * applicability for all five harnesses, and a declared key with no writer is
 * simply never read, whereas an *undeclared* key is a load-time error
 * (./parse.ts's `assertKnownTargetKeys`) — which is the behavior worth keeping.
 */
export interface McpTargets {
  readonly claude?: boolean;
  readonly codex?: boolean;
  readonly omp?: boolean;
  readonly pi?: boolean;
  readonly dsh?: boolean;
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
    readonly pi?: McpServerOverride;
    readonly dsh?: McpServerOverride;
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
