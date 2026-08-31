'use strict';

/**
 * omp install-target generator (task T10). Mirrors codex.js's split:
 * `gen.js` is the CLI/`apply()` half; this module only computes `plan()` —
 * every op is `{kind, destinationPath, sourcePath?, content?, layer}`,
 * matching spike S6's "Minimal generator interface".
 *
 * Facts this plan() leans on (scratchpad spike S4-S5): omp already reads
 * `~/.claude/CLAUDE.md`, `~/.claude/skills`, `~/.claude/commands`,
 * `~/.codex/skills`, and `~/.agents/*` on its own — so unlike codex.js,
 * nothing is generated here for skills/commands/CLAUDE.md. It does NOT read
 * `~/.claude/rules` or `~/.claude/agents`, so RULES.md and `agents/*.md`
 * exist to cover exactly that gap. A project `.omp/` directory auto-loads
 * with no trust prompt (`ctx.isProjectTrusted()` is hard-wired `true` in
 * 18.0.4) — irrelevant to this generator (it only ever writes under `--out`
 * / `~/.omp/agent`), but the reason nothing here should ever be told to
 * also write a project-level `.omp/`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { convert: convertPermissions } = require('../permissions/to-omp');
const { readJsonIfExists, readTextIfExists, findSettingsFile, listMarkdownFilesFlat, listMarkdownFilesRecursive } = require('./layers');
const { buildYokiHooksJson } = require('./omp-hooks');
const { renderConfigYml } = require('./omp-config-yml');
const { buildRulesMdBlockContent, applyRulesMdBlock } = require('./omp-rules-md');
const { agentMarkdownToOmp } = require('./omp-agents');
const { buildMcpJson } = require('./omp-mcp');
const { loadAndMerge: loadAndMergeMcp, resolveHome: resolveMcpHome } = require('../mcp-inventory/source');

const YOKI_BRIDGE_SOURCE_RELATIVE = path.join('domains', 'dev', 'config', 'omp', 'extensions', 'yoki-bridge.ts');
const CONFIG_YML_TEMPLATE_RELATIVE = path.join('domains', 'dev', 'config', 'omp', 'config.yml.template');
const PI_AGENTS_RELATIVE = path.join('domains', 'dev', 'config', 'pi', 'agents');

/** YOKI_ROOT as derived from this file's own location, used when the caller
 * doesn't override it: `.../runtime/yoki/scripts/lib/targets/omp.js` ->
 * `.../runtime/yoki` (same derivation as codex.js's defaultYokiRoot). */
function defaultYokiRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

/** DOTFILES_ROOT derived from yokiRoot when neither `--dotfiles-root` nor
 * $DOTFILES_ROOT is given: `.../domains/dev/config/claude-profiles/runtime/
 * yoki` -> the repo root six levels up. Needed to locate the two
 * repo-relative sources this target reads outside the layered
 * `--sources` roots: config.yml.template and the pi agents to dedupe
 * against (see buildAgentOperations). */
function defaultDotfilesRoot(yokiRoot) {
  return path.resolve(yokiRoot, '..', '..', '..', '..', '..', '..');
}

/** Loads every layer's settings hooks + permissions.yaml + agents/*.md +
 * rules/**\/*.md — no precedence resolution here beyond "later layer
 * overwrites the same key/name", matching `core/rules/README.md`'s
 * "personal always wins". Unlike codex.js, no CLAUDE.md/commands/skills
 * discovery: omp reads those on its own (spike S4-S5 (a)). */
