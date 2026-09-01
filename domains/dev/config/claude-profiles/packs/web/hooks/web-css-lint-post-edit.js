#!/usr/bin/env node
/**
 * PostToolUse Hook: stylelint / html-validate after editing a stylesheet or
 * markup file.
 *
 * Profile: standard (registered "standard,strict" — does not run at "minimal").
 *
 * Triggers only on `.css`/`.scss`/`.sass`/`.less` (stylelint) and
 * `.html`/`.htm` (html-validate). Everything else passes through with zero
 * exec calls. For a matching file, this walks up from the file's directory
 * looking for a project-owned lint config; if none exists, the project has
 * not opted in and this never lints with an imposed config (see
 * packs/web/rules/web/hooks.md, "project config or nothing").
 *
 * When a config is found, the linter binary is resolved preferring the
 * project's own `node_modules/.bin/<tool>` (walked up from the config
 * directory) over a bare name on PATH. Output is filtered to lines that
 * mention the edited file (same technique as go-guard-post-edit.js), capped
 * at 10 lines, and printed to stderr with a `[web-guard]` prefix only when
 * there is something to report.
 *
 * If a config exists but the linter binary is nowhere to be found (neither
 * local nor PATH), this prints one hint line at most (marker file in
 * os.tmpdir()) and exits 0 — it never blocks the edit. If no config is
 * found at all, this is silent at the `standard` profile and prints one
 * hint line at most at `strict`, suggesting a config be added.
 *
 * Registration note: this hook does NOT go through run-with-flags.js — see
 * packs/go/hooks/go-guard-post-edit.js and packs/go/rules/golang/hooks.md
 * for why (pack-owned hooks are merged into ~/.claude/hooks/ by
 * yoki-switch's MERGE_DIRS, a location run-with-flags.js's CLAUDE_PLUGIN_ROOT
 * path-traversal guard can never resolve into). Instead this hook is
 * registered as a direct `node ...` command in packs/web/settings.layer.json
 * and performs its own profile gating below by calling the same
 * runtime/yoki/scripts/lib/hook-flags.js the runner itself uses.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const MAX_LINES = 10;
const TIMEOUT_MS = 30000;
const HOOK_ID = 'post:web-guard:post-edit';
const PROFILES = 'standard,strict';
const MAX_WALK = 50;

const CSS_EXTS = new Set(['.css', '.scss', '.sass', '.less']);
const HTML_EXTS = new Set(['.html', '.htm']);

const TOOLS = {
  css: {
    label: 'stylelint',
    binName: 'stylelint',
    configFiles: [
      '.stylelintrc',
      '.stylelintrc.json',
      '.stylelintrc.yaml',
      '.stylelintrc.yml',
      '.stylelintrc.js',
      '.stylelintrc.cjs',
      '.stylelintrc.mjs',
      'stylelint.config.js',
      'stylelint.config.cjs',
      'stylelint.config.mjs'
    ],
    pkgKey: 'stylelint',
    args: file => [file, '--formatter', 'compact']
  },
  html: {
    label: 'html-validate',
    binName: 'html-validate',
    configFiles: ['.htmlvalidate.json', '.htmlvalidate.js', '.htmlvalidate.cjs'],
    pkgKey: null,
    args: file => [file]
  }
};

function defaultExec(cmd, args, opts) {
  return execFileSync(cmd, args, opts);
}

// Loads the shared profile-gating module from the runtime/yoki checkout this
// machine has configured (YOKI_ROOT / CLAUDE_PLUGIN_ROOT are always set by
// settings.json's global `env` block). Fails open (hook enabled, profile
// treated as "standard") if it can't be found, so a misconfigured machine
// never silently loses lint coverage.
function loadHookFlags() {
  try {
    const root = process.env.YOKI_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (root) {
      return require(path.join(root, 'scripts', 'lib', 'hook-flags.js'));
    }
  } catch {
    // fall through to fail-open stub below
  }
  return { isHookEnabled: () => true, getHookProfile: () => 'standard' };
}

function markerPath(name) {
  return path.join(os.tmpdir(), `yoki-web-guard-${name}-warned`);
}

function warnOnceAtMarker(marker, message) {
  try {
    if (fs.existsSync(marker)) return;
    fs.writeFileSync(marker, String(Date.now()));
  } catch {
    // best-effort marker; still show the warning once for this invocation
  }
  process.stderr.write(message);
}

/**
 * Walk up from `startDir` looking for a lint config owned by the project.
 * Returns the directory containing the first match, or null if none found
 * all the way to the filesystem root.
 */
