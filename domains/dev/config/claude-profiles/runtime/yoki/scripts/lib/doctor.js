'use strict';

/**
 * `yoki-switch doctor` (task T14) — one line per check, `[ok|warn|fail]
 * <target> <check> — <hint>`, exit 1 iff any check reports `fail`. Reads
 * the machine's actual `~/.claude`, `~/.codex`, `~/.omp/agent` state; never
 * writes anything (unlike `gen.js apply`).
 *
 * Every filesystem/parse helper below is a plain function taking explicit
 * paths/text so the target checks are testable against a temp home without
 * touching the real one — see `test/doctor.test.js`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { readJsonIfExists } = require('./targets/layers');
const {
  groupIsOurs,
  isYokiCodexCommand,
  collectHookStateEntries,
  isWrappedHooksJson,
  hookEventsOf,
} = require('./targets/codex-hooks-merge');
const { computeHandlerHash, eventLabelFor, hookStateKey } = require('./targets/codex-trust');
const { stateHome } = require('./state-home');
const externalLinks = require('./external-links');

/** `readJsonIfExists` throws on a parse error (by design, for the "does
 * this parse" checks) — this wraps it for the supporting lookups below
 * (harness-models.json, models_cache.json, omp-doctor.json) where a
 * corrupt file should downgrade one check to a warning, not crash the
 * whole doctor run. */
function readJsonSafe(filePath) {
  try {
    return readJsonIfExists(filePath);
  } catch {
    return null;
  }
}

/** Codex's own on-disk `hooks.json` wraps the event map under a top-level
 * `hooks` key — confirmed against a real, already-trusted `hooks.state`
 * entry (spike S1+S2 Appendix C: the herdr `SessionStart` hash matches only
 * when hashed from `parsed.hooks.SessionStart`, not `parsed.SessionStart`).
 * `codex-hooks-merge.js` now WRITES that shape, so the flat shape on disk
 * means the file predates the fix (or something else wrote it) and Codex is
 * running none of its hooks. This unwrap exists so the group/trust checks
 * can still say something useful about such a file; the shape itself is
 * judged separately and strictly by `checkCodexHooksShape` — never silently
 * accepted here. */
function unwrapHooksJson(parsed) {
  // `null` means "not found or unreadable" to every caller below — keep it
  // distinguishable from an empty-but-present hooks.json.
  if (parsed === null || parsed === undefined) return parsed;
  return hookEventsOf(parsed);
}

const CLAUDE_MERGE_DIRS = ['skills', 'hooks', 'scripts', 'commands', 'agents', 'rules', 'workflows'];
const CODEX_MIN_ERROR_VERSION = '0.147.0';
const CODEX_MIN_WARN_VERSION = '0.150.0';
const OMP_MIN_WARN_VERSION = '18.0.4';

// ---------------------------------------------------------------------------
// result shape
// ---------------------------------------------------------------------------

function result(status, target, check, hint) {
  return { status, target, check, hint: hint || '' };
}

function formatLine(r) {
  return `[${r.status}] ${r.target} ${r.check} — ${r.hint}`;
}

// ---------------------------------------------------------------------------
// pure helpers: version parsing/comparison
// ---------------------------------------------------------------------------

/** First `x.y.z` triple found in arbitrary command output (`"codex-cli
 * 0.147.0"`, `"18.0.4\n"`), or null when none is present. */
function parseSemver(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text == null ? '' : text));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1 / 0 / 1, comparing two version strings (or two parsed `{major,minor,
 * patch}` values); null when either side fails to parse. */
function compareSemver(a, b) {
  const va = typeof a === 'string' ? parseSemver(a) : a;
  const vb = typeof b === 'string' ? parseSemver(b) : b;
  if (!va || !vb) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1;
  }
  return 0;
}

/** true/false when both sides parse, null when `versionText` doesn't. */
function isAtLeast(versionText, minText) {
  const cmp = compareSemver(versionText, minText);
  return cmp === null ? null : cmp >= 0;
}

// ---------------------------------------------------------------------------
// pure helpers: minimal config.toml reading
// ---------------------------------------------------------------------------
//
// Not a general TOML parser — this repo's own generator
// (targets/codex-config-toml.js) is the only writer of the shapes read here,
// and Codex writes `[hooks.state.*]` back in the same shape, so a few
// line-oriented regexes are enough and avoid a hard dependency on a TOML
// library that isn't installed everywhere this runs (see
// mcp-inventory/readers/codex.js's own graceful @iarna/toml fallback for the
// precedent this follows).

const HOOKS_STATE_HEADER_RE = /^\[hooks\.state\.("(?:[^"\\]|\\.)*")\]\s*$/;
const TRUSTED_HASH_RE = /^trusted_hash\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/;

/** `[hooks.state."<key>"]` tables -> their `trusted_hash` value, as a Map
 * keyed by the (JSON-unescaped) key string. */
function parseHooksStateFromToml(text) {
  const states = new Map();
  let currentKey = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = HOOKS_STATE_HEADER_RE.exec(line);
    if (header) {
      try {
        currentKey = JSON.parse(header[1]);
      } catch {
        currentKey = null;
      }
      continue;
    }
    if (/^\[/.test(line)) {
      currentKey = null; // any other table header ends the current hooks.state entry
      continue;
    }
    if (currentKey) {
      const hashMatch = TRUSTED_HASH_RE.exec(line);
      if (hashMatch) states.set(currentKey, JSON.parse(`"${hashMatch[1]}"`));
    }
  }

  return states;
}

/** true/false for `hooks` inside a top-level `[features]` table; null when
 * the table or key is absent. */
function parseFeaturesHooks(text) {
  let inFeatures = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^\[.+\]$/.test(line)) {
      inFeatures = line === '[features]';
      continue;
    }
    if (inFeatures) {
      const m = /^hooks\s*=\s*(true|false)\s*$/.exec(line);
      if (m) return m[1] === 'true';
    }
  }
  return null;
}