function discoverLayerContent(layerRoots) {
  const settingsLayers = [];
  const permissionsFiles = [];
  const agentFiles = [];
  const ruleFiles = [];

  for (const layerRoot of layerRoots) {
    const settingsFile = findSettingsFile(layerRoot);
    if (settingsFile) {
      const json = readJsonIfExists(settingsFile);
      if (json) settingsLayers.push(json);
    }

    const permsFile = path.join(layerRoot, 'permissions.yaml');
    if (fs.existsSync(permsFile)) permissionsFiles.push(permsFile);

    for (const f of listMarkdownFilesFlat(path.join(layerRoot, 'agents'))) {
      agentFiles.push({ relPath: f.relPath, absPath: f.absPath, layer: layerRoot });
    }
    for (const f of listMarkdownFilesRecursive(path.join(layerRoot, 'rules'))) {
      ruleFiles.push({ relPath: f.relPath, absPath: f.absPath, layer: layerRoot });
    }
  }

  return { settingsLayers, permissionsFiles, agentFiles, ruleFiles };
}

function buildHooksOperation({ settingsLayers, out }) {
  const { generated, warnings } = buildYokiHooksJson(settingsLayers);
  const content = `${JSON.stringify(generated, null, 2)}\n`;
  const op = { kind: 'write', destinationPath: path.join(out, 'yoki-hooks.json'), content, layer: 'generated' };
  return { op, warnings };
}

/** `fs.lstatSync` (never `statSync`, which would dereference the symlink
 * and report the repo file's own type) so a symlink is told apart from a
 * real file — the whole point of the replacement this generator performs. */
function inspectExistingConfigYml(configYmlPath) {
  let st;
  try {
    st = fs.lstatSync(configYmlPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, isSymlink: false, isRegularFile: false };
    throw err;
  }
  return { exists: true, isSymlink: st.isSymbolicLink(), isRegularFile: st.isFile() && !st.isSymbolicLink() };
}

/**
 * Renders `config.yml` and, when the destination is currently a symlink
 * (today's `~/.omp/agent/config.yml -> domains/dev/config/omp/config.yml`
 * arrangement — see core/config/manager.sh's link_omp_resources), emits a
 * `remove` op ahead of the `write` so the symlink is replaced by a real
 * file rather than written through to its target.
 */
function buildConfigYmlOperations({ out, dotfilesRoot, permissionsFiles, harnessModelsOmp }) {
  const configYmlPath = path.join(out, 'config.yml');
  const templatePath = path.join(dotfilesRoot, CONFIG_YML_TEMPLATE_RELATIVE);
  const templateText = readTextIfExists(templatePath) || '';

  const info = inspectExistingConfigYml(configYmlPath);
  const existingConfigText = info.exists ? readTextIfExists(configYmlPath) : null;

  const convertedPermissions = convertPermissions(permissionsFiles);
  const { content, warnings } = renderConfigYml({
    templateText,
    existingConfigText,
    isExistingRegularFile: info.isRegularFile,
    convertedPermissions,
    harnessModelsOmp,
  });

  const ops = [];
  if (info.isSymlink) {
    ops.push({ kind: 'remove', destinationPath: configYmlPath, layer: 'generated' });
  }
  ops.push({ kind: 'write', destinationPath: configYmlPath, content, layer: 'generated' });

  return { ops, warnings };
}

function buildRulesMdOperation({ ruleFiles, out }) {
  const blockContent = buildRulesMdBlockContent(ruleFiles, readTextIfExists);
  const rulesMdPath = path.join(out, 'RULES.md');
  const existing = readTextIfExists(rulesMdPath) || '';
  const content = applyRulesMdBlock(existing, blockContent);
  return { kind: 'write', destinationPath: rulesMdPath, content, layer: 'generated' };
}

/** claude-profiles agents/*.md (later layer wins), plus pi's reviewer
 * agents ONLY for a basename no claude-profiles layer already ships — they
 * are ancestors of the same ideas, not a second copy (task spec). */
