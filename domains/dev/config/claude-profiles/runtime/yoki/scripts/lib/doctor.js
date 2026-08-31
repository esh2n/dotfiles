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
const { groupIsOurs, collectHookStateEntries } = require('./targets/codex-hooks-merge');

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
 * `codex-hooks-merge.js`'s own generator/tests operate on the unwrapped
 * shape directly, so accept both here rather than assume either is "the"
 * format this doctor will ever see on disk. */
function unwrapHooksJson(parsed) {
  if (parsed && typeof parsed === 'object' && parsed.hooks && typeof parsed.hooks === 'object') {
    return parsed.hooks;
  }
  return parsed;
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

function checkClaudeTarget({ claudeDir, yokiRoot }) {
  if (!fs.existsSync(claudeDir)) {
    return [result('warn', 'claude', 'home', `${claudeDir} does not exist — skipping claude checks`)];
  }

  const settingsCheck = checkClaudeSettingsJson(path.join(claudeDir, 'settings.json'));

  return [
    checkClaudeSymlinks(claudeDir),
    settingsCheck.check,
    checkClaudeHookScripts(claudeDir, yokiRoot, settingsCheck.settings),
    checkClaudePermissionsJson(claudeDir),
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
    return result('fail', 'codex', 'version', `${versionText} < ${CODEX_MIN_ERROR_VERSION} — trust-hash format assumed by this doctor may not apply; upgrade codex`);
  }
  if (isAtLeast(versionText, CODEX_MIN_WARN_VERSION) === false) {
    return result('warn', 'codex', 'version', `${versionText} < ${CODEX_MIN_WARN_VERSION} — no Interrupt hook; upgrade codex when convenient`);
  }
  return result('ok', 'codex', 'version', versionText);
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
  const hooksJson = unwrapHooksJson(readJsonSafe(hooksJsonPath));

  results.push(checkCodexFeaturesHooks(configTomlText));

  const groupsCheck = checkCodexHooksGroups(hooksJson);
  results.push(groupsCheck.check);
  results.push(checkCodexTrustDrift({ hooksJson, hooksJsonPath, configTomlText }));
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
function runDoctor(options = {}) {
  const home = options.home || os.homedir();
  const yokiRoot = options.yokiRoot || defaultYokiRoot();
  const dotfilesRoot = options.dotfilesRoot || defaultDotfilesRoot(yokiRoot);
  const claudeDir = options.claudeDir || path.join(home, '.claude');
  const codexDir = options.codexDir || path.join(home, '.codex');
  const ompAgentDir = options.ompAgentDir || path.join(home, '.omp', 'agent');

  return [
    ...checkClaudeTarget({ claudeDir, yokiRoot }),
    ...checkCodexTarget({ codexDir, home, dotfilesRoot }),
    ...checkOmpTarget({ ompAgentDir, claudeDir, home, dotfilesRoot, yokiRoot }),
    ...checkArtifactTarget({ dotfilesRoot }),
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
  unwrapHooksJson,
  extractHookCommands,
  extractHookScriptRefs,
  // per-target orchestrators, exported for tests with temp homes
  checkClaudeTarget,
  checkCodexTarget,
  checkOmpTarget,
  checkArtifactTarget,
};

if (require.main === module) {
  main();
}