/** Bare `key = ...` names declared before the file's first `[table]`
 * header — i.e. genuinely top-level, the same scope Codex requires
 * `default_permissions`/`notify` to live in (spike S3 §1). */
function topLevelKeys(text) {
  const keys = new Set();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (/^\[/.test(line)) break;
    const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** True when `config.toml` declares both `default_permissions` and
 * `sandbox_mode` at the top level — Codex refuses to combine them (S3 §1). */
function hasPermissionsConflict(text) {
  const keys = topLevelKeys(text);
  return keys.has('default_permissions') && keys.has('sandbox_mode');
}

// ---------------------------------------------------------------------------
// pure helper: hooks.json <-> config.toml trust drift
// ---------------------------------------------------------------------------

/**
 * Recomputes the `[hooks.state]` entries the CURRENT `hooksJson` content
 * implies (via the exact same `collectHookStateEntries` the generator uses
 * to write them) and diffs them against what `config.toml` actually has.
 * A key present with a different hash, or missing outright, means Codex
 * will silently skip that handler on `codex exec` until `yoki-switch apply`
 * re-syncs config.toml to the current hooks.json.
 *
 * @param {{hooksJson: object, hooksJsonPath: string, storedStates: Map<string,string>}} args
 * @returns {{total: number, missing: string[], drifted: string[]}}
 */
function detectTrustDrift({ hooksJson, hooksJsonPath, storedStates }) {
  const expected = collectHookStateEntries(hooksJson || {}, hooksJsonPath);
  const missing = [];
  const drifted = [];

  for (const entry of expected) {
    const stored = storedStates.get(entry.key);
    if (stored === undefined) missing.push(entry.key);
    else if (stored !== entry.trustedHash) drifted.push(entry.key);
  }

  return { total: expected.length, missing, drifted };
}

// ---------------------------------------------------------------------------
// pure helper: is our PORT of Codex's hash function still right?
// ---------------------------------------------------------------------------

/**
 * `detectTrustDrift` compares one output of `codex-trust.js`'s port against
 * another output of the same port — it can only catch drift between two
 * applications of the port, never a case where the port itself has diverged
 * from Codex's real `command_hook_hash`. That is a structural hole: the hash
 * is what pre-trusts every yoki handler without a human clicking trust, so a
 * port bug means hooks are silently skipped and doctor reports `ok`.
 *
 * The one piece of independent ground truth available on a real machine is a
 * FOREIGN hook — one yoki did not write (herdr's, say) — that already has a
 * `[hooks.state]` entry Codex itself computed and stored. Recomputing that
 * entry with our port and comparing is a genuine cross-check: both sides no
 * longer come from the same implementation.
 *
 * A mismatch has two possible causes and this cannot tell them apart:
 * either the port has diverged, or that foreign hook's definition changed
 * since Codex trusted it (in which case Codex is refusing to run it too).
 * Both are worth surfacing, so the caller reports a mismatch as a warning
 * naming both readings rather than asserting one.
 *
 * @param {{hooksJson: object, hooksJsonPath: string, storedStates: Map<string,string>}} args
 *   `hooksJson` is the EVENT MAP (already unwrapped).
 * @returns {{checked: number, mismatched: string[]}} `checked` counts the
 *   foreign handlers that had a Codex-written entry to compare against.
 */
function validateTrustHashPort({ hooksJson, hooksJsonPath, storedStates }) {
  const events = hookEventsOf(hooksJson);
  const mismatched = [];
  let checked = 0;

  for (const eventName of Object.keys(events)) {
    const groups = events[eventName];
    if (!Array.isArray(groups)) continue;
    const eventLabel = eventLabelFor(eventName);
    groups.forEach((group, groupIndex) => {
      (group.hooks || []).forEach((handler, handlerIndex) => {
        // Only handlers we did NOT write: ours were hashed by this same port,
        // so comparing them proves nothing.
        if (isYokiCodexCommand(handler && handler.command)) return;
        const key = hookStateKey(hooksJsonPath, eventLabel, groupIndex, handlerIndex);
        const stored = storedStates.get(key);
        if (stored === undefined) return; // Codex never trusted this one — nothing to compare
        checked++;
        const ours = computeHandlerHash({ eventLabel, matcher: group.matcher, handler });
        if (ours !== stored) mismatched.push(key);
      });
    });
  }

  return { checked, mismatched };
}

// ---------------------------------------------------------------------------
// pure helper: hook script paths referenced from a Claude settings.json
// ---------------------------------------------------------------------------

const RUN_WITH_FLAGS_SCRIPT_RE = /run-with-flags\.js"\s+"[^"]*"\s+"([^"]*)"/;
const DIRECT_HOOK_FILE_RE = /~\/\.claude\/hooks\/([\w.-]+\.(?:sh|js))/g;

/** Every hook `command` string from a parsed `settings.json`, in no
 * particular order. */
function extractHookCommands(settings) {
  const commands = [];
  const hooks = settings && settings.hooks;
  if (!hooks || typeof hooks !== 'object') return commands;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const handler of (group && group.hooks) || []) {
        if (handler && typeof handler.command === 'string') commands.push(handler.command);
      }
    }
  }
  return commands;
}

/**
 * @param {string[]} commands from extractHookCommands
 * @returns {{usesRunner: boolean, runnerRelPaths: string[], directHookFiles: string[]}}
 *   `runnerRelPaths` are relative to YOKI_ROOT (run-with-flags.js's second
 *   positional arg); `directHookFiles` are basenames under `~/.claude/hooks/`.
 */
