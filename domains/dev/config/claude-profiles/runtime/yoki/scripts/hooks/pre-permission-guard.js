'use strict';

/**
 * PreToolUse(Bash|Write|Edit|MultiEdit|Read|Glob|Grep|LS|WebFetch): denies
 * the deny-list entries the running harness cannot enforce declaratively on
 * its own.
 *
 * WHICH entries those are is decided per harness at `yoki-switch apply` time
 * and handed to this hook as a file; this hook only matches. The file is
 * always `<harness dir>/.yoki/permissions.json`, shaped
 * `{"deny": [{"pattern": "...", "reason": "..."}]}`:
 *
 *   claude -> `<CLAUDE_DIR>/.yoki/permissions.json` (yoki-switch, from
 *             lib/permissions/to-claude.js's hookEnforcedDeny) — just the
 *             `enforce: [hook]` subset, since every other pattern IS a
 *             Claude permission rule Claude Code enforces itself.
 *   omp    -> `<OMP_AGENT_DIR>/.yoki/permissions.json` (lib/targets/omp.js)
 *             — that subset PLUS every path/domain-shaped deny, because
 *             config.yml has no key for `Read(...)`/`Edit(...)`/
 *             `WebFetch(domain:...)` at all.
 *   codex  -> `<CODEX_DIR>/.yoki/permissions.json` (lib/targets/codex.js) —
 *             that subset PLUS the denies neither yoki.rules nor
 *             `[permissions.yoki.filesystem]` expresses (the `Edit(...)`
 *             rows, the `Read(**…)` workspace globs).
 *
 * So on the two foreign harnesses this hook is not defense in depth, it is
 * the ONLY enforcement for those patterns — which is why it gates the read
 * side (Read/Glob/Grep/LS) and WebFetch too, not just Bash and the writers.
 *
 * A `Read(glob)` deny additionally covers a read-shaped Bash command
 * (`cat`/`sed`/`head`/… <path>): Codex has no dedicated read tool, so a file
 * read shells out as a Bash exec (scratchpad codex-read-tool-spike), and the
 * path arguments are parsed out of the command and matched against the same
 * Read patterns (readCommandPaths).
 *
 * A missing or unreadable file fails open (exitCode 0): a guard that itself
 * crashes must never become the reason the harness blocks every tool call.
 *
 * Profile: always on (registered "minimal,standard,strict" — see
 * core/settings.layer.json).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The `.yoki/permissions.json` this harness's `yoki-switch apply` wrote.
 * `YOKI_HARNESS` is set by hooks/run-with-flags.js for every non-Claude
 * harness; the per-harness dir env vars are the same ones yoki-switch itself
 * uses (`CLAUDE_DIR`/`CODEX_DIR`/`OMP_AGENT_DIR` — see domains/dev/bin/
 * yoki-switch), so a redirected apply and a redirected guard read the same
 * place. An unknown harness value falls back to the Claude path rather than
 * to no file at all: the hook-tagged subset is correct everywhere.
 */
function resolvePermissionsFile(env = process.env) {
  const harness = String(env.YOKI_HARNESS || 'claude').trim().toLowerCase();
  const home = os.homedir();

  if (harness === 'omp') {
    return path.join(env.OMP_AGENT_DIR || path.join(home, '.omp', 'agent'), '.yoki', 'permissions.json');
  }
  if (harness === 'codex') {
    return path.join(env.CODEX_DIR || env.CODEX_HOME || path.join(home, '.codex'), '.yoki', 'permissions.json');
  }
  return path.join(env.CLAUDE_DIR || path.join(home, '.claude'), '.yoki', 'permissions.json');
}

/** Loads the hook-enforced deny list. Any error (missing file, bad JSON,
 * wrong shape) yields an empty list — fail open. */
function loadDenyPatterns(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.deny)) return [];
    return parsed.deny.filter(e => e && typeof e.pattern === 'string');
  } catch {
    return [];
  }
}

/** Splits a Claude permission pattern like "Bash(rm -rf /*)" into its tool
 * name and the text inside the parens ("rm -rf /*"). A bare tool name with
 * no parens (e.g. "WebSearch") has no matcher here and is ignored. */
function classifyPattern(pattern) {
  const m = /^([A-Za-z]+)\((.*)\)$/.exec(pattern);
  if (!m) return null;
  return { tool: m[1], inner: m[2] };
}

