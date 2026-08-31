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

const { convert: convertPermissions } = require('../permissions/to-codex');
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
const { loadAndMerge: loadAndMergeMcp, resolveHome: resolveMcpHome } = require('../mcp-inventory/source');
const { buildMcpServersToml } = require('../mcp-inventory/writers/codex');

const vocab = require('./vocab.json');

const MANIFEST_RELATIVE_PATH = path.join('.yoki', 'codex-manifest.json');

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

function buildHooksOperations({ settingsLayers, out }) {
  const { generated, warnings } = buildGeneratedGroups(settingsLayers);
  const hooksJsonPath = path.join(out, 'hooks.json');
  const existing = readJsonIfExists(hooksJsonPath) || {};
  const merged = mergeHooksJson(existing, generated);
  const op = { kind: 'merge-json', destinationPath: hooksJsonPath, content: merged, layer: 'generated' };
  const hookStateEntries = collectHookStateEntries(merged, hooksJsonPath);
  return { op, hookStateEntries, warnings };
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

  return { rulesOp, configOp, warnings: [...warnings, ...mcpWarnings], hookEnforced: converted.hookEnforced };
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
 * place instead of replaced, so they are never candidates for pruning. */
function buildPruneOperations({ out, prunableDestinations, prune }) {
  if (!prune) return [];
  const manifestPath = path.join(out, MANIFEST_RELATIVE_PATH);
  const previous = readJsonIfExists(manifestPath);
  if (!Array.isArray(previous)) return [];

  const current = new Set(prunableDestinations);
  return previous
    .filter(destinationPath => !current.has(destinationPath))
    .map(destinationPath => ({ kind: 'remove', destinationPath, layer: 'generated' }));
}

/**
 * @param {{sources: string[], out: string, home?: string, env?: NodeJS.ProcessEnv,
 *   yokiRoot?: string, pluginRoot?: string, prune?: boolean}} options
 * @returns {{target: 'codex', out: string, sources: string[], operations: Array<object>, warnings: string[]}}
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
  const operations = [];

  const hooks = buildHooksOperations({ settingsLayers: content.settingsLayers, out: outResolved });
  operations.push(hooks.op);
  warnings.push(...hooks.warnings);

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
  for (const entry of rulesAndConfig.hookEnforced) {
    warnings.push(`codex: "${entry.pattern}" has no native execpolicy/filesystem equivalent — enforce via a PreToolUse hook instead (${entry.reason || 'see spike S3 §4c'})`);
  }

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
  operations.push(...buildPruneOperations({ out: outResolved, prunableDestinations, prune: Boolean(options.prune) }));

  return { target: 'codex', out: outResolved, home, sources: layerRoots, operations, warnings };
}

module.exports = { plan, MANIFEST_RELATIVE_PATH, defaultYokiRoot };