function extractHookScriptRefs(commands) {
  const runnerRelPaths = new Set();
  const directHookFiles = new Set();
  let usesRunner = false;

  for (const command of commands) {
    if (command.includes('run-with-flags.js')) {
      usesRunner = true;
      const m = RUN_WITH_FLAGS_SCRIPT_RE.exec(command);
      if (m && m[1]) runnerRelPaths.add(m[1]);
    }
    let dm;
    DIRECT_HOOK_FILE_RE.lastIndex = 0;
    while ((dm = DIRECT_HOOK_FILE_RE.exec(command))) {
      directHookFiles.add(dm[1]);
    }
  }

  return { usesRunner, runnerRelPaths: [...runnerRelPaths], directHookFiles: [...directHookFiles] };
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// misc fs helpers
// ---------------------------------------------------------------------------

function isBrokenSymlink(p) {
  let lst;
  try {
    lst = fs.lstatSync(p);
  } catch {
    return false; // doesn't exist at all — not "broken", just absent
  }
  return lst.isSymbolicLink() && !fs.existsSync(p);
}

function listEntries(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return null;
  }
}

function runCommand(cmd, args) {
  const proc = spawnSync(cmd, args, { encoding: 'utf8' });
  if (proc.error) return { ok: false, error: proc.error };
  return { ok: proc.status === 0, status: proc.status, stdout: proc.stdout || '', stderr: proc.stderr || '' };
}

// ---------------------------------------------------------------------------
// claude target
// ---------------------------------------------------------------------------

function checkClaudeSymlinks(claudeDir) {
  const missing = [];
  const broken = [];

  for (const dir of CLAUDE_MERGE_DIRS) {
    const p = path.join(claudeDir, dir);
    let lst = null;
    try {
      lst = fs.lstatSync(p);
    } catch {
      missing.push(dir);
      continue;
    }
    if (lst.isSymbolicLink() && !fs.existsSync(p)) broken.push(dir);
  }

  if (missing.length === CLAUDE_MERGE_DIRS.length) {
    return result('warn', 'claude', 'symlinks', `~/.claude not yet applied — none of ${CLAUDE_MERGE_DIRS.join(', ')} exist; run yoki-switch apply`);
  }
  if (broken.length > 0) {
    return result('fail', 'claude', 'symlinks', `broken symlink(s): ${broken.join(', ')} — run yoki-switch apply`);
  }
  if (missing.length > 0) {
    return result('warn', 'claude', 'symlinks', `missing: ${missing.join(', ')} — run yoki-switch apply`);
  }
  return result('ok', 'claude', 'symlinks', `${CLAUDE_MERGE_DIRS.length} merge dirs resolve`);
}

function checkClaudeSettingsJson(settingsPath) {
  try {
    const parsed = readJsonIfExists(settingsPath);
    if (parsed === null) return { check: result('fail', 'claude', 'settings-json', `${settingsPath} not found`), settings: null };
    return { check: result('ok', 'claude', 'settings-json', settingsPath), settings: parsed };
  } catch (err) {
    return { check: result('fail', 'claude', 'settings-json', `${settingsPath}: ${err.message}`), settings: null };
  }
}

function checkClaudeHookScripts(claudeDir, yokiRoot, settings) {
  if (!settings) {
    return result('warn', 'claude', 'hooks-scripts', 'skipped — settings.json unreadable');
  }

  const refs = extractHookScriptRefs(extractHookCommands(settings));
  const missing = [];
  const notExecutable = [];
  let checkedCount = 0;

  if (refs.usesRunner) {
    const runnerPath = path.join(yokiRoot, 'scripts', 'hooks', 'run-with-flags.js');
    checkedCount++;
    if (!fs.existsSync(runnerPath)) missing.push(runnerPath);
  }

  for (const relPath of refs.runnerRelPaths) {
    const abs = path.join(yokiRoot, relPath);
    checkedCount++;
    if (!fs.existsSync(abs)) missing.push(abs);
  }

  for (const basename of refs.directHookFiles) {
    const abs = path.join(claudeDir, 'hooks', basename);
    checkedCount++;
    if (!fs.existsSync(abs)) {
      missing.push(abs);
    } else if (!isExecutable(abs)) {
      notExecutable.push(abs);
    }
  }

  if (checkedCount === 0) {
    return result('ok', 'claude', 'hooks-scripts', 'no hook scripts referenced in settings.json');
  }
  if (missing.length > 0) {
    return result('fail', 'claude', 'hooks-scripts', `${missing.length}/${checkedCount} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}`);
  }
  if (notExecutable.length > 0) {
    return result('warn', 'claude', 'hooks-scripts', `${notExecutable.length}/${checkedCount} not executable: ${notExecutable.slice(0, 3).join(', ')}${notExecutable.length > 3 ? ', …' : ''}`);
  }
  return result('ok', 'claude', 'hooks-scripts', `${checkedCount} script(s) resolve and are executable`);
}

