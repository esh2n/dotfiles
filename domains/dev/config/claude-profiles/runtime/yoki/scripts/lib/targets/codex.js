'use strict';

/**
 * Codex CLI install-target generator (task T9). Walks the layered
 * `claude-profiles` source roots (`--sources <core>,<pack…>,<personal>`,
 * same order as yoki-switch) and produces the operation plan described in
 * scratchpad spikes S1+S2 (hooks/trust), S3 (rules/permissions) and S6
 * (interface). `gen.js` is the CLI/`apply()` half; this module only
 * computes `plan()` — every op is `{kind, destinationPath, sourcePath?,
 * content?, layer}`, matching S6's "Minimal generator interface".
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const { convert: convertPermissions } = require('../permissions/to-codex');
const { resolveGuardFloor } = require('../permissions/parse');
const {
  readJsonIfExists,
  readTextIfExists,
  findSettingsFile,
  findClaudeMdFile,
  listMarkdownFilesRecursive,
  listMarkdownFilesFlat,
  listSkillDirs,
} = require('./layers');
const { buildGeneratedGroups, mergeHooksJson, collectHookStateEntries } = require('./codex-hooks-merge');
const { buildManagedBlockContent, applyManagedBlock, BLOCK_START, BLOCK_END } = require('./codex-config-toml');
const { agentMarkdownToToml } = require('./codex-agents');
const { hasPathsFrontmatter, buildAgentsMdBlockContent, applyAgentsMdBlock } = require('./codex-agents-md');
const { decideSkillSymlink, commandToSkill } = require('./codex-skills');
const { extractBlock } = require('./managed-block');
const { manifestRelativePath, manifestPathFor, buildPruneOperations } = require('./manifest');
const { loadAndMerge: loadAndMergeMcp, resolveHome: resolveMcpHome } = require('../mcp-inventory/source');
const { buildMcpServersToml } = require('../mcp-inventory/writers/codex');

const vocab = require('./vocab.json');

const MANIFEST_RELATIVE_PATH = manifestRelativePath('codex');

/** Hook events this generator knows how to translate (codex-hooks-merge.js's
 * `KNOWN_EVENTS`) but that only exist on Codex CLI versions at/after a given
 * floor — keyed here rather than in codex-hooks-merge.js because gating
 * needs the installed `codex --version`, which that module (pure
 * translation, no shell-out) never sees. `Interrupt` (T32) shipped in
 * 0.150.0; see `core/README.md`'s Targets section and `homebrew.nix`'s
 * codex cask comment for the same floor. */
const EVENT_MIN_CODEX_VERSION = Object.freeze({
  Interrupt: '0.150.0',
});

/** First `x.y.z` triple in arbitrary `codex --version` output
 * (`"codex-cli 0.150.0"`), or null when none is present — mirrors
 * `doctor.js`'s `parseSemver` (kept separate to avoid a cross-module
 * dependency for one regex). */
function parseCodexVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text == null ? '' : text));
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** -1/0/1 comparing two `x.y.z` version strings; null when either fails to
 * parse as three dot-separated integers. */
