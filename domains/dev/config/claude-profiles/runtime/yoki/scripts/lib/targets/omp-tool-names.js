'use strict';

/**
 * Claude Code tool name -> omp native tool id, shared by every omp.js
 * conversion that touches a tool name: agents/*.md `tools:` frontmatter
 * (omp-agents.js), hook-group matchers (omp-hooks.js), and config.yml
 * `tools.approval` keys (omp-config-yml.js).
 *
 * Source: the omp 18.0.4 binary's `BUILTIN_TOOLS` registry (`strings` dump,
 * scratchpad spike S4-S5 addendum) — read, security_scan, bash, edit,
 * ast_grep, ast_edit, ask, debug, eval, github, glob, grep, lsp,
 * inspect_image, browser, computer, checkpoint, rewind, task, hub, todo,
 * web_search, write, memory_edit, retain, recall, reflect, learn,
 * manage_skill. There is no dedicated `ls` tool (an ls-shaped call surfaces
 * with `toolName: "read"` in the runtime trace) and no `webfetch`/`web_fetch`
 * tool at all, so `LS` folds into `read` and `WebFetch` has no mapping.
 */
const CLAUDE_TO_OMP_TOOL = {
  Read: 'read',
  LS: 'read',
  Grep: 'grep',
  Glob: 'glob',
  Bash: 'bash',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'write',
  Task: 'task',
  TodoRead: 'todo',
  TodoWrite: 'todo',
  WebSearch: 'web_search',
  // NotebookRead, NotebookEdit, WebFetch: no native omp tool — omitted by
  // every caller below rather than guessed at.
};

/** @returns {string|undefined} the omp tool id, or undefined when Claude's
 *   tool name has no native omp equivalent. */
function translateToolName(claudeName) {
  return CLAUDE_TO_OMP_TOOL[claudeName];
}

/**
 * @param {string[]|string|undefined} tools a `tools:` frontmatter value
 * @returns {string[]|undefined} deduped omp tool ids, or undefined when the
 *   input is missing or every entry is unmappable (caller should omit the
 *   `tools:` key entirely so omp grants its own default set).
 */
function translateToolsList(tools) {
  const list = Array.isArray(tools) ? tools : (typeof tools === 'string' && tools ? [tools] : []);
  const mapped = [];
  for (const name of list) {
    const omp = translateToolName(String(name).trim());
    if (omp && !mapped.includes(omp)) mapped.push(omp);
  }
  return mapped.length > 0 ? mapped : undefined;
}

/** Canonical emission order for translateMatcher — so "Write|Edit|MultiEdit"
 * and "Edit|Write|MultiEdit" (the same set, written by different layers)
 * translate to the identical string instead of one that merely happens to
 * preserve whichever order a layer wrote the Claude names in (same
 * motivation as codex-hooks-merge.js's canonicalMatcher). */
const OMP_TOOL_ORDER = ['bash', 'read', 'write', 'edit', 'grep', 'glob', 'task', 'todo', 'web_search'];

/**
 * Translates a Claude `|`-joined matcher (e.g. `"Write|Edit|MultiEdit"`)
 * into omp tool ids, deduped and emitted in OMP_TOOL_ORDER regardless of the
 * input's own order (e.g. `"write|edit"`).
 * @returns {string|null} null when NO name in the matcher has an omp
 *   equivalent — the caller should skip the whole group with a warning.
 */
function translateMatcher(claudeMatcher) {
  const names = String(claudeMatcher || '').split('|').map(s => s.trim()).filter(Boolean);
  const mappedSet = new Set();
  for (const name of names) {
    const omp = translateToolName(name);
    if (omp) mappedSet.add(omp);
  }
  if (mappedSet.size === 0) return null;
  const ordered = OMP_TOOL_ORDER.filter(id => mappedSet.has(id));
  return ordered.join('|');
}

module.exports = { CLAUDE_TO_OMP_TOOL, translateToolName, translateToolsList, translateMatcher };