function checkClaudePermissionsJson(claudeDir) {
  const permsPath = path.join(claudeDir, '.yoki', 'permissions.json');
  if (!fs.existsSync(permsPath)) {
    return result('fail', 'claude', 'permissions-json', `${permsPath} not found — run yoki-switch apply`);
  }
  try {
    JSON.parse(fs.readFileSync(permsPath, 'utf8'));
    return result('ok', 'claude', 'permissions-json', permsPath);
  } catch (err) {
    return result('fail', 'claude', 'permissions-json', `${permsPath}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// claude target: external-links.yaml (task T35)
// ---------------------------------------------------------------------------

/** Enabled-pack names from `<claudeDir>/.claude-packs` (yoki-switch's own
 * PACKS_FILE) — same "blank/# lines ignored" format as `enabled_packs()`.
 * An unreadable/missing file just means no packs to check. */
function readEnabledPacks(claudeDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(claudeDir, '.claude-packs'), 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '' && !l.startsWith('#'));
}

/** One declared external link vs. this machine's actual filesystem state:
 * ok (linked, target exists) / warn (src missing on this machine, or not
 * yet linked at all — `yoki-switch apply` hasn't run since it was
 * declared) / fail (dest exists but is a regular file/dir, or a symlink
 * pointing somewhere else). */
function checkExternalLinkEntry(entry) {
  const checkName = `external-link:${entry.dest}`;
  const purposeSuffix = entry.purpose ? ` (${entry.purpose})` : '';

  if (!fs.existsSync(entry.srcExpanded)) {
    return result('warn', 'claude', checkName, `src missing on this machine: ${entry.srcExpanded}${purposeSuffix}`);
  }

  let lst;
  try {
    lst = fs.lstatSync(entry.destPath);
  } catch {
    return result('warn', 'claude', checkName, `not yet linked at ${entry.destPath} — run yoki-switch apply`);
  }

  if (!lst.isSymbolicLink()) {
    return result('fail', 'claude', checkName, `${entry.destPath} exists but is not a symlink — remove it and re-run yoki-switch apply`);
  }

  let linkTarget;
  try {
    linkTarget = fs.readlinkSync(entry.destPath);
  } catch (err) {
    return result('fail', 'claude', checkName, `${entry.destPath}: ${err.message}`);
  }

  const resolvedTarget = path.resolve(path.dirname(entry.destPath), linkTarget);
  const resolvedSrc = path.resolve(entry.srcExpanded);
  if (resolvedTarget !== resolvedSrc) {
    return result('fail', 'claude', checkName, `${entry.destPath} points to ${resolvedTarget}, expected ${resolvedSrc}`);
  }

  return result('ok', 'claude', checkName, `${entry.destPath} -> ${resolvedSrc}`);
}

/**
 * Re-reads the same layered external-links.yaml declarations
 * link_external_resources() consumed at apply time (core -> enabled packs
 * -> personal) and checks each against this machine's actual state.
 * `dotfilesRoot`/`home` missing (e.g. an older caller/test) degrades to a
 * single skipped warning rather than throwing.
 */
function checkClaudeExternalLinks(dotfilesRoot, claudeDir, home) {
  if (!dotfilesRoot) {
    return [result('warn', 'claude', 'external-links', 'skipped — dotfilesRoot not provided')];
  }

  const profilesDir = path.join(dotfilesRoot, 'domains', 'dev', 'config', 'claude-profiles');
  const coreDir = path.join(profilesDir, 'core');
  const packsDir = path.join(profilesDir, 'packs');
  const personalDir = path.join(profilesDir, 'personal');

  if (!fs.existsSync(coreDir)) {
    return [result('warn', 'claude', 'external-links', `skipped — claude-profiles not found at ${profilesDir}`)];
  }

  const sources = [path.join(coreDir, 'external-links.yaml')];
  for (const p of readEnabledPacks(claudeDir)) {
    const packFile = path.join(packsDir, p, 'external-links.yaml');
    if (fs.existsSync(packFile)) sources.push(packFile);
  }
  sources.push(path.join(personalDir, 'external-links.yaml'));

  let entries;
  try {
    entries = externalLinks.loadAndResolve(sources, { home, claudeDir });
  } catch (err) {
    return [result('fail', 'claude', 'external-links', err.message)];
  }

  if (entries.length === 0) {
    return [result('ok', 'claude', 'external-links', 'no external links declared')];
  }
  return entries.map(checkExternalLinkEntry);
}

function checkClaudeTarget({ claudeDir, yokiRoot, dotfilesRoot, home }) {
  if (!fs.existsSync(claudeDir)) {
    return [result('warn', 'claude', 'home', `${claudeDir} does not exist — skipping claude checks`)];
  }

  const settingsCheck = checkClaudeSettingsJson(path.join(claudeDir, 'settings.json'));

  return [
    checkClaudeSymlinks(claudeDir),
    settingsCheck.check,
    checkClaudeHookScripts(claudeDir, yokiRoot, settingsCheck.settings),
    checkClaudePermissionsJson(claudeDir),
    ...checkClaudeExternalLinks(dotfilesRoot, claudeDir, home || os.homedir()),
  ];
}

// ---------------------------------------------------------------------------
// codex target
// ---------------------------------------------------------------------------

function checkCodexVersion() {
  const run = runCommand('codex', ['--version']);
  if (!run.ok && run.error) {
    return result('warn', 'codex', 'version', 'codex not found on PATH — skipped');
  }
  const text = `${run.stdout || ''}${run.stderr || ''}`;
  const version = parseSemver(text);
  if (!version) {
    return result('warn', 'codex', 'version', `could not parse "codex --version" output: ${text.trim()}`);
  }
  const versionText = `${version.major}.${version.minor}.${version.patch}`;
  if (isAtLeast(versionText, CODEX_MIN_ERROR_VERSION) === false) {
    return result('fail', 'codex', 'version', `${versionText} < ${CODEX_MIN_ERROR_VERSION} — trust-hash format assumed by this doctor may not apply; run \`brew upgrade --cask codex\``);
  }
  if (isAtLeast(versionText, CODEX_MIN_WARN_VERSION) === false) {
    return result('warn', 'codex', 'version', `${versionText} < ${CODEX_MIN_WARN_VERSION} — no Interrupt hook; run \`brew upgrade --cask codex\` when convenient`);
  }
  return result('ok', 'codex', 'version', versionText);
}

/**
 * The one check that can tell a working hooks.json from one Codex silently
 * ignores. Codex reads ONLY the wrapped `{"hooks": {<Event>: [...]}}` shape
 * (verified against the real `~/.codex/hooks.json` whose herdr group Codex
 * itself trusted); a flat `{<Event>: [...]}` file parses, passes every other
 * check here, and fires nothing. So it is a `fail`, not a tolerated variant.
 *
 * @param {*} parsedHooksJson the RAW parsed hooks.json (never unwrapped)
 */