function buildAgentOperations({ agentFiles, out, dotfilesRoot, modelMap }) {
  const byName = new Map();
  for (const f of agentFiles) byName.set(path.basename(f.relPath, '.md'), f); // later layer wins

  const ops = [];
  for (const [name, f] of byName) {
    const markdown = readTextIfExists(f.absPath);
    const content = agentMarkdownToOmp(name, markdown, modelMap);
    ops.push({ kind: 'write', destinationPath: path.join(out, 'agents', `${name}.md`), content, layer: f.layer });
  }

  const piAgentsDir = path.join(dotfilesRoot, PI_AGENTS_RELATIVE);
  for (const f of listMarkdownFilesFlat(piAgentsDir)) {
    const name = path.basename(f.relPath, '.md');
    if (byName.has(name)) continue; // same idea already ported from claude-profiles — no duplicate
    const markdown = readTextIfExists(f.absPath);
    const content = agentMarkdownToOmp(name, markdown, modelMap);
    ops.push({ kind: 'write', destinationPath: path.join(out, 'agents', `${name}.md`), content, layer: piAgentsDir });
  }

  return ops;
}

function buildExtensionOperation({ out, dotfilesRoot }) {
  return {
    kind: 'symlink',
    destinationPath: path.join(out, 'extensions', 'yoki-bridge.ts'),
    sourcePath: path.join(dotfilesRoot, YOKI_BRIDGE_SOURCE_RELATIVE),
    layer: 'generated',
  };
}

/** Preserves any hand-added third server — only the canonical (task T13)
 * `targets.omp === true` servers are overwritten (buildMcpJson). */
function buildMcpOperation({ out, layerRoots, home }) {
  const mcpJsonPath = path.join(out, 'mcp.json');
  const existing = readJsonIfExists(mcpJsonPath);
  const mergedServers = resolveMcpHome(loadAndMergeMcp(layerRoots.map(r => path.join(r, 'mcp.json'))), home);
  const content = `${JSON.stringify(buildMcpJson(existing, mergedServers), null, 2)}\n`;
  return { kind: 'write', destinationPath: mcpJsonPath, content, layer: 'generated' };
}

/**
 * @param {{sources: string[], out: string, home?: string, env?: NodeJS.ProcessEnv,
 *   yokiRoot?: string, dotfilesRoot?: string}} options
 * @returns {{target: 'omp', out: string, home: string, sources: string[],
 *   operations: Array<object>, warnings: string[]}}
 */
function plan(options) {
  const { sources, out } = options;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('omp.plan: --sources must list at least the core layer root');
  }
  if (!out) {
    throw new Error('omp.plan: --out is required');
  }

  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const yokiRoot = options.yokiRoot || env.YOKI_ROOT || defaultYokiRoot();
  const dotfilesRoot = options.dotfilesRoot || env.DOTFILES_ROOT || defaultDotfilesRoot(yokiRoot);

  const layerRoots = sources.map(s => path.resolve(s));
  const outResolved = path.resolve(out);
  const content = discoverLayerContent(layerRoots);

  const modelMapJson = readJsonIfExists(path.join(layerRoots[0], 'harness-models.json'));
  const harnessModelsOmp = (modelMapJson && modelMapJson.omp) || {};

  const warnings = [];
  const operations = [];

  const hooks = buildHooksOperation({ settingsLayers: content.settingsLayers, out: outResolved });
  operations.push(hooks.op);
  warnings.push(...hooks.warnings);

  const configYml = buildConfigYmlOperations({
    out: outResolved,
    dotfilesRoot,
    permissionsFiles: content.permissionsFiles,
    harnessModelsOmp,
  });
  operations.push(...configYml.ops);
  warnings.push(...configYml.warnings);

  operations.push(buildRulesMdOperation({ ruleFiles: content.ruleFiles, out: outResolved }));

  operations.push(...buildAgentOperations({
    agentFiles: content.agentFiles,
    out: outResolved,
    dotfilesRoot,
    modelMap: harnessModelsOmp,
  }));

  operations.push(buildExtensionOperation({ out: outResolved, dotfilesRoot }));

  operations.push(buildMcpOperation({ out: outResolved, layerRoots, home }));

  return { target: 'omp', out: outResolved, home, sources: layerRoots, operations, warnings };
}

module.exports = { plan, defaultYokiRoot, defaultDotfilesRoot };
