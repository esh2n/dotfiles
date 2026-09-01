'use strict';

/**
 * Cross-harness compliance matrix: one record per harness or comparison
 * runtime, describing how much of yoki's harness/loop/graph surface each
 * one actually gets (`ADAPTER_RECORDS` below). This module is the source of
 * truth — `docs/architecture/harness-adapter-compliance.md`'s generated
 * table (between the `<!-- harness-adapter-compliance:matrix-start -->` /
 * `:matrix-end` markers) is derived from it, never edited by hand.
 *
 * Regenerate the doc after touching a record:
 *
 *   node -e "
 *     const fs = require('fs');
 *     const path = require('path');
 *     const m = require('./harness-adapter-compliance');
 *     const docPath = path.join(__dirname, '..', '..', 'docs', 'architecture', 'harness-adapter-compliance.md');
 *     const src = fs.readFileSync(docPath, 'utf8');
 *     const start = src.indexOf(m.MATRIX_BLOCK_START) + m.MATRIX_BLOCK_START.length;
 *     const end = src.indexOf(m.MATRIX_BLOCK_END);
 *     fs.writeFileSync(docPath, src.slice(0, start) + '\n\n' + m.renderMarkdownTable() + '\n\n' + src.slice(end));
 *   "
 *
 * (run from this file's own directory: `scripts/lib/`). `validateDocumentation()`
 * fails when the checked-in markdown has drifted from `ADAPTER_RECORDS`.
 */

const fs = require('fs');
const path = require('path');

const MATRIX_BLOCK_START = '<!-- harness-adapter-compliance:matrix-start -->';
const MATRIX_BLOCK_END = '<!-- harness-adapter-compliance:matrix-end -->';

const COMPLIANCE_STATES = Object.freeze({
  Native: 'ECC can install or verify the surface directly for this harness.',
  'Adapter-backed': 'ECC has a thin adapter, plugin, or package surface, but parity differs by harness.',
  'Instruction-backed': 'ECC can provide the guidance and files, but the harness does not expose the runtime hook/session surface ECC needs for enforcement.',
  'Reference-only': 'The tool is useful as a design pressure or external runtime, but ECC does not yet ship a direct installer or adapter for it.',
});

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'harness',
  'state',
  'supported_assets',
  'unsupported_surfaces',
  'install_or_onramp',
  'verification_commands',
  'risk_notes',
  'last_verified_at',
  'owner',
  'source_docs',
]);

function freezeRecord(record) {
  return Object.freeze({
    ...record,
    supported_assets: Object.freeze(record.supported_assets.slice()),
    unsupported_surfaces: Object.freeze(record.unsupported_surfaces.slice()),
    install_or_onramp: Object.freeze(record.install_or_onramp.slice()),
    verification_commands: Object.freeze(record.verification_commands.slice()),
    risk_notes: Object.freeze(record.risk_notes.slice()),
    source_docs: Object.freeze(record.source_docs.slice()),
  });
}