function checkCodexHooksShape(parsedHooksJson) {
  if (parsedHooksJson === null || parsedHooksJson === undefined) {
    return result('warn', 'codex', 'hooks-shape', 'hooks.json not found or unreadable');
  }
  if (isWrappedHooksJson(parsedHooksJson)) {
    return result('ok', 'codex', 'hooks-shape', 'wrapped {"hooks":{…}}');
  }
  if (typeof parsedHooksJson === 'object' && !Array.isArray(parsedHooksJson) && Object.keys(parsedHooksJson).length === 0) {
    return result('warn', 'codex', 'hooks-shape', 'hooks.json is empty — run yoki-switch apply');
  }
  return result(
    'fail',
    'codex',
    'hooks-shape',
    'codex hooks.json is not in Codex\'s wrapped {"hooks":{…}} shape — codex ignores it; run yoki-switch apply'
  );
}

function checkCodexHooksGroups(hooksJson) {
  if (hooksJson === null) {
    return { check: result('warn', 'codex', 'hooks-groups', 'hooks.json not found or unreadable'), ourGroupCount: 0, foreignGroups: [] };
  }

  let ourGroupCount = 0;
  const foreignGroups = [];

  for (const [eventName, groups] of Object.entries(hooksJson)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, index) => {
      if (groupIsOurs(group)) {
        ourGroupCount++;
      } else {
        foreignGroups.push(`${eventName}[${index}]${group && group.matcher ? `:${group.matcher}` : ''}`);
      }
    });
  }

  const check = ourGroupCount === 0
    ? result('warn', 'codex', 'hooks-groups', 'no yoki-owned hook groups in hooks.json — run yoki-switch apply --target codex')
    : result('ok', 'codex', 'hooks-groups', `${ourGroupCount} yoki-owned group(s)`);

  return { check, ourGroupCount, foreignGroups };
}

function checkCodexForeignGroups(foreignGroups) {
  if (foreignGroups.length === 0) {
    return result('ok', 'codex', 'foreign-groups', 'none');
  }
  return result('ok', 'codex', 'foreign-groups', `${foreignGroups.length}: ${foreignGroups.join(', ')}`);
}

function checkCodexTrustDrift({ hooksJson, hooksJsonPath, configTomlText }) {
  if (hooksJson === null) {
    return result('warn', 'codex', 'trust-drift', 'skipped — hooks.json not found or unreadable');
  }
  const storedStates = parseHooksStateFromToml(configTomlText);
  const { total, missing, drifted } = detectTrustDrift({ hooksJson, hooksJsonPath, storedStates });

  if (total === 0) {
    return result('ok', 'codex', 'trust-drift', 'no yoki-owned trust entries to check');
  }
  if (missing.length > 0 || drifted.length > 0) {
    const bad = [...missing, ...drifted];
    return result(
      'fail',
      'codex',
      'trust-drift',
      `${bad.length}/${total} mismatched — hooks will be silently skipped by codex exec; run yoki-switch apply (${bad.slice(0, 2).join(', ')}${bad.length > 2 ? ', …' : ''})`
    );
  }
  return result('ok', 'codex', 'trust-drift', `${total} trust hash(es) match`);
}

/**
 * The only non-tautological evidence doctor can offer that
 * `codex-trust.js`'s port still matches Codex's real hash function — see
 * `validateTrustHashPort`. Without it, trust-drift compares the port against
 * itself and would report `ok` on a systematically wrong port.
 */
function checkCodexTrustPort({ hooksJson, hooksJsonPath, configTomlText }) {
  if (hooksJson === null) {
    return result('warn', 'codex', 'trust-port', 'skipped — hooks.json not found or unreadable');
  }
  const storedStates = parseHooksStateFromToml(configTomlText);
  const { checked, mismatched } = validateTrustHashPort({ hooksJson, hooksJsonPath, storedStates });

  if (checked === 0) {
    return result(
      'warn',
      'codex',
      'trust-port',
      'no Codex-written trust entry to check the ported hash function against — ' +
        'the port is corroborated only by lib/targets/test/codex-trust.test.js'
    );
  }
  if (mismatched.length > 0) {
    return result(
      'warn',
      'codex',
      'trust-port',
      `${mismatched.length}/${checked} Codex-written trust hash(es) disagree with yoki's ported hash function ` +
        `(${mismatched.slice(0, 2).join(', ')}${mismatched.length > 2 ? ', …' : ''}) — ` +
        'either lib/targets/codex-trust.js has diverged from Codex (yoki\'s own pre-trusting is then unreliable) ' +
        'or that foreign hook changed since Codex trusted it (Codex is skipping it too)'
    );
  }
  return result('ok', 'codex', 'trust-port', `ported hash matches ${checked} Codex-written entry(ies)`);
}

function checkCodexFeaturesHooks(configTomlText) {
  const value = parseFeaturesHooks(configTomlText);
  if (value === null) return result('warn', 'codex', 'features-hooks', '[features] hooks not set in config.toml');
  if (value === false) return result('fail', 'codex', 'features-hooks', '[features] hooks = false — Codex hooks are disabled');
  return result('ok', 'codex', 'features-hooks', 'true');
}

function checkCodexPermissionsConflict(configTomlText) {
  if (hasPermissionsConflict(configTomlText)) {
    return result('fail', 'codex', 'permissions-conflict', 'config.toml declares both default_permissions and sandbox_mode at the top level — Codex refuses to load this combination (S3 §1)');
  }
  return result('ok', 'codex', 'permissions-conflict', 'no conflict');
}

