/**
 * Parses and validates one `mcp.json` layer — ported from yoki's
 * `runtime/yoki/scripts/lib/mcp-inventory/source.js` (`loadLayer`,
 * `assertNoLiteralSecrets`, `assertKnownTargetKeys`), minus the file read
 * (the app layer owns IO; this takes already-read text).
 */

import { SECRET_KEY_PATTERN, looksLikeSecretValue } from "./secret-detection";
import { MCP_SCHEMA_VERSION, type McpLayer, type McpServer } from "./types";

/** `${VAR}` or `${VAR:-default}` — the two forms Claude Code expands at runtime (mcp.md). */
const ENV_REF_RE = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/g;
/** Every harness a `targets`/`targetOverrides` block may name — see McpTargets. */
const KNOWN_TARGET_KEYS = new Set(["claude", "codex", "omp", "pi", "dsh"]);

/**
 * A value that carries the secret as a reference is fine whatever its key:
 * `${TOKEN}` alone, and also the shape the docs recommend for a header,
 * `Bearer ${TOKEN}` — no word left once the references are stripped may
 * itself look like a credential.
 */
function isReferenceValue(value: string): boolean {
  if (value.match(ENV_REF_RE) === null) return false;
  const words = value.replace(ENV_REF_RE, " ").split(/\s+/);
  return !words.some(looksLikeSecretValue);
}

function assertNoLiteralSecrets(server: McpServer, label: string): void {
  // `headers` gets the same rule as `env`: a bearer token in a header is a
  // secret, and Claude Code expands `${VAR}` in headers at runtime too (mcp.md).
  for (const field of ["env", "headers"] as const) {
    for (const [key, value] of Object.entries(server[field] ?? {})) {
      if (typeof value !== "string" || isReferenceValue(value)) continue;

      if (looksLikeSecretValue(value) || SECRET_KEY_PATTERN.test(key)) {
        throw new Error(
          `${label}: server "${server.name}" ${field}.${key} looks like a literal secret — ` +
            `use "\${${key}}" (an env-var reference) instead of a literal value`,
        );
      }
    }
  }
}

function assertKnownTargetKeys(server: McpServer, label: string): void {
  for (const field of ["targets", "targetOverrides"] as const) {
    const block = server[field];
    if (!block || typeof block !== "object") continue;

    for (const key of Object.keys(block)) {
      if (key.startsWith("_")) continue; // `_comment` and friends
      if (KNOWN_TARGET_KEYS.has(key)) continue;
      throw new Error(
        `${label}: server "${server.name}" ${field}.${key} is not a known target key ` +
          `(known keys: ${[...KNOWN_TARGET_KEYS].join(", ")})`,
      );
    }
  }
}

/**
 * @param text raw file content (already read by the caller)
 * @param label used only in error messages (typically the file path)
 */
export function parseMcpLayer(text: string, label: string): McpLayer {
  const json = JSON.parse(text) as { schemaVersion?: unknown; servers?: unknown };
  if (json.schemaVersion !== MCP_SCHEMA_VERSION) {
    throw new Error(
      `${label}: unsupported schemaVersion "${String(json.schemaVersion)}" (expected "${MCP_SCHEMA_VERSION}")`,
    );
  }

  const servers = Array.isArray(json.servers) ? (json.servers as McpServer[]) : [];
  for (const server of servers) {
    assertNoLiteralSecrets(server, label);
    assertKnownTargetKeys(server, label);
  }

  return { schemaVersion: MCP_SCHEMA_VERSION, servers };
}

/** The empty layer a missing `mcp.json` file resolves to. */
export const EMPTY_MCP_LAYER: McpLayer = { schemaVersion: MCP_SCHEMA_VERSION, servers: [] };
