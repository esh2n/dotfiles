/**
 * Renders the `claude mcp add` / `claude mcp remove` lines the dry-run prints.
 *
 * Why a command line and not a settings object: Claude Code does not read MCP
 * servers from `~/.claude/settings.json` (mcp.md and settings.md both say so).
 * Its sources are `~/.claude.json` (user scope, written by
 * `claude mcp add --scope user`), the project's `.mcp.json`, plugins, claude.ai
 * connectors and managed-mcp.json. There is no JSON bulk-add command; the CLI
 * is the only documented writer of `~/.claude.json`, and that file is one jig
 * may neither read nor write
 * (`rules/decisions/2026-09-22-config-layout-no-personal-layer.md`: the
 * generator's dependency runs sources → output, one way). So, exactly as the
 * dry-run prints paste-able permit rules instead of writing `policy/`, it
 * prints one paste-able line per server and lets the owner run them.
 *
 * jig never runs these itself. Whether it may invoke the `claude` CLI is a
 * ruling the owner has not made; until then `--write` performs the
 * settings.json change only.
 */

import { shellJoin } from "./shell-quote";
import type { ClaudeMcpAdd } from "./to-claude";

/**
 * The exact line to paste, per mcp.md's syntax:
 *
 *   claude mcp add --transport stdio --scope user <name> [-e K=V]… -- <command> <args…>
 *   claude mcp add --transport http|sse --scope user <name> <url> [-H 'K: v']… [-e K=V]…
 *
 * `--` is mandatory for stdio: everything after it goes to the server untouched.
 * A `${VAR}` reference inside a value is single-quoted so the shell leaves it
 * alone; Claude Code expands it when it reads `~/.claude.json`.
 */
export function renderClaudeMcpAdd(add: ClaudeMcpAdd): string {
  const words: string[] = ["claude", "mcp", "add", "--transport", add.transport, "--scope", "user"];
  words.push(add.name);
  if (add.transport !== "stdio" && add.url !== undefined) words.push(add.url);
  for (const [key, value] of Object.entries(add.headers)) words.push("-H", `${key}: ${value}`);
  for (const [key, value] of Object.entries(add.env)) words.push("-e", `${key}=${value}`);
  if (add.transport === "stdio") {
    words.push("--");
    if (add.command !== undefined) words.push(add.command);
    words.push(...add.args);
  }
  return shellJoin(words);
}