function checkCodexExecpolicy(codexDir) {
  const rulesPath = path.join(codexDir, 'rules', 'yoki.rules');
  if (!fs.existsSync(rulesPath)) {
    return result('warn', 'codex', 'execpolicy', `${rulesPath} not found — run yoki-switch apply --target codex`);
  }
  const run = runCommand('codex', ['execpolicy', 'check', '--rules', rulesPath, '--', 'echo', 'yoki-doctor-probe']);
  if (!run.ok && run.error) {
    return result('warn', 'codex', 'execpolicy', 'codex execpolicy not available — skipped');
  }
  if (!run.ok) {
    return result('fail', 'codex', 'execpolicy', `${rulesPath} failed to parse: ${(run.stderr || '').trim().split('\n')[0] || `exit ${run.status}`}`);
  }
  return result('ok', 'codex', 'execpolicy', `${rulesPath} parses`);
}

function checkCodexModels(dotfilesRoot, codexDir) {
  const harnessModelsPath = path.join(dotfilesRoot, 'domains', 'dev', 'config', 'claude-profiles', 'core', 'harness-models.json');
  const harnessModels = readJsonSafe(harnessModelsPath);
  const codexTierMap = (harnessModels && harnessModels.codex) || {};
  const tierIds = Object.values(codexTierMap).filter(v => typeof v === 'string');

  if (tierIds.length === 0) {
    return result('warn', 'codex', 'models', `no codex tier map found at ${harnessModelsPath}`);
  }

  const cache = readJsonSafe(path.join(codexDir, 'models_cache.json'));
  const cachedSlugs = new Set((cache && Array.isArray(cache.models) ? cache.models : []).map(m => m && m.slug).filter(Boolean));

  if (cachedSlugs.size === 0) {
    return result('warn', 'codex', 'models', 'models_cache.json not found or empty — skipped');
  }

  const missing = tierIds.filter(id => !cachedSlugs.has(id));
  if (missing.length > 0) {
    return result('warn', 'codex', 'models', `not in models_cache.json: ${missing.join(', ')} — update core/harness-models.json`);
  }
  return result('ok', 'codex', 'models', `${tierIds.length} tier model(s) present in models_cache.json`);
}

function checkSkillDirBrokenLinks(dirPath) {
  const entries = listEntries(dirPath);
  if (entries === null) return { exists: false, broken: [] };
  const broken = entries.filter(name => isBrokenSymlink(path.join(dirPath, name)));
  return { exists: true, broken };
}

function checkCodexSkillsDirs(codexDir, home) {
  const codexSkills = checkSkillDirBrokenLinks(path.join(codexDir, 'skills'));
  const agentsSkills = checkSkillDirBrokenLinks(path.join(home, '.agents', 'skills'));

  if (!codexSkills.exists && !agentsSkills.exists) {
    return result('warn', 'codex', 'skills-dirs', 'neither ~/.codex/skills nor ~/.agents/skills exist — run yoki-switch apply');
  }
  const broken = [...codexSkills.broken, ...agentsSkills.broken];
  if (broken.length > 0) {
    return result('fail', 'codex', 'skills-dirs', `broken symlink(s): ${broken.slice(0, 3).join(', ')}${broken.length > 3 ? ', …' : ''}`);
  }
  return result('ok', 'codex', 'skills-dirs', 'skill symlinks resolve');
}

function checkAgentsSkillsCount(home) {
  const dirPath = path.join(home, '.agents', 'skills');
  const entries = listEntries(dirPath);
  if (entries === null) {
    return result('warn', 'codex', 'agents-skills-count', `${dirPath} does not exist`);
  }
  return result('ok', 'codex', 'agents-skills-count', `${entries.length} link(s) in ${dirPath}`);
}

function checkCodexTarget({ codexDir, home, dotfilesRoot }) {
  const results = [checkCodexVersion()];

  if (!fs.existsSync(codexDir)) {
    results.push(result('warn', 'codex', 'home', `${codexDir} does not exist — skipping remaining codex checks`));
    return results;
  }
  results.push(result('ok', 'codex', 'home', codexDir));

  const configTomlText = fs.existsSync(path.join(codexDir, 'config.toml'))
    ? fs.readFileSync(path.join(codexDir, 'config.toml'), 'utf8')
    : '';
  const hooksJsonPath = path.join(codexDir, 'hooks.json');
  const rawHooksJson = readJsonSafe(hooksJsonPath);
  const hooksJson = unwrapHooksJson(rawHooksJson);

  results.push(checkCodexFeaturesHooks(configTomlText));
  results.push(checkCodexHooksShape(rawHooksJson));

  const groupsCheck = checkCodexHooksGroups(hooksJson);
  results.push(groupsCheck.check);
  results.push(checkCodexTrustDrift({ hooksJson, hooksJsonPath, configTomlText }));
  results.push(checkCodexTrustPort({ hooksJson, hooksJsonPath, configTomlText }));
  results.push(checkCodexForeignGroups(groupsCheck.foreignGroups));
  results.push(checkCodexExecpolicy(codexDir));
  results.push(checkCodexPermissionsConflict(configTomlText));
  results.push(checkCodexModels(dotfilesRoot, codexDir));
  results.push(checkCodexSkillsDirs(codexDir, home));
  results.push(checkAgentsSkillsCount(home));

  return results;
}

// ---------------------------------------------------------------------------
// omp target
// ---------------------------------------------------------------------------

function checkOmpVersion() {
  const run = runCommand('omp', ['--version']);
  if (!run.ok && run.error) {
    return result('warn', 'omp', 'version', 'omp not found on PATH — skipped');
  }
  const text = `${run.stdout || ''}${run.stderr || ''}`;
  const version = parseSemver(text);
  if (!version) {
    return result('warn', 'omp', 'version', `could not parse "omp --version" output: ${text.trim()}`);
  }
  const versionText = `${version.major}.${version.minor}.${version.patch}`;
  if (isAtLeast(versionText, OMP_MIN_WARN_VERSION) === false) {
    return result('warn', 'omp', 'version', `${versionText} < ${OMP_MIN_WARN_VERSION} — upgrade omp when convenient`);
  }
  return result('ok', 'omp', 'version', versionText);
}