/**
 * Bash pattern matching for this repo's `enforce: [hook]` deny list.
 *
 * Two prefix forms, and they mean different things:
 *   - `"git push *"` — space then star: a WORD-boundary prefix. The command
 *     must equal `git push`, or start with `git push ` — never `git pushx`.
 *   - `"rm -rf /*"` — star glued to the last token: a plain prefix. The
 *     command must start with `rm -rf /`, which is the only reading that
 *     makes the pattern mean anything: `rm -rf /etc/foo` is precisely the
 *     command it exists to stop.
 *
 * Treating the second form as an exact match (the behaviour before this
 * comment) made the guard fire only on the literal text `rm -rf /*` and
 * never on a real command — and since to-codex.js's toExecpolicyTokens()
 * returns null for exactly these glob patterns, this hook is their ONLY
 * enforcement point on Codex and omp. The repo's sibling matcher
 * lib/hook-if-match.js parseIfPattern() already reads a trailing `*` as a
 * prefix wildcard; this now agrees with it.
 *
 * Anything with no trailing star stays an exact match of the whole command
 * text — no shell expansion is performed when comparing.
 */
function matchBash(pattern, command) {
  const cmd = String(command || '').trim();
  if (pattern.endsWith(' *')) {
    const prefix = pattern.slice(0, -2);
    return cmd === prefix || cmd.startsWith(`${prefix} `);
  }
  if (pattern.endsWith('*')) {
    return cmd.startsWith(pattern.slice(0, -1));
  }
  return cmd === pattern;
}

/**
 * Minimal glob → RegExp for the path patterns this permission set actually
 * uses: a bare double-star (any path depth) or double-star-slash (same,
 * optionally zero directories), `*` (one segment,
 * no `/`), `?` (one char, no `/`), a literal leading `~/` expanded against
 * the guard's own home dir. Everything else is escaped as a literal.
 */
function globToRegExp(glob) {
  let expanded = glob;
  if (expanded.startsWith('~/')) {
    expanded = path.join(os.homedir(), expanded.slice(2));
  }

  let re = '';
  for (let i = 0; i < expanded.length; ) {
    if (expanded.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (expanded.startsWith('**', i)) {
      re += '.*';
      i += 2;
      continue;
    }
    const c = expanded[i];
    if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^$()[]{}|\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

function matchPath(pattern, filePath) {
  if (typeof filePath !== 'string' || filePath === '') return false;
  const re = globToRegExp(pattern);
  return re.test(filePath) || re.test(path.basename(filePath));
}

/**
 * Read-shaped shell commands whose non-flag arguments name files being read.
 * On Codex a file read is emitted as a Bash exec of one of these (there is no
 * dedicated read tool — see scratchpad/codex-read-tool-spike.md: `cat x.txt`,
 * `sed -n '1,200p' ./x.txt`, `rg …`), so a `Read(glob)` deny can only be
 * enforced there by parsing the command. omp reads arrive as a `read` tool
 * with a `path`, handled by toolCallPath — this covers the harnesses that
 * shell out instead.
 */
const READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'nl', 'tac', 'rev',
  'od', 'xxd', 'hexdump', 'strings', 'base64', 'bat',
]);

/** Expands a leading `~/` (or a bare `~`) to the guard's own home dir, so a
 * token like `~/.ssh/id_ed25519` compares against a `~/`-rooted pattern
 * (globToRegExp expands the pattern side the same way). */
function expandHome(token) {
  if (token === '~') return os.homedir();
  if (token.startsWith('~/')) return path.join(os.homedir(), token.slice(2));
  return token;
}

/** Splits a command string into pipeline/list segments on unquoted `|`,
 * `||`, `&&`, `;` and newlines, so each segment is one simple command whose
 * first word is the program name. Quotes are preserved for the tokenizer. */
function splitShellSegments(command) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      cur += c;
      quote = c;
      continue;
    }
    if (c === '\n' || c === ';') {
      segments.push(cur);
      cur = '';
      continue;
    }
    if ((c === '&' && command[i + 1] === '&') || (c === '|' && command[i + 1] === '|')) {
      segments.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    if (c === '|' || c === '&') {
      segments.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  segments.push(cur);
  return segments;
}

/** Whitespace-splits a single segment into tokens, honouring single/double
 * quotes and stripping the quote characters (no expansion — a security guard
 * matches the literal path the shell would open). */
function tokenizeSegment(segment) {
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      has = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (has) {
        tokens.push(cur);
        cur = '';
        has = false;
      }
      continue;
    }
    cur += c;
    has = true;
  }
  if (has) tokens.push(cur);
  return tokens;
}

/**
 * The file paths a read-shaped Bash command opens: for every segment whose
 * program is a READ_COMMANDS entry, its non-flag argument tokens (with a
 * leading `~/` expanded). Flags (`-n`, `--`) and any glued value are skipped;
 * a stray non-path token (e.g. sed's `'1,200p'` script) is harmless — it
 * cannot match a specific path deny glob. Returns [] for a non-string or a
 * command that reads nothing.
 */
function readCommandPaths(command) {
  if (typeof command !== 'string' || command.trim() === '') return [];
  const paths = [];
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeSegment(segment);
    if (tokens.length === 0) continue;
    const program = path.basename(tokens[0]);
    if (!READ_COMMANDS.has(program)) continue;
    for (let i = 1; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok === '' || tok.startsWith('-')) continue; // flag or its option value
      paths.push(expandHome(tok));
    }
  }
  return paths;
}

