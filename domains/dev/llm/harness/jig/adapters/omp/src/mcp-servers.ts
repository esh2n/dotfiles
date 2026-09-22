/**
 * The MCP server names configured for this omp session, used only to split
 * `mcp__<server>_<tool>` back into a server and a tool.
 *
 * omp joins the two with a SINGLE underscore
 * (`docs/mcp-server-tool-authoring.md`), which is ambiguous on its own:
 * `mcp__codebase_memory_mcp_search_code` could be server `codebase` or
 * server `codebase_memory_mcp`. The configured names resolve it. Without
 * them the guard falls back to the first underscore, which is right for a
 * one-word server (`serena`) and wrong for a hyphenated one — the fallback
 * still produces an `mcp.call`, it just names the server less precisely.
 *
 * Read from the files omp reads, highest priority first
 * (`docs/mcp-config.md`): the project pair under `<cwd>/.omp`, then the user
 * pair under the agent dir (`~/.omp/agent`, or `~/.omp/profiles/<name>/agent`
 * under `--profile`/`OMP_PROFILE`). Best effort: this is a hint for a name
 * split, never a gate, so an unreadable or absent file costs nothing.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

/** The agent dir omp resolves for the active profile. */
export function agentDir(env: Env): string {
  const explicit = env.PI_CODING_AGENT_DIR ?? env.OMP_AGENT_DIR;
  if (explicit !== undefined && explicit !== "") return explicit;
  const profile = env.OMP_PROFILE ?? env.PI_PROFILE;
  return profile === undefined || profile === ""
    ? join(homedir(), ".omp", "agent")
    : join(homedir(), ".omp", "profiles", profile, "agent");
}

function namesIn(path: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return [];
    const record = parsed as Record<string, unknown>;
    const servers = record.mcpServers ?? record.servers;
    if (typeof servers !== "object" || servers === null) return [];
    return Object.keys(servers as Record<string, unknown>);
  } catch {
    return [];
  }
}

let cache: { readonly key: string; readonly names: readonly string[] } | undefined;

/** Every configured server name, deduplicated. Cached per cwd+agent dir. */
export function resolveMcpServers(env: Env, cwd: string): readonly string[] {
  const dir = agentDir(env);
  const key = `${dir}\0${cwd}`;
  if (cache !== undefined && cache.key === key) return cache.names;
  const names: string[] = [];
  for (const file of [
    join(cwd, ".omp", "mcp.json"),
    join(cwd, ".omp", ".mcp.json"),
    join(dir, "mcp.json"),
    join(dir, ".mcp.json"),
  ]) {
    for (const name of namesIn(file)) if (!names.includes(name)) names.push(name);
  }
  cache = { key, names };
  return names;
}