function checkOmpExtensionSymlink(ompAgentDir) {
  const p = path.join(ompAgentDir, 'extensions', 'yoki-bridge.ts');
  if (!fs.existsSync(p)) {
    if (isBrokenSymlink(p)) return result('fail', 'omp', 'extension-symlink', `${p} is a broken symlink — run yoki-switch apply --target omp`);
    return result('fail', 'omp', 'extension-symlink', `${p} not found — run yoki-switch apply --target omp`);
  }
  return result('ok', 'omp', 'extension-symlink', p);
}

function checkOmpConfigYml(ompAgentDir) {
  const p = path.join(ompAgentDir, 'config.yml');
  let lst;
  try {
    lst = fs.lstatSync(p);
  } catch {
    return result('fail', 'omp', 'config-yml', `${p} not found — run yoki-switch apply --target omp`);
  }
  if (lst.isSymbolicLink()) {
    return result('warn', 'omp', 'config-yml', `${p} is still a symlink — run yoki-switch apply --target omp to write the generated file`);
  }
  const text = fs.readFileSync(p, 'utf8');
  if (!text.includes('GENERATED by yoki')) {
    return result('warn', 'omp', 'config-yml', `${p} is a regular file but has no "GENERATED by yoki" marker — hand-edited or stale?`);
  }
  return result('ok', 'omp', 'config-yml', `${p} is a generated regular file`);
}

function checkOmpYokiHooksJson(ompAgentDir) {
  const p = path.join(ompAgentDir, 'yoki-hooks.json');
  if (!fs.existsSync(p)) {
    return result('warn', 'omp', 'yoki-hooks-json', `${p} not found — run yoki-switch apply --target omp`);
  }
  try {
    JSON.parse(fs.readFileSync(p, 'utf8'));
    return result('ok', 'omp', 'yoki-hooks-json', p);
  } catch (err) {
    return result('fail', 'omp', 'yoki-hooks-json', `${p}: ${err.message}`);
  }
}

/** Substitutes `omp-doctor.json`'s `{home}`/`{claudeHome}`/`{userHome}`
 * placeholders and checks readability of the `generated` (this target's own
 * output — must exist) and `readOnlyByOmpItself` (omp reads these on its
 * own, so they should exist even though this target never writes them)
 * lists. `notReadByOmp` is documentation only (omp deliberately never reads
 * those paths) and is not probed. */
function checkOmpDoctorProbePaths({ ompDoctorJsonPath, ompAgentDir, claudeDir, home }) {
  const spec = readJsonSafe(ompDoctorJsonPath);
  if (!spec) return result('warn', 'omp', 'doctor-probe-paths', `${ompDoctorJsonPath} not found or unreadable`);

  const substitute = p => p.replace('{home}', ompAgentDir).replace('{claudeHome}', claudeDir).replace('{userHome}', home);
  const candidates = [...(spec.generated || []), ...(spec.readOnlyByOmpItself || [])].map(substitute);

  const unreadable = candidates.filter(p => {
    try {
      fs.accessSync(p, fs.constants.R_OK);
      return false;
    } catch {
      return true;
    }
  });

  if (unreadable.length === 0) {
    return result('ok', 'omp', 'doctor-probe-paths', `${candidates.length} path(s) readable`);
  }
  return result('warn', 'omp', 'doctor-probe-paths', `unreadable: ${unreadable.slice(0, 3).join(', ')}${unreadable.length > 3 ? ', …' : ''}`);
}

function checkOmpZshWrapper(functionsZshPath) {
  if (!fs.existsSync(functionsZshPath)) {
    return result('warn', 'omp', 'zsh-wrapper', `${functionsZshPath} not found`);
  }
  const text = fs.readFileSync(functionsZshPath, 'utf8');
  if (!text.includes('--no-extensions -e')) {
    return result('warn', 'omp', 'zsh-wrapper', `${functionsZshPath} has no "--no-extensions -e" omp() wrapper — omp would start unguarded`);
  }
  return result('ok', 'omp', 'zsh-wrapper', functionsZshPath);
}

function checkOmpTarget({ ompAgentDir, claudeDir, home, dotfilesRoot, yokiRoot }) {
  const results = [checkOmpVersion()];

  if (!fs.existsSync(ompAgentDir)) {
    results.push(result('warn', 'omp', 'home', `${ompAgentDir} does not exist — skipping remaining omp checks`));
    return results;
  }
  results.push(result('ok', 'omp', 'home', ompAgentDir));

  results.push(checkOmpExtensionSymlink(ompAgentDir));
  results.push(checkOmpConfigYml(ompAgentDir));
  results.push(checkOmpYokiHooksJson(ompAgentDir));
  results.push(checkOmpDoctorProbePaths({
    ompDoctorJsonPath: path.join(yokiRoot, 'scripts', 'lib', 'targets', 'omp-doctor.json'),
    ompAgentDir,
    claudeDir,
    home,
  }));
  results.push(checkOmpZshWrapper(path.join(dotfilesRoot, 'domains', 'dev', 'shell', 'zsh', 'functions.zsh')));

  return results;
}

// ---------------------------------------------------------------------------
// artifact target
// ---------------------------------------------------------------------------

function findYokiArtifactInvocation(dotfilesRoot) {
  const onPath = runCommand('yoki-artifact', ['--help']);
  if (!(onPath.error && onPath.error.code === 'ENOENT')) {
    return { cmd: 'yoki-artifact', args: [] };
  }
  const scriptPath = path.join(dotfilesRoot, 'domains', 'dev', 'config', 'claude-profiles', 'core', 'skills', 'yoki-artifact', 'bin', 'yoki-artifact.mjs');
  if (fs.existsSync(scriptPath)) {
    return { cmd: 'node', args: [scriptPath] };
  }
  return null;
}