const ADAPTER_RECORDS = Object.freeze([
  {
    id: 'claude-code',
    harness: 'Claude Code',
    state: 'Native',
    supported_assets: [
      'Claude plugin assets',
      'skills',
      'commands',
      'hooks',
      'MCP config',
      'local rules',
      'statusline-oriented workflows',
    ],
    unsupported_surfaces: ['Claude-native hooks do not imply parity in other harnesses'],
    install_or_onramp: [
      '`./install.sh --profile minimal --target claude`',
      'Claude plugin install',
    ],
    verification_commands: [
      '`npm run harness:audit -- --format json`',
      '`node scripts/session-inspect.js --list-adapters`',
    ],
    risk_notes: ['Avoid loading every skill by default; keep hooks opt-in and inspectable.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.claude-plugin/plugin.json',
      'docs/architecture/cross-harness.md',
      'scripts/lib/install-targets/claude-home.js',
    ],
  },
  {
    id: 'codex',
    harness: 'Codex',
    state: 'Adapter-backed',
    supported_assets: [
      'hooks via `hooks.json` (9 events reachable from `codex exec`, translated by `codex-hooks-merge.js`) + `[hooks.state]` trust-hash upsert in `config.toml`',
      '`rules/yoki.rules` (execpolicy, from `lib/permissions/to-codex.js`)',
      '`[permissions.yoki*]` tables + `default_permissions = "yoki"` in `config.toml`',
      '`agents/*.toml` (converted from claude-profiles `agents/*.md`)',
      '`AGENTS.md` managed block (`# yoki:begin`/`:end`-equivalent marker pair)',
      'skills via `~/.agents/skills/<name>` symlinks, or `~/.codex/skills/<name>` for a skill shipping a `codex/` port',
      'commands converted 1:1 into `cmd-<name>` skills (Codex has no slash-command format of its own)',
      '`notify` wired to `scripts/hooks/codex-notify.js`',
      'yoki-graph (`yoki-graph run <name> --backend codex`)',
      'yoki-artifact (same CLI as every other harness)',
      'yoki-loop (`yoki-loop run <name> --harness codex`, `codex exec --json`)',
    ],
    unsupported_surfaces: [
      'no statusline surface to write into (unlike omp)',
      'the `auto` approval-mode classifier is Codex-native policy — yoki hooks cannot see or override it',
      '`PermissionRequest` is a real Codex hook event but unreachable from headless `codex exec` — only the interactive TUI reaches it',
      'no native Workflow or Artifact tool — yoki-graph and yoki-artifact exist specifically to cover this gap',
    ],
    install_or_onramp: [
      '`yoki-switch apply --target codex`',
      '`yoki-switch doctor` to verify `~/.codex` state without writing',
    ],
    verification_commands: [
      '`bash core/validation/validator.sh yoki-switch-targets`',
      '`bash core/validation/validator.sh targets-golden`',
      '`node --test domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/test/codex.test.js`',
    ],
    risk_notes: [
      'Only the marker block in `config.toml`/`AGENTS.md` and the hooks.json group yoki owns are ever rewritten; a hand-added `[projects.*]` entry or a foreign hook group is preserved byte-for-byte.',
      '`Interrupt` is gated on `codex --version >= 0.150.0`; an older install gets a warning and the hook is dropped rather than silently ignored by Codex.',
    ],
    last_verified_at: '2026-08-31',
    owner: 'yoki maintainers',
    source_docs: [
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/codex.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/codex-hooks-merge.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/codex-config-toml.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/codex-agents-md.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/codex-skills.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/harness/payload.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/doctor.js',
    ],
  },
  {
    id: 'omp',
    harness: 'omp',
    state: 'Adapter-backed',
    supported_assets: [
      '`yoki-bridge.ts` extension symlinked into `~/.omp/agent/extensions/`, dispatching every yoki hook event omp exposes',
      '`yoki-hooks.json` manifest (7 mapped events + `tool_approval_requested`)',
      '`config.yml` layered from a repo template plus generated permissions/model overrides — replaces a hand-symlinked `config.yml` with a real generated file',
      '`RULES.md` managed block — omp does not read `~/.claude/rules` on its own',
      '`agents/*.md` (converted from claude-profiles `agents/*.md`) — omp does not read `~/.claude/agents` on its own',
      'statusLine leftSegments/rightSegments approximating `personal/scripts/statusline.sh`',
      'MCP servers via `mcp.json`',
      'yoki-graph (`yoki-graph run <name> --backend omp`)',
      'yoki-artifact (same CLI as every other harness)',
      'yoki-loop (`yoki-loop run <name> --harness omp`, `omp -p --mode json --no-extensions -e <yoki-bridge.ts>` to keep the guard live)',
    ],
    unsupported_surfaces: [
      'a project-level `.omp/` directory auto-loads with no trust prompt on omp 18.0.4 (`ctx.isProjectTrusted()` is hard-wired `true`) — this generator only ever writes under `~/.omp/agent`, never a project `.omp/`, specifically because of this',
      'no interactive-input hook event is reachable in headless mode (`omp -p`) — there is no TTY to satisfy an elicitation request outside the TUI',
      'skills/commands/CLAUDE.md are read by omp directly from `~/.claude/*` — nothing is generated for them here, unlike Codex',
      'no native Workflow or Artifact tool — yoki-graph and yoki-artifact exist specifically to cover this gap',
    ],
    install_or_onramp: [
      '`yoki-switch apply --target omp`',
      '`yoki-switch doctor` to verify `~/.omp/agent` state without writing',
    ],
    verification_commands: [
      '`bash core/validation/validator.sh omp-yoki-bridge`',
      '`bash core/validation/validator.sh targets-golden`',
      '`node --test domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/test/omp.test.js`',
    ],
    risk_notes: [
      'omp throws on an uncaught extension error (fail-closed by default); every path in `yoki-bridge.ts` is wrapped try/catch to fail open instead, so a bug in one hook cannot brick the session.',
      'the zsh `omp()` wrapper always injects `--no-extensions -e ~/.omp/agent/extensions/yoki-bridge.ts` so a repo-local `.omp/` cannot silently swap in unreviewed extensions; escape hatches are `YOKI_OMP_ALL_EXTENSIONS=1` or `command omp`.',
    ],
    last_verified_at: '2026-08-31',
    owner: 'yoki maintainers',
    source_docs: [
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/omp.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/omp-hooks.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/omp-config-yml.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/omp-rules-md.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/targets/omp-agents.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/harness/payload.js',
      'domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/doctor.js',
      'domains/dev/config/omp/extensions/yoki-bridge.ts',
    ],
  },
  {
    id: 'opencode',
    harness: 'OpenCode',
    state: 'Adapter-backed',
    supported_assets: [
      'OpenCode package/plugin metadata',
      'shared skills',
      'MCP config',
      'event adapter patterns',
    ],
    unsupported_surfaces: ['Event names, plugin packaging, and command dispatch differ from Claude Code'],
    install_or_onramp: ['OpenCode package or plugin surface from this repo'],
    verification_commands: [
      '`node tests/scripts/build-opencode.test.js`',
      '`npm run harness:audit -- --format json`',
    ],
    risk_notes: ['Keep hook logic in shared scripts and adapt only event shape at the edge.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.opencode/package.json',
      '.opencode/plugins/ecc-hooks.ts',
      'scripts/build-opencode.js',
    ],
  },
  {
    id: 'cursor',
    harness: 'Cursor',
    state: 'Adapter-backed',
    supported_assets: [
      'Cursor rules',
      'project-local skills',
      'hook adapter',
      'shared scripts',
    ],
    unsupported_surfaces: ['Cursor hook events and rule loading differ from Claude Code'],
    install_or_onramp: ['`./install.sh --profile minimal --target cursor`'],
    verification_commands: [
      '`node tests/lib/install-targets.test.js`',
      '`npm run harness:audit -- --format json`',
    ],
    risk_notes: ['Cursor adapters must preserve existing project rules and avoid silent overwrite.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.cursor/',
      'scripts/lib/install-targets/cursor-project.js',
      'tests/lib/install-targets.test.js',
    ],
  },
  {
    id: 'gemini',
    harness: 'Gemini',
    state: 'Instruction-backed',
    supported_assets: [
      'Gemini project-local instructions',
      'shared skills',
      'rules',
      'compatibility docs',
    ],
    unsupported_surfaces: ['No full ECC hook parity; ecosystem ports must document drift from upstream ECC'],
    install_or_onramp: ['`./install.sh --profile minimal --target gemini`'],
    verification_commands: ['`node tests/lib/install-targets.test.js`'],
    risk_notes: ['Treat Gemini ports as ecosystem adapters until validated end to end inside Gemini CLI.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      '.gemini/',
      'scripts/lib/install-targets/gemini-project.js',
      'tests/lib/install-targets.test.js',
    ],
  },
  {
    id: 'zed',
    harness: 'Zed',
    state: 'Adapter-backed',
    supported_assets: [
      'Zed project settings',
      'flattened project rules',
      'shared skills',
      'commands',
      'agents',
    ],
    unsupported_surfaces: ['Zed external agents and native Agent Panel permissions are not Claude hooks'],
    install_or_onramp: ['`./install.sh --profile minimal --target zed`'],
    verification_commands: [
      '`node tests/lib/install-targets.test.js`',
      '`npm run harness:audit -- --format json`',
    ],
    risk_notes: ['Keep project settings conservative and do not copy BYOK/OpenRouter secrets into `.zed/`.'],
    last_verified_at: '2026-05-17',
    owner: 'ECC maintainers',
    source_docs: [
      '.zed/settings.json',
      'scripts/lib/install-targets/zed-project.js',
      'docs/architecture/cross-harness.md',
      'tests/lib/install-targets.test.js',
    ],
  },
  {
    id: 'dmux',
    harness: 'dmux',
    state: 'Adapter-backed',
    supported_assets: [
      'session snapshots',
      'tmux/worktree orchestration status',
      'handoff exports',
    ],
    unsupported_surfaces: ['dmux is an orchestration runtime, not an install target for skills/rules'],
    install_or_onramp: [
      '`node scripts/session-inspect.js --list-adapters`',
      'dmux session target inspection',
    ],
    verification_commands: ['`node tests/lib/session-adapters.test.js`'],
    risk_notes: ['Treat dmux events as session/runtime signals, not as a replacement for repo validation.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      'scripts/lib/session-adapters/dmux-tmux.js',
      'scripts/orchestration-status.js',
      'tests/lib/session-adapters.test.js',
    ],
  },
  {
    id: 'orca',
    harness: 'Orca',
    state: 'Reference-only',
    supported_assets: [
      'worktree lifecycle',
      'review state',
      'notification',
      'provider-identity design pressure',
    ],
    unsupported_surfaces: ['No ECC installer or direct adapter today'],
    install_or_onramp: ['Use as a comparison target for worktree/session state requirements'],
    verification_commands: ['`npm run observability:ready`'],
    risk_notes: ['Do not import product-specific assumptions; convert lessons into ECC event fields.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: ['docs/architecture/cross-harness.md'],
  },
  {
    id: 'superset',
    harness: 'Superset',
    state: 'Reference-only',
    supported_assets: [
      'workspace presets',
      'parallel-agent review loops',
      'worktree isolation design pressure',
    ],
    unsupported_surfaces: ['No ECC installer or direct adapter today'],
    install_or_onramp: ['Use as a comparison target for workspace preset taxonomy'],
    verification_commands: ['`npm run observability:ready`'],
    risk_notes: ['Keep ECC portable; do not require a desktop workspace to get basic value.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: ['docs/architecture/cross-harness.md'],
  },
  {
    id: 'ghast',
    harness: 'Ghast',
    state: 'Reference-only',
    supported_assets: [
      'terminal-native pane grouping',
      'cwd grouping',
      'search',
      'notifications',
    ],
    unsupported_surfaces: ['No ECC installer or direct adapter today'],
    install_or_onramp: ['Use as a comparison target for terminal-first session grouping'],
    verification_commands: ['`node scripts/session-inspect.js --list-adapters`'],
    risk_notes: ['Preserve terminal ergonomics before adding visual UI assumptions.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: ['docs/architecture/cross-harness.md'],
  },
  {
    id: 'terminal-only',
    harness: 'Terminal-only',
    state: 'Native',
    supported_assets: [
      'skills',
      'rules',
      'commands',
      'scripts',
      'harness audit',
      'observability readiness',
      'handoffs',
    ],
    unsupported_surfaces: ['No external UI, no automatic session control unless scripts are run explicitly'],
    install_or_onramp: [
      'Clone repo',
      'run commands directly',
      'use minimal profile for project installs',
    ],
    verification_commands: [
      '`npm run harness:audit -- --format json`',
      '`npm run observability:ready`',
    ],
    risk_notes: ['This is the fallback contract; every higher-level adapter should degrade to it.'],
    last_verified_at: '2026-05-12',
    owner: 'ECC maintainers',
    source_docs: [
      'scripts/harness-audit.js',
      'scripts/observability-readiness.js',
      'docs/architecture/observability-readiness.md',
    ],
  },
].map(freezeRecord));

function toTextList(value) {
  return Array.isArray(value) ? value.join('; ') : String(value || '');
}

function escapeMarkdownCell(value) {
  return toTextList(value).replace(/\|/g, '\\|').trim();
}

function renderMarkdownTable(records = ADAPTER_RECORDS) {
  const lines = [
    '| Harness or runtime | State | Supported assets | Unsupported or different surfaces | Install or onramp | Verification command | Risk notes |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const record of records) {
    lines.push([
      record.harness,
      record.state,
      record.supported_assets,
      record.unsupported_surfaces,
      record.install_or_onramp,
      record.verification_commands,
      record.risk_notes,
    ].map(escapeMarkdownCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  }

  return lines.join('\n');
}

function renderStateTable() {
  const lines = [
    '| State | Meaning |',
    '| --- | --- |',
  ];

  for (const [state, meaning] of Object.entries(COMPLIANCE_STATES)) {
    lines.push(`| ${escapeMarkdownCell(state)} | ${escapeMarkdownCell(meaning)} |`);
  }

  return lines.join('\n');
}

function validateAdapterRecords(records = ADAPTER_RECORDS) {
  const errors = [];
  const ids = new Set();

  records.forEach((record, index) => {
    const label = record?.id || `record[${index}]`;

    for (const field of REQUIRED_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) {
        errors.push(`${label}: missing required field ${field}`);
      }
    }

    if (typeof record.id !== 'string' || !/^[a-z0-9-]+$/.test(record.id)) {
      errors.push(`${label}: id must be a lowercase slug`);
    } else if (ids.has(record.id)) {
      errors.push(`${label}: duplicate id`);
    } else {
      ids.add(record.id);
    }

    if (!Object.prototype.hasOwnProperty.call(COMPLIANCE_STATES, record.state)) {
      errors.push(`${label}: unknown state ${record.state}`);
    }

    for (const field of [
      'supported_assets',
      'unsupported_surfaces',
      'install_or_onramp',
      'verification_commands',
      'risk_notes',
      'source_docs',
    ]) {
      if (!Array.isArray(record[field]) || record[field].length === 0) {
        errors.push(`${label}: ${field} must be a non-empty array`);
        continue;
      }

      record[field].forEach((value, valueIndex) => {
        if (typeof value !== 'string' || !value.trim()) {
          errors.push(`${label}: ${field}[${valueIndex}] must be a non-empty string`);
        }
      });
    }

    if (typeof record.harness !== 'string' || !record.harness.trim()) {
      errors.push(`${label}: harness must be a non-empty string`);
    }

    if (typeof record.owner !== 'string' || !record.owner.trim()) {
      errors.push(`${label}: owner must be a non-empty string`);
    }

    if (typeof record.last_verified_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.last_verified_at)) {
      errors.push(`${label}: last_verified_at must be YYYY-MM-DD`);
    }
  });

  return errors;
}

function extractMatrixBlock(markdown) {
  const normalized = String(markdown).replace(/\r\n/g, '\n');
  const start = normalized.indexOf(MATRIX_BLOCK_START);
  const end = normalized.indexOf(MATRIX_BLOCK_END);

  if (start < 0 || end < 0 || end <= start) {
    return null;
  }

  return normalized.slice(start + MATRIX_BLOCK_START.length, end).trim();
}

function validateDocumentation(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
  const docPath = options.docPath || path.join(repoRoot, 'docs', 'architecture', 'harness-adapter-compliance.md');
  const errors = [];
  const source = fs.readFileSync(docPath, 'utf8');
  const actual = extractMatrixBlock(source);
  const expected = renderMarkdownTable();

  if (actual === null) {
    errors.push(`missing matrix block markers in ${path.relative(repoRoot, docPath)}`);
  } else if (actual !== expected) {
    errors.push(`matrix block in ${path.relative(repoRoot, docPath)} is not generated from adapter records`);
  }

  return errors;
}

module.exports = {
  ADAPTER_RECORDS,
  COMPLIANCE_STATES,
  MATRIX_BLOCK_END,
  MATRIX_BLOCK_START,
  REQUIRED_FIELDS,
  extractMatrixBlock,
  renderMarkdownTable,
  renderStateTable,
  validateAdapterRecords,
  validateDocumentation,
};
