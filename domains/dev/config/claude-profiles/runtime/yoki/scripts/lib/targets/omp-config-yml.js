'use strict';

/**
 * Renders `~/.omp/agent/config.yml` from `domains/dev/config/omp/config.yml.template`
 * plus the generated sections task T10 calls for. The whole file is
 * rewritten on every run (it is a "rendered" file, not a merged one) except
 * for four runtime-owned keys omp itself mutates after the fact
 * (`symbolPreset`, `composer`, `theme`, `setupVersion`), which are carried
 * forward from whatever is already on disk — see omp.js for the symlink ->
 * real-file replacement this depends on.
 */

const { extractTopLevelBlock, extractBlockAtIndent, extractScalar, extractChildScalars } = require('./omp-yaml-lite');
const { translateToolName } = require('./omp-tool-names');

const RUNTIME_OWNED_KEYS = ['symbolPreset', 'composer', 'theme', 'setupVersion'];

/** Approximates personal/scripts/statusline.sh (model, cwd, git branch,
 * context %, session cost) using only segment ids the omp 18.0.4 binary
 * actually registers — `SEGMENTS`/`ALL_SEGMENT_IDS` in
 * packages/coding-agent/src/modes/components/status-line/segments.ts,
 * verified via `strings` on the binary (scratchpad spike S4-S5 addendum):
 * pi, model, mode, path, git, pr, subagents, token_in, token_out,
 * token_total, token_rate, cost, context_pct, context_total, time_spent,
 * time, session, hostname, cache_read, cache_write, cache_hit,
 * session_name, collab, usage. `preset: custom` is required for
 * leftSegments/rightSegments to take effect (every other preset ignores
 * them — packages/coding-agent/src/modes/components/status-line/presets.ts). */
const STATUS_LINE_LEFT_SEGMENTS = ['model', 'path', 'git'];
const STATUS_LINE_RIGHT_SEGMENTS = ['context_pct', 'cost'];

function yamlString(value) {
  return JSON.stringify(String(value));
}

function renderToolsBlock(approvalMode, approvalMap) {
  const lines = ['tools:'];
  if (approvalMode) lines.push(`  approvalMode: ${approvalMode}`);
  const keys = Object.keys(approvalMap);
  if (keys.length === 0) {
    lines.push('  approval: {}');
  } else {
    lines.push('  approval:');
    for (const key of keys) lines.push(`    ${key}: ${approvalMap[key]}`);
  }
  return lines.join('\n');
}

function renderBashBlock(patterns) {
  if (patterns.length === 0) return 'bash:\n  patterns: []';
  const lines = ['bash:', '  patterns:'];
  for (const p of patterns) {
    lines.push(`    - match: ${yamlString(p.pattern)}`);
    lines.push(`      approval: ${p.action}`);
  }
  return lines.join('\n');
}

function renderModelRolesBlock(defaultModel, { review, scout }) {
  const lines = ['modelRoles:'];
  if (defaultModel) lines.push(`  default: ${defaultModel}`);
  if (review) lines.push(`  review: ${review}`);
  if (scout) lines.push(`  scout: ${scout}`);
  return lines.join('\n');
}

function renderStatusLineBlock() {
  const lines = ['statusLine:', '  preset: custom', '  leftSegments:'];
  for (const seg of STATUS_LINE_LEFT_SEGMENTS) lines.push(`    - ${seg}`);
  lines.push('  rightSegments:');
  for (const seg of STATUS_LINE_RIGHT_SEGMENTS) lines.push(`    - ${seg}`);
  lines.push(
    '  segmentOptions:',
    '    path:',
    '      abbreviate: true',
    '    git:',
    '      showBranch: true',
    '      showStaged: true',
    '      showUnstaged: true',
    '      showUntracked: true',
  );
  return lines.join('\n');
}

/** template baseline ∪ T8-derived entries, Claude tool names translated to
 * omp ids — an entry T8 produced for a Claude tool omp has no equivalent
 * for (e.g. NotebookRead) is dropped with a warning rather than guessed at. */