function checkArtifactTarget({ dotfilesRoot }) {
  const invocation = findYokiArtifactInvocation(dotfilesRoot);
  if (!invocation) {
    return [result('ok', 'artifact', 'yoki-artifact', 'not installed — skipped')];
  }

  const run = runCommand(invocation.cmd, [...invocation.args, 'doctor', '--json']);
  if (run.error) {
    return [result('warn', 'artifact', 'yoki-artifact', `could not run yoki-artifact doctor: ${run.error.message}`)];
  }

  let parsed;
  try {
    parsed = JSON.parse(run.stdout);
  } catch (err) {
    return [result('fail', 'artifact', 'yoki-artifact', `doctor --json produced invalid JSON: ${err.message}`)];
  }

  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  if (checks.length === 0) {
    return [result(parsed.ok ? 'ok' : 'fail', 'artifact', 'yoki-artifact', parsed.ok ? 'no checks reported' : 'doctor reported failure with no checks')];
  }
  return checks.map(c => result(c.ok ? 'ok' : 'fail', 'artifact', c.name || 'check', c.detail || ''));
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

function defaultYokiRoot() {
  return path.resolve(__dirname, '..', '..');
}

function defaultDotfilesRoot(yokiRoot) {
  return path.resolve(yokiRoot, '..', '..', '..', '..', '..', '..');
}

/**
 * @param {{home?: string, claudeDir?: string, codexDir?: string,
 *   ompAgentDir?: string, yokiRoot?: string, dotfilesRoot?: string}} options
 * @returns {Array<{status: 'ok'|'warn'|'fail', target: string, check: string, hint: string}>}
 */
// ---------------------------------------------------------------------------
// state home
// ---------------------------------------------------------------------------

/**
 * `lib/state-home.js` consolidated five state paths onto one XDG resolution.
 * `lib/graph/journal.js` was the odd one out: it ignored `XDG_STATE_HOME`
 * entirely, so on a machine that sets that variable its run journals sat
 * under `~/.local/state/yoki/graph` while every other state file had already
 * moved. Fixing it forward relocates the graph journals — and with them
 * `yoki-graph`'s resume cache and run history — with no migration step.
 *
 * Nothing here moves data: a state directory is the user's, and silently
 * copying run history somewhere else is not doctor's call. It just refuses
 * to let the relocation be invisible, which is the actual finding.
 */
function checkStateHomeRelocation({ home, env }) {
  const environment = env || process.env;
  const effective = stateHome(environment);
  const legacy = path.join(home, '.local', 'state');

  if (path.resolve(effective) === path.resolve(legacy)) {
    return result('ok', 'yoki', 'state-home', effective);
  }

  const strandedGraph = path.join(legacy, 'yoki', 'graph');
  const stranded = [];
  for (const [label, dir] of [['graph', strandedGraph], ['loop', path.join(legacy, 'yoki', 'loop')]]) {
    try {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) stranded.push(`${label} (${dir})`);
    } catch {
      // unreadable is not evidence of content — say nothing about it
    }
  }

  if (stranded.length === 0) {
    return result('ok', 'yoki', 'state-home', `${effective} (XDG_STATE_HOME); nothing left at ${legacy}`);
  }
  return result(
    'warn',
    'yoki',
    'state-home',
    `state now resolves to ${effective}, but run history is still at the pre-XDG location: ${stranded.join(', ')} — ` +
      'yoki-graph resume cache / yoki-loop history and daily-cap counters start from zero at the new path; ' +
      'move or delete the old directory deliberately'
  );
}

function runDoctor(options = {}) {
  const home = options.home || os.homedir();
  const yokiRoot = options.yokiRoot || defaultYokiRoot();
  const dotfilesRoot = options.dotfilesRoot || defaultDotfilesRoot(yokiRoot);
  const claudeDir = options.claudeDir || path.join(home, '.claude');
  const codexDir = options.codexDir || path.join(home, '.codex');
  const ompAgentDir = options.ompAgentDir || path.join(home, '.omp', 'agent');

  return [
    ...checkClaudeTarget({ claudeDir, yokiRoot, dotfilesRoot, home }),
    ...checkCodexTarget({ codexDir, home, dotfilesRoot }),
    ...checkOmpTarget({ ompAgentDir, claudeDir, home, dotfilesRoot, yokiRoot }),
    ...checkArtifactTarget({ dotfilesRoot }),
    checkStateHomeRelocation({ home, env: options.env }),
  ];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { json: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--json':
        options.json = true;
        break;
      case '--home':
        options.home = argv[++i];
        break;
      case '--claude-dir':
        options.claudeDir = argv[++i];
        break;
      case '--codex-dir':
        options.codexDir = argv[++i];
        break;
      case '--omp-dir':
        options.ompAgentDir = argv[++i];
        break;
      case '--dotfiles-root':
        options.dotfilesRoot = argv[++i];
        break;
      case '--yoki-root':
        options.yokiRoot = argv[++i];
        break;
      default:
        break;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = runDoctor(options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    for (const r of results) process.stdout.write(`${formatLine(r)}\n`);
  }

  process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
}

module.exports = {
  runDoctor,
  formatLine,
  parseArgs,
  // pure helpers, exported for tests
  parseSemver,
  compareSemver,
  isAtLeast,
  parseHooksStateFromToml,
  parseFeaturesHooks,
  hasPermissionsConflict,
  detectTrustDrift,
  validateTrustHashPort,
  unwrapHooksJson,
  checkCodexHooksShape,
  checkCodexTrustPort,
  extractHookCommands,
  extractHookScriptRefs,
  // per-target orchestrators, exported for tests with temp homes
  checkClaudeTarget,
  checkCodexTarget,
  checkOmpTarget,
  checkArtifactTarget,
  checkStateHomeRelocation,
  // T35: external-links.yaml checks, exported for tests
  readEnabledPacks,
  checkExternalLinkEntry,
  checkClaudeExternalLinks,
};

if (require.main === module) {
  main();
}
