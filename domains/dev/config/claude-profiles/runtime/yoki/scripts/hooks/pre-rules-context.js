'use strict';

/**
 * PreToolUse(Read|Write|Edit): matches the tool's target file against every
 * rule file's `paths:` frontmatter glob list under `<CLAUDE_DIR>/rules/**\/*.md`
 * and injects the matching rule bodies as `additionalContext` — the
 * conditional-loading half of `core/rules/README.md` ("the rule is loaded
 * only when a file matching one of its globs is accessed") made real for a
 * harness whose model can't just be told "read ~/.claude/rules yourself"
 * (Codex — but harmless for Claude Code too, since its rules are already
 * fully loaded there; T9 registers this hook on both).
 *
 * Injected once per (session, rule): a cursor file at
 * `~/.local/state/yoki/rules-context/<session_id>.json` records which rule
 * relative paths have already been surfaced in this session, so repeatedly
 * touching the same file type doesn't re-paste the same rule body on every
 * tool call.
 *
 * Profile: standard,strict (registered in core/settings.layer.json) —
 * minimal-profile-off, since this is guidance injection, not enforcement.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { globToRegExp } = require('./pre-permission-guard');

function resolveClaudeDir() {
  return process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

function resolveStateDir() {
  return process.env.YOKI_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'yoki');
}

/** Every `*.md` file under `rules/`, recursively — same shape as
 * lib/targets/layers.js's listMarkdownFilesRecursive, duplicated in plain
 * JS here so this hook has no dependency on the generator's lib/ tree. */
function listRuleFiles(rulesDir) {
  const results = [];
  function walk(dir, relPrefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push({ relPath: rel, absPath: abs });
    }
  }
  walk(rulesDir, '');
  return results;
}

function stripQuotes(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Parses the `paths:\n  - "glob"\n  - "glob"` frontmatter list. Returns
 * `[]` for a rule with no `paths:` key (an always-on rule — not this
 * hook's concern, it's already in AGENTS.md/CLAUDE.md). */
function extractPathsGlobs(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(markdown || ''));
  if (!m) return [];

  const globs = [];
  let inPaths = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    const item = /^\s*-\s*(.+)$/.exec(line);
    if (item) {
      globs.push(stripQuotes(item[1]));
      continue;
    }
    if (line.trim() === '') continue;
    break; // dedent or next frontmatter key ends the paths: list
  }
  return globs;
}

function ruleBody(markdown) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(String(markdown || ''));
  return (m ? m[1] : String(markdown || '')).trim();
}

function matchesAnyGlob(globs, filePath) {
  return globs.some(glob => {
    const re = globToRegExp(glob);
    return re.test(filePath) || re.test(path.basename(filePath));
  });
}

function cursorPath(stateDir, sessionId) {
  return path.join(stateDir, 'rules-context', `${sessionId}.json`);
}

function loadCursor(stateDir, sessionId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cursorPath(stateDir, sessionId), 'utf8'));
    return new Set(Array.isArray(parsed && parsed.injected) ? parsed.injected : []);
  } catch {
    return new Set();
  }
}

function saveCursor(stateDir, sessionId, injectedSet) {
  const file = cursorPath(stateDir, sessionId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ injected: [...injectedSet] }, null, 2));
  } catch {
    // best-effort persistence; a missed write just means a rule may be
    // re-surfaced once more in this session, never a functional break
  }
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
  if (!/^(Read|Write|Edit)$/.test(toolName)) return passthrough(rawInput);

  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const filePath = String(toolInput.file_path || toolInput.path || '');
  if (!filePath) return passthrough(rawInput);

  const sessionId = String(input.session_id || 'no-session');
  const claudeDir = resolveClaudeDir();
  const stateDir = resolveStateDir();

  let ruleFiles;
  try {
    ruleFiles = listRuleFiles(path.join(claudeDir, 'rules'));
  } catch {
    return passthrough(rawInput);
  }
  if (ruleFiles.length === 0) return passthrough(rawInput);

  const alreadyInjected = loadCursor(stateDir, sessionId);
  const toInject = [];
  const newlyInjected = new Set();

  for (const file of ruleFiles) {
    if (alreadyInjected.has(file.relPath)) continue;
    let markdown;
    try {
      markdown = fs.readFileSync(file.absPath, 'utf8');
    } catch {
      continue;
    }
    const globs = extractPathsGlobs(markdown);
    if (globs.length === 0) continue; // always-on rule — not this hook's concern
    if (!matchesAnyGlob(globs, filePath)) continue;

    toInject.push(ruleBody(markdown));
    newlyInjected.add(file.relPath);
  }

  if (toInject.length === 0) return passthrough(rawInput);

  saveCursor(stateDir, sessionId, new Set([...alreadyInjected, ...newlyInjected]));
  return { additionalContext: toInject };
}

module.exports = {
  run,
  extractPathsGlobs,
  ruleBody,
  matchesAnyGlob,
  listRuleFiles,
  loadCursor,
  saveCursor,
  resolveClaudeDir,
  resolveStateDir,
};