function compareVersions(a, b) {
  const pa = String(a || '').split('.').map(Number);
  const pb = String(b || '').split('.').map(Number);
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Runs `codex --version` and returns the parsed `x.y.z`, or null when the
 * binary is missing, exits non-zero, or prints something unparseable —
 * treated the same as "installed version unknown" by
 * `isEventSupportedByVersion` below, never thrown. */
function detectInstalledCodexVersion() {
  let proc;
  try {
    proc = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  } catch {
    return null;
  }
  if (!proc || proc.error || proc.status !== 0) return null;
  return parseCodexVersion(`${proc.stdout || ''}${proc.stderr || ''}`);
}

/** True when `eventName` has no version floor, or the installed version
 * meets it. An unknown installed version (codex missing, or unparseable
 * `--version` output) is treated as NOT meeting a floor — conservative, so
 * a hook this generator cannot confirm Codex will honor is skipped (with a
 * warning) rather than silently shipped into hooks.json. */
function isEventSupportedByVersion(eventName, installedVersion) {
  const minVersion = EVENT_MIN_CODEX_VERSION[eventName];
  if (!minVersion) return true;
  if (!installedVersion) return false;
  const cmp = compareVersions(installedVersion, minVersion);
  return cmp !== null && cmp >= 0;
}

/**
 * Drops hook groups for version-gated events (`EVENT_MIN_CODEX_VERSION`)
 * the installed Codex CLI doesn't support yet, from a COPY of each settings
 * layer (coding-style.md: never mutate) — everything else in the layer
 * passes through untouched. One warning per stripped event per layer, so a
 * dropped `Interrupt` hook is reported the same way an unrecognized command
 * is (see codex-hooks-merge.js's own `skip()`), never silently absent from
 * the plan.
 *
 * @param {Array<object>} settingsLayers parsed settings.layer/personal.json
 * @param {string|null} installedVersion from detectInstalledCodexVersion() /
 *   the `codexVersion` plan() override
 * @returns {{settingsLayers: Array<object>, warnings: string[]}}
 */
function filterVersionGatedEvents(settingsLayers, installedVersion) {
  const warnings = [];
  const filtered = settingsLayers.map(layer => {
    if (!layer || !layer.hooks) return layer;
    let changed = false;
    const hooks = {};
    for (const [eventName, groups] of Object.entries(layer.hooks)) {
      if (
        Object.prototype.hasOwnProperty.call(EVENT_MIN_CODEX_VERSION, eventName)
        && !isEventSupportedByVersion(eventName, installedVersion)
      ) {
        changed = true;
        const minVersion = EVENT_MIN_CODEX_VERSION[eventName];
        warnings.push(
          `codex: "${eventName}" hook requires codex >= ${minVersion} (installed: ${installedVersion || 'unknown'}) — skipped; run \`brew upgrade --cask codex\` to enable it`
        );
        continue;
      }
      hooks[eventName] = groups;
    }
    return changed ? { ...layer, hooks } : layer;
  });
  return { settingsLayers: filtered, warnings };
}

/** YOKI_ROOT as derived from this file's own location, used when the caller
 * doesn't override it: `.../runtime/yoki/scripts/lib/targets/codex.js` ->
 * `.../runtime/yoki`. */
function defaultYokiRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

/** Loads every layer's settings hooks + permissions.yaml + CLAUDE*.md +
 * agents/commands/rules/skills into flat, order-preserving lists — no
 * precedence resolution here beyond "later layer overwrites the same
 * key/name", matching `core/rules/README.md`'s "personal always wins". */
function discoverLayerContent(layerRoots) {
  const settingsLayers = [];
  const permissionsFiles = [];
  let claudeLayerMd = null;
  let claudePersonalMd = null;
  const agentFiles = [];
  const commandFiles = [];
  const ruleFiles = [];
  const skillsByName = new Map();

  for (const layerRoot of layerRoots) {
    const settingsFile = findSettingsFile(layerRoot);
    if (settingsFile) {
      const json = readJsonIfExists(settingsFile);
      if (json) settingsLayers.push(json);
    }

    const permsFile = path.join(layerRoot, 'permissions.yaml');
    if (fs.existsSync(permsFile)) permissionsFiles.push(permsFile);

    const claudeMdFile = findClaudeMdFile(layerRoot);
    if (claudeMdFile) {
      const text = readTextIfExists(claudeMdFile);
      if (path.basename(claudeMdFile) === 'CLAUDE.layer.md') claudeLayerMd = text;
      else claudePersonalMd = text;
    }

    for (const f of listMarkdownFilesFlat(path.join(layerRoot, 'agents'))) {
      agentFiles.push({ relPath: f.relPath, absPath: f.absPath, layer: layerRoot });
    }
    for (const f of listMarkdownFilesRecursive(path.join(layerRoot, 'commands'))) {
      commandFiles.push({ relPath: f.relPath, absPath: f.absPath, layer: layerRoot });
    }
    for (const f of listMarkdownFilesRecursive(path.join(layerRoot, 'rules'))) {
      ruleFiles.push({ relPath: f.relPath, absPath: f.absPath, layer: layerRoot });
    }
    for (const skill of listSkillDirs(layerRoot)) {
      const hasCodexPort = fs.existsSync(path.join(skill.absPath, 'codex', 'SKILL.md'));
      skillsByName.set(skill.name, { skillDir: skill.absPath, hasCodexPort, layer: layerRoot });
    }
  }

  return { settingsLayers, permissionsFiles, claudeLayerMd, claudePersonalMd, agentFiles, commandFiles, ruleFiles, skillsByName };
}

/**
 * The guard floor (permissions.yaml's `guardFloor:`) has no dedicated place
 * in Codex's hooks.json — the floor hooks arrive through the ordinary
 * settings-layer translation, as `run-bash-hook.js --harness codex
 * "<abs path>"` commands. So this target's job is not to inject them but to
 * CHECK them: if a floor hook did not survive translation (a layer stopped
 * declaring it, a command shape the translator can't read, a merge that
 * dropped it), that is a protection downgrade the plan has to say out loud
 * rather than a hooks.json that quietly runs one guard fewer.
 *
 * The declared script path is matched against the merged command strings
 * because that is what the command carries — parseBashWrapperCommand already
 * expanded the wrapper's `~/` against the same `home` resolveGuardFloor uses.
 * Only the entry's own event is searched: a floor hook registered on some
 * other event is not the floor being honoured.
 */
function verifyGuardFloor({ merged, guardFloor }) {
  const warnings = [];
  const skipped = [];

  for (const entry of guardFloor) {
    const event = entry.event || 'PreToolUse';
    const groups = (merged && merged.hooks && merged.hooks[event]) || [];
    const present = groups.some(group =>
      (Array.isArray(group.hooks) ? group.hooks : []).some(
        handler => typeof handler.command === 'string' && handler.command.includes(entry.scriptPath)
      )
    );
    if (present) continue;

    const reason = `declared in permissions.yaml guardFloor but absent from the generated hooks.json — codex would run below the guard floor`;
    warnings.push(`codex: guard floor hook "${entry.hook}" (${event}) — ${reason}`);
    skipped.push({
      target: 'codex',
      event,
      matcher: entry.matcher || '',
      command: entry.scriptPath,
      reason,
    });
  }

  return { warnings, skipped };
}

function buildHooksOperations({ settingsLayers, out, yokiRoot, home, guardFloor }) {
  const { generated, warnings, skipped } = buildGeneratedGroups(settingsLayers, { yokiRoot, home });
  const hooksJsonPath = path.join(out, 'hooks.json');
  const existing = readJsonIfExists(hooksJsonPath) || {};
  const merged = mergeHooksJson(existing, generated);
  const op = { kind: 'merge-json', destinationPath: hooksJsonPath, content: merged, layer: 'generated' };
  const hookStateEntries = collectHookStateEntries(merged, hooksJsonPath);

  const floorCheck = verifyGuardFloor({ merged, guardFloor: guardFloor || [] });

  return {
    op,
    hookStateEntries,
    warnings: [...warnings, ...floorCheck.warnings],
    skipped: [...skipped, ...floorCheck.skipped],
  };
}

function buildRulesAndConfigOperations({ permissionsFiles, out, hookStateEntries, yokiRoot, pluginRoot, hookProfile, mcpServers }) {
  const converted = convertPermissions(permissionsFiles);

  const rulesOp = {
    kind: 'write',
    destinationPath: path.join(out, 'rules', 'yoki.rules'),
    content: converted.rules,
    layer: 'generated',
  };

  const configTomlPath = path.join(out, 'config.toml');
  const existingConfigToml = readTextIfExists(configTomlPath) || '';

  // T13: [mcp_servers.<name>] tables, appended into the same managed block
  // via the toml-block op below. `after` is everything OUTSIDE our own
  // block (a hand-added server, or a pre-T13 `codex mcp add` entry) — a
  // same-named table there is left alone rather than overwritten.
  const { after } = extractBlock(existingConfigToml, BLOCK_START, BLOCK_END);
  const { toml: mcpServersToml, warnings: mcpWarnings } = buildMcpServersToml(mcpServers, after);

  const blockContent = buildManagedBlockContent({
    permissionsToml: converted.permissions,
    yokiRoot,
    pluginRoot,
    hookProfile,
    hookStateEntries,
    mcpServersToml,
  });
  const ownedKeys = new Set(hookStateEntries.map(e => e.key));
  const { content: configTomlContent, warnings } = applyManagedBlock(existingConfigToml, blockContent, ownedKeys);
  const configOp = { kind: 'toml-block', destinationPath: configTomlPath, content: configTomlContent, layer: 'generated' };

  return {
    rulesOp,
    configOp,
    warnings: [...warnings, ...mcpWarnings],
    hookEnforced: converted.hookEnforced,
    guardDeny: converted.guardDeny,
  };
}

/**
 * `<out>/.yoki/permissions.json` — the deny list hooks/pre-permission-guard.js
 * reads when it runs under `YOKI_HARNESS=codex`, in the same
 * `{deny:[{pattern,reason}]}` shape yoki-switch writes for Claude Code and
 * omp.js writes for omp.
 *
 * to-codex.js's `guardDeny` is the `enforce: [hook]` subset unioned with
 * every deny NEITHER `rules/yoki.rules` NOR `[permissions.yoki.filesystem]`
 * expresses — most of the `Edit(...)` rows, and the `Read(**…)` workspace
 * globs the filesystem table deliberately leaves out. Those were declared and
 * unenforced on Codex before this file: the filesystem table only carries the
 * READ side of the secret paths, so nothing stopped a write to
 * `~/.ssh/id_ed25519` unless permissions.yaml happened to tag that row
 * `enforce: [hook]`.
 */
function buildGuardPermissionsOperation({ out, guardDeny }) {
  const deny = guardDeny || [];
  const content = `${JSON.stringify({ deny }, null, 2)}\n`;
  const op = {
    kind: 'write',
    destinationPath: path.join(out, '.yoki', 'permissions.json'),
    content,
    layer: 'generated',
  };

  const info = deny.length > 0
    ? [`codex: ${deny.length} deny pattern(s) with no execpolicy/filesystem equivalent are enforced by pre-permission-guard on codex (written to ${op.destinationPath})`]
    : [];

  return { op, info };
}

function buildAgentOperations({ agentFiles, out, layerRoots }) {
  const modelMapJson = readJsonIfExists(path.join(layerRoots[0], 'harness-models.json'));
  const modelMap = (modelMapJson && modelMapJson.codex) || {};

  const byName = new Map();
  for (const f of agentFiles) byName.set(path.basename(f.relPath, '.md'), f); // later layer wins

  const ops = [];
  for (const [name, f] of byName) {
    const markdown = readTextIfExists(f.absPath);
    const content = agentMarkdownToToml(name, markdown, modelMap);
    ops.push({ kind: 'write', destinationPath: path.join(out, 'agents', `${name}.toml`), content, layer: f.layer });
  }
  return ops;
}

function buildAgentsMdOperation({ claudeLayerMd, claudePersonalMd, ruleFiles, out }) {
  const noPathsRules = [];
  for (const f of ruleFiles) {
    const text = readTextIfExists(f.absPath);
    if (text && !hasPathsFrontmatter(text)) noPathsRules.push({ path: f.relPath, content: text });
  }

  const blockContent = buildAgentsMdBlockContent({ claudeLayerMd, claudePersonalMd, noPathsRules, vocab });
  const agentsMdPath = path.join(out, 'AGENTS.md');
  const existing = readTextIfExists(agentsMdPath) || '';
  const content = applyAgentsMdBlock(existing, blockContent);
  return { kind: 'write', destinationPath: agentsMdPath, content, layer: 'generated' };
}

function buildSkillOperations({ skillsByName, out, home }) {
  const ops = [];
  for (const [name, entry] of skillsByName) {
    ops.push(decideSkillSymlink({ skillDir: entry.skillDir, hasCodexPort: entry.hasCodexPort, name, out, home, layer: entry.layer }));
  }
  return ops;
}

function buildCommandSkillOperations({ commandFiles, out }) {
  const byRelPath = new Map();
  for (const f of commandFiles) byRelPath.set(f.relPath, f); // later layer wins

  const ops = [];
  for (const [relPath, f] of byRelPath) {
    const markdown = readTextIfExists(f.absPath);
    const { name, skillMarkdown } = commandToSkill(relPath, markdown);
    ops.push({ kind: 'write', destinationPath: path.join(out, 'skills', name, 'SKILL.md'), content: skillMarkdown, layer: f.layer });
  }
  return ops;
}

/** Generated write/symlink destinations get tracked in a small manifest at
 * `<out>/.yoki/codex-manifest.json` so a later `--prune` run can remove
 * destinations a source layer no longer provides (a deleted agent, a
 * renamed command, a skill dropped from a disabled pack). The always-present
 * singleton targets (hooks.json/config.toml/AGENTS.md/rules) are merged in
 * place instead of replaced, so they are never candidates for pruning; so
 * are the `~/.agents/skills/<name>` ports, which live outside `out` and are
 * therefore deliberately excluded from the manifest (see ./manifest.js). */
function buildCodexPruneOperations({ out, prunableDestinations, prune }) {
  return buildPruneOperations({
    manifestPath: manifestPathFor(out, 'codex'),
    out,
    prunableDestinations,
    prune,
    readJsonIfExists,
  });
}

/**
 * @param {{sources: string[], out: string, home?: string, env?: NodeJS.ProcessEnv,
 *   yokiRoot?: string, pluginRoot?: string, prune?: boolean, codexVersion?: string|null}} options
 *   `codexVersion` overrides the `codex --version` shell-out (tests only;
 *   normally left undefined so `detectInstalledCodexVersion()` runs).
 * @returns {{target: 'codex', out: string, sources: string[], operations: Array<object>,
 *   warnings: string[], codexVersion: string|null}} `codexVersion` is the
 *   version this plan gated version-restricted events against, cached here
 *   so a caller (doctor, a re-apply) never needs to shell out again for the
 *   same plan.
 */
function plan(options) {
  const { sources, out } = options;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('codex.plan: --sources must list at least the core layer root');
  }
  if (!out) {
    throw new Error('codex.plan: --out is required');
  }

  const home = options.home || require('os').homedir();
  const env = options.env || process.env;
  const yokiRoot = options.yokiRoot || env.YOKI_ROOT || defaultYokiRoot();
  const pluginRoot = options.pluginRoot || env.CLAUDE_PLUGIN_ROOT || yokiRoot;
  const hookProfile = env.YOKI_HOOK_PROFILE || 'standard';

  const layerRoots = sources.map(s => path.resolve(s));
  const outResolved = path.resolve(out);
  const content = discoverLayerContent(layerRoots);

  const warnings = [];
  const info = [];
  const skipped = [];
  const operations = [];

  // T32: `codex --version` read once here and cached on the returned plan —
  // gates version-restricted events (currently just Interrupt, >= 0.150.0)
  // before they ever reach buildGeneratedGroups, so an old installed CLI
  // gets a warning instead of a hooks.json entry it silently never fires.
  const codexVersion = options.codexVersion !== undefined ? options.codexVersion : detectInstalledCodexVersion();
  const versionGate = filterVersionGatedEvents(content.settingsLayers, codexVersion);
  warnings.push(...versionGate.warnings);

  const guardFloor = resolveGuardFloor(content.permissionsFiles, home);
  const hooks = buildHooksOperations({ settingsLayers: versionGate.settingsLayers, out: outResolved, yokiRoot, home, guardFloor });
  operations.push(hooks.op);
  warnings.push(...hooks.warnings);
  skipped.push(...hooks.skipped);

  // T13: canonical mcp.json inventory, core→packs→personal merged and
  // {{HOME}}-resolved (no subsequent sed pass for this target, unlike
  // yoki-switch's merge_settings() for Claude — see lib/mcp-inventory/
  // source.js's resolveHome doc comment).
  const mcpServers = resolveMcpHome(loadAndMergeMcp(layerRoots.map(r => path.join(r, 'mcp.json'))), home);

  const rulesAndConfig = buildRulesAndConfigOperations({
    permissionsFiles: content.permissionsFiles,
    out: outResolved,
    hookStateEntries: hooks.hookStateEntries,
    yokiRoot,
    pluginRoot,
    hookProfile,
    mcpServers,
  });
  operations.push(rulesAndConfig.rulesOp, rulesAndConfig.configOp);
  warnings.push(...rulesAndConfig.warnings);

  // No per-entry warning any more: every one of these is written to
  // `<out>/.yoki/permissions.json` below and enforced by
  // hooks/pre-permission-guard.js under YOKI_HARNESS=codex, so the plan says
  // so once rather than repeating "enforce via a hook instead" for each row
  // while the hook already does.
  const guardPermissions = buildGuardPermissionsOperation({ out: outResolved, guardDeny: rulesAndConfig.guardDeny });
  operations.push(guardPermissions.op);
  info.push(...guardPermissions.info);

  const agentOps = buildAgentOperations({ agentFiles: content.agentFiles, out: outResolved, layerRoots });
  operations.push(...agentOps);

  operations.push(buildAgentsMdOperation({
    claudeLayerMd: content.claudeLayerMd,
    claudePersonalMd: content.claudePersonalMd,
    ruleFiles: content.ruleFiles,
    out: outResolved,
  }));

  const skillOps = buildSkillOperations({ skillsByName: content.skillsByName, out: outResolved, home });
  operations.push(...skillOps);

  const commandSkillOps = buildCommandSkillOperations({ commandFiles: content.commandFiles, out: outResolved });
  operations.push(...commandSkillOps);

  const prunableDestinations = [...agentOps, ...skillOps, ...commandSkillOps].map(op => op.destinationPath);
  operations.push(...buildCodexPruneOperations({ out: outResolved, prunableDestinations, prune: Boolean(options.prune) }));

  return { target: 'codex', out: outResolved, home, sources: layerRoots, operations, warnings, info, skipped, codexVersion };
}

module.exports = {
  plan,
  MANIFEST_RELATIVE_PATH,
  defaultYokiRoot,
  // pure helpers, exported for tests (T32 version gate)
  EVENT_MIN_CODEX_VERSION,
  parseCodexVersion,
  compareVersions,
  isEventSupportedByVersion,
  filterVersionGatedEvents,
  verifyGuardFloor,
};
