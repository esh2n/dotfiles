/**
 * POSIX shell quoting for the command lines jig prints and never runs.
 *
 * One rule, no cleverness: a word made only of characters the shell never
 * interprets is printed bare; anything else is wrapped in single quotes, with
 * an embedded `'` spelled `'\''`. Single quotes are the right choice here
 * because a `${VAR}` reference in an MCP server's `env` or `headers` must reach
 * `claude mcp add` *unexpanded* — Claude Code expands it itself when it reads
 * `~/.claude.json` (mcp.md, "Environment variable expansion"), and the source
 * file forbids literal secrets in the first place (./parse.ts).
 *
 * Pure. Works in sh, bash, zsh and fish (fish reads `'\''` the same way).
 */

/** Characters that need no quoting in any POSIX shell or in fish. */
const BARE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shellQuote(word: string): string {
  if (word === "") return "''";
  if (BARE_WORD.test(word)) return word;
  return `'${word.replace(/'/g, "'\\''")}'`;
}

/** The words of one command line, each quoted, joined by single spaces. */
export function shellJoin(words: readonly string[]): string {
  return words.map(shellQuote).join(" ");
}