function mergeToolsApproval(templateApproval, convertedApproval, warnings) {
  const merged = { ...templateApproval };
  for (const [claudeName, action] of Object.entries(convertedApproval || {})) {
    const ompName = translateToolName(claudeName);
    if (!ompName) {
      warnings.push(`omp: tools.approval entry for "${claudeName}" has no native omp tool equivalent — skipped`);
      continue;
    }
    merged[ompName] = action;
  }
  return merged;
}

function runtimeOwnedBlock(key, { existingConfigText, isExistingRegularFile, templateText }) {
  if (isExistingRegularFile) {
    const fromExisting = extractTopLevelBlock(existingConfigText || '', key);
    if (fromExisting) return fromExisting;
  }
  return extractTopLevelBlock(templateText, key);
}

/**
 * @param {{templateText: string, existingConfigText: string|null,
 *   isExistingRegularFile: boolean,
 *   convertedPermissions: {bash:{patterns:Array<{pattern:string,action:string}>},
 *     tools:{approval:Record<string,string>}, unexpressible:Array},
 *   harnessModelsOmp: {review?:string, scout?:string}}} opts
 * @returns {{content: string, warnings: string[]}}
 */
function renderConfigYml(opts) {
  const { templateText, existingConfigText, isExistingRegularFile, convertedPermissions, harnessModelsOmp } = opts;
  const warnings = [];

  const toolsBlock = extractTopLevelBlock(templateText, 'tools');
  const templateApprovalMode = extractScalar(templateText, ['tools', 'approvalMode']);
  // `approval:` sits 2 spaces in under `tools:`, so extractBlockAtIndent
  // (not the column-0 extractTopLevelBlock) finds it inside toolsBlock;
  // its own scalar children (`eval: prompt`) sit a further 2 spaces in.
  const approvalBlock = toolsBlock ? extractBlockAtIndent(toolsBlock, 'approval', 2) : null;
  const templateApproval = approvalBlock ? extractChildScalars(approvalBlock, 4) : {};
  const templateDefaultModel = extractScalar(templateText, ['modelRoles', 'default']);

  const mergedApproval = mergeToolsApproval(templateApproval, convertedPermissions.tools.approval, warnings);

  // Deny entries with no config.yml equivalent are NOT a warning any more:
  // omp.js writes them to `<out>/.yoki/permissions.json` and
  // hooks/pre-permission-guard.js enforces them on the tool_call event, so
  // the plan reports that once as an info line instead of ~40 warnings that
  // nothing was going to act on. An unexpressible ALLOW still warns — no
  // guard can grant a permission, so omp really does fall back to its own
  // approvalMode for those calls.
  for (const entry of convertedPermissions.unexpressible || []) {
    if (entry.action === 'deny') continue;
    warnings.push(`omp: allow "${entry.pattern}" has no bash.patterns/tools.approval equivalent — omp falls back to its own approvalMode for these calls`);
  }

  const sections = [
    renderToolsBlock(templateApprovalMode, mergedApproval),
    renderBashBlock(convertedPermissions.bash.patterns),
    renderModelRolesBlock(templateDefaultModel, harnessModelsOmp || {}),
    renderStatusLineBlock(),
  ];

  for (const key of RUNTIME_OWNED_KEYS) {
    const block = runtimeOwnedBlock(key, { existingConfigText, isExistingRegularFile, templateText });
    if (block) sections.push(block);
  }

  const header = [
    '# GENERATED by yoki lib/targets/gen.js --target omp.',
    '# Edit domains/dev/config/omp/config.yml.template, permissions.yaml, and',
    '# core/harness-models.json instead — this file is rewritten wholesale on',
    `# every run, except for ${RUNTIME_OWNED_KEYS.join('/')}, which are carried`,
    '# forward from whatever omp itself already wrote here.',
  ].join('\n');

  const content = `${header}\n\n${sections.join('\n\n')}\n`;
  return { content, warnings };
}

module.exports = { renderConfigYml, RUNTIME_OWNED_KEYS, STATUS_LINE_LEFT_SEGMENTS, STATUS_LINE_RIGHT_SEGMENTS };