/**
 * `WebFetch(domain:example.com)` against a tool call's URL, matching Claude's
 * own rule: the pattern names a HOST, so it is compared to the URL's hostname
 * and nothing else (never the path, never the raw URL text — `domain:evil.com`
 * must not match `https://ok.example/?r=evil.com`). A `*` in the pattern is a
 * wildcard within the host, reusing globToRegExp: `/` cannot appear in a
 * hostname, so its "star does not cross a slash" rule is a no-op here.
 *
 * A URL that does not parse matches nothing — an unparseable URL is not a
 * host this pattern was written about, and guessing would deny by accident.
 */
function matchDomain(inner, url) {
  const m = /^domain:(.*)$/.exec(inner);
  if (!m) return false;
  let hostname;
  try {
    hostname = new URL(String(url)).hostname;
  } catch {
    return false;
  }
  if (!hostname) return false;
  return globToRegExp(m[1]).test(hostname);
}

/**
 * Which tool calls a pattern's tool name applies to — Claude Code's own
 * grouping, which this hook has to reproduce exactly or it would enforce a
 * different rule than the settings.json it was generated alongside:
 *
 *   Edit(glob)  gates every WRITE-side tool (Edit, MultiEdit, Write, …)
 *   Read(glob)  gates every READ-side tool (Read, Glob, Grep, LS, …)
 *
 * A tool call outside both families (Task, TodoWrite) reaches no path
 * pattern at all.
 */
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);

/** Every tool name this hook has a matcher for. Anything else passes through
 * untouched rather than being compared against patterns that cannot describe
 * it. */
const GATED_TOOLS = new Set(['Bash', ...WRITE_TOOLS, ...READ_TOOLS, 'WebFetch']);

/**
 * The path a tool call operates on. `file_path` is Claude's Read/Edit/Write
 * field; `path` is what Glob/Grep/LS use AND what omp's own read/write tools
 * send (lib/harness/payload.js forwards omp's `input` verbatim for the read
 * side), so both are checked rather than assuming one harness's spelling.
 */
function toolCallPath(toolInput) {
  return toolInput.file_path || toolInput.path || toolInput.notebook_path || '';
}

function parseInput(rawInput) {
  if (typeof rawInput !== 'string') return rawInput && typeof rawInput === 'object' ? rawInput : null;
  if (!rawInput.trim()) return null;
  try {
    return JSON.parse(rawInput);
  } catch {
    return null;
  }
}

function denyResult(pattern) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `yoki permission-guard: ${pattern}`,
      },
    }),
  };
}

function passthrough(rawInput) {
  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

/**
 * @param {string} rawInput the raw PreToolUse JSON payload
 */
function run(rawInput) {
  const input = parseInput(rawInput);
  if (!input) return passthrough(rawInput);

  const toolName = String(input.tool_name || input.tool || '');
  if (!GATED_TOOLS.has(toolName)) {
    return passthrough(rawInput);
  }

  let denyEntries;
  try {
    denyEntries = loadDenyPatterns(resolvePermissionsFile());
  } catch {
    return passthrough(rawInput);
  }
  if (denyEntries.length === 0) return passthrough(rawInput);

  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  for (const entry of denyEntries) {
    const classified = classifyPattern(entry.pattern);
    if (!classified) continue;

    if (classified.tool === 'Bash') {
      if (toolName === 'Bash' && matchBash(classified.inner, toolInput.command)) {
        return denyResult(entry.pattern);
      }
      continue;
    }

    if (classified.tool === 'WebFetch') {
      if (toolName === 'WebFetch' && matchDomain(classified.inner, toolInput.url)) {
        return denyResult(entry.pattern);
      }
      continue;
    }

    const family = classified.tool === 'Edit' ? WRITE_TOOLS : classified.tool === 'Read' ? READ_TOOLS : null;
    if (!family) continue;
    if (family.has(toolName)) {
      if (matchPath(classified.inner, toolCallPath(toolInput))) {
        return denyResult(entry.pattern);
      }
      continue;
    }
    // A Read(glob) deny also covers a read-shaped Bash command. On Codex a
    // file read shells out as `cat`/`sed`/… (there is no dedicated read
    // tool — scratchpad/codex-read-tool-spike.md), so parsing the command's
    // path arguments is the only way the hook can enforce a Read deny there.
    if (classified.tool === 'Read' && toolName === 'Bash') {
      for (const readPath of readCommandPaths(toolInput.command)) {
        if (matchPath(classified.inner, readPath)) {
          return denyResult(entry.pattern);
        }
      }
    }
  }

  return passthrough(rawInput);
}

module.exports = {
  run,
  matchBash,
  matchPath,
  matchDomain,
  globToRegExp,
  classifyPattern,
  loadDenyPatterns,
  resolvePermissionsFile,
  readCommandPaths,
};