function findConfigDir(startDir, tool) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK; i++) {
    for (const cfg of tool.configFiles) {
      if (fs.existsSync(path.join(dir, cfg))) return dir;
    }
    if (tool.pkgKey) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg && Object.prototype.hasOwnProperty.call(pkg, tool.pkgKey)) {
            return dir;
          }
        } catch {
          // malformed package.json — keep walking, it's not a config hit
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Walk up from `startDir` looking for `node_modules/.bin/<binName>`. This
 * covers both a config sitting next to node_modules and hoisted-workspace
 * layouts where node_modules lives above the config directory.
 */
function resolveLocalBin(startDir, binName) {
  const exe = process.platform === 'win32' ? `${binName}.cmd` : binName;
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK; i++) {
    const candidate = path.join(dir, 'node_modules', '.bin', exe);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runTool(execFn, cmd, args, cwd, timeoutMs) {
  try {
    const out = execFn(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs
    });
    return { output: String(out || ''), missing: false };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { output: '', missing: true };
    }
    const output = String((err && err.stdout) || '') + String((err && err.stderr) || '');
    return { output, missing: false };
  }
}

function filterRelevantLines(output, filePath, cwd) {
  if (!output) return [];
  const abs = path.resolve(filePath);
  const rel = path.relative(cwd, abs);
  const base = path.basename(filePath);
  const candidates = [abs, rel, base, filePath].filter(Boolean);

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => candidates.some(c => line.includes(c)))
    .slice(0, MAX_LINES);
}

function toolFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (CSS_EXTS.has(ext)) return TOOLS.css;
  if (HTML_EXTS.has(ext)) return TOOLS.html;
  return null;
}

/**
 * Core check, independent of stdin/JSON — the seam used by tests via DI.
 *
 * @param {string} filePath - edited file path (absolute or relative)
 * @param {object} [opts]
 * @param {Function} [opts.execFn] - execFileSync-compatible (cmd, args, options) => stdout
 * @param {{isHookEnabled: Function, getHookProfile: Function}} [opts.hookFlags]
 * @param {string} [opts.noConfigMarkerPath] - override for the "no config" hint marker
 * @param {string} [opts.noBinMarkerPath] - override for the "no binary" hint marker
 * @returns {string[]} lines to print to stderr ([] = nothing to report)
 */
function checkWebFile(filePath, opts = {}) {
  const execFn = opts.execFn || defaultExec;
  const hookFlags = opts.hookFlags || loadHookFlags();

  const tool = filePath ? toolFor(filePath) : null;
  if (!tool) return [];

  if (!hookFlags.isHookEnabled(HOOK_ID, { profiles: PROFILES })) {
    return [];
  }

  const dir = path.dirname(path.resolve(filePath));
  const configDir = findConfigDir(dir, tool);

  if (!configDir) {
    const profile = hookFlags.getHookProfile ? hookFlags.getHookProfile() : 'standard';
    if (profile === 'strict') {
      const marker = opts.noConfigMarkerPath || markerPath(`no-config-${tool.label}`);
      warnOnceAtMarker(
        marker,
        `[web-guard] no ${tool.label} config found; add one to review ${tool.label === 'stylelint' ? 'CSS' : 'HTML'} on edit (project decides, this never lints unconfigured)\n`
      );
    }
    return [];
  }

  const localBin = resolveLocalBin(configDir, tool.binName);
  const cmd = localBin || tool.binName;
  const result = runTool(execFn, cmd, tool.args(filePath), configDir, TIMEOUT_MS);

  if (result.missing) {
    const marker = opts.noBinMarkerPath || markerPath(`no-bin-${tool.binName}`);
    warnOnceAtMarker(
      marker,
      `[web-guard] '${tool.binName}' not found (checked node_modules/.bin and PATH); skipping\n`
    );
    return [];
  }

  return filterRelevantLines(result.output, filePath, configDir);
}

function extractFilePath(raw) {
  try {
    const input = JSON.parse(raw);
    return String((input.tool_input && input.tool_input.file_path) || '');
  } catch {
    return '';
  }
}

/**
 * Appends `chunk` to `current`, truncating so the result never exceeds
 * `max` characters. Extracted so the stdin-cap behavior is unit-testable
 * without spawning the hook as a subprocess.
 */
function appendCapped(current, chunk, max) {
  if (current.length >= max) return current;
  return current + String(chunk).substring(0, max - current.length);
}

function main(raw) {
  const filePath = extractFilePath(raw);
  const lines = checkWebFile(filePath);
  if (lines.length > 0) {
    process.stderr.write(`[web-guard] lint findings in ${path.basename(filePath)}:\n`);
    for (const line of lines) process.stderr.write(`${line}\n`);
  }
}

if (require.main === module) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    data = appendCapped(data, chunk, MAX_STDIN);
  });
  process.stdin.on('end', () => {
    try {
      main(data);
    } catch {
      // never block the tool call over a hook bug
    }
    process.stdout.write(data);
    process.exit(0);
  });
}

module.exports = {
  checkWebFile,
  extractFilePath,
  filterRelevantLines,
  findConfigDir,
  resolveLocalBin,
  appendCapped,
  main,
  HOOK_ID,
  PROFILES
};
