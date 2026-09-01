'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadLayer,
  loadAndMerge,
  resolveHome,
  TARGET_KEY_TO_HARNESS_ID,
  HARNESS_ID_TO_TARGET_KEY,
  harnessIdForTargetKey,
  targetKeyForHarnessId,
  isTargetedAt,
  applyTargetOverride,
} = require('../source');
const claudeWriter = require('../writers/claude');
const codexWriter = require('../writers/codex');
const ompWriter = require('../writers/omp');
const claudeReader = require('../readers/claude-code');
const { DEFAULT_READERS } = require('../collect');
const { buildMcpServers: buildClaudeMcpServers, convert: convertClaude } = claudeWriter;
const { buildMcpServersToml, toTomlTable, findServerNamesInText } = codexWriter;
const { buildOmpMcpServers, toOmpEntry } = ompWriter;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-inventory-test-'));
}

// -----------------------------------------------------------------------------
// source.js: the ONE place the mcp.json `targets.<key>` spelling and the
// internal harness id are reconciled (`claude` vs `claude-code`)
// -----------------------------------------------------------------------------

test('target key <-> harness id: the table round-trips in both directions', () => {
  for (const [targetKey, harnessId] of Object.entries(TARGET_KEY_TO_HARNESS_ID)) {
    assert.equal(harnessIdForTargetKey(targetKey), harnessId);
    assert.equal(targetKeyForHarnessId(harnessId), targetKey);
  }
  for (const [harnessId, targetKey] of Object.entries(HARNESS_ID_TO_TARGET_KEY)) {
    assert.equal(TARGET_KEY_TO_HARNESS_ID[targetKey], harnessId);
  }
  // The split that motivated the table: two spellings, one harness.
  assert.equal(harnessIdForTargetKey('claude'), 'claude-code');
  assert.equal(targetKeyForHarnessId('claude-code'), 'claude');
});

test('an unknown target key / harness id is a clear error, never a silent no-op', () => {
  assert.throws(() => harnessIdForTargetKey('cluade'), /unknown mcp\.json target key "cluade"/);
  assert.throws(() => harnessIdForTargetKey('claude-code'), /unknown mcp\.json target key/); // id, not a key
  assert.throws(() => targetKeyForHarnessId('claude'), /unknown mcp harness id "claude"/); // key, not an id
  assert.throws(() => targetKeyForHarnessId(undefined), /unknown mcp harness id/);

  const server = { name: 'x', targets: { claude: true }, targetOverrides: { claude: { command: 'y' } } };
  assert.throws(() => isTargetedAt(server, 'claude'), /unknown mcp harness id/);
  assert.throws(() => applyTargetOverride(server, 'claude'), /unknown mcp harness id/);
});

test('loadLayer: a misspelled targets key throws instead of silently disabling the server', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'mcp.json');
    writeJson(filePath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{
        name: 'x',
        transport: 'stdio',
        command: 'x',
        args: [],
        env: {},
        targets: { 'claude-code': true, codex: false, omp: false }, // internal id used as a data key
      }],
    });
    assert.throws(() => loadLayer(filePath), /targets\.claude-code is not a known target key/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLayer: a misspelled targetOverrides key throws too; `_comment` keys are allowed', () => {
  const dir = makeTmpDir();
  try {
    const badPath = path.join(dir, 'bad.json');
    writeJson(badPath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{
        name: 'x', transport: 'stdio', command: 'x', args: [], env: {},
        targets: { claude: true, codex: false, omp: false },
        targetOverrides: { cluade: { command: 'y' } },
      }],
    });
    assert.throws(() => loadLayer(badPath), /targetOverrides\.cluade is not a known target key/);

    const okPath = path.join(dir, 'ok.json');
    writeJson(okPath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{
        name: 'x', transport: 'stdio', command: 'x', args: [], env: {},
        targets: { claude: true, codex: false, omp: false, _comment: 'why' },
      }],
    });
    assert.equal(loadLayer(okPath).servers.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the claude writer registers under the same harness id the claude reader stamps', () => {
  assert.equal(claudeWriter.HARNESS_ID, 'claude-code');
  assert.equal(claudeWriter.HARNESS_ID, claudeReader.HARNESS_ID);
  assert.ok(Object.hasOwn(DEFAULT_READERS, claudeWriter.HARNESS_ID),
    `DEFAULT_READERS should be keyed by "${claudeWriter.HARNESS_ID}"`);

  // Empirical: what the reader actually stamps on a record.
  const dir = makeTmpDir();
  try {
    const configPath = path.join(dir, '.claude.json');
    writeJson(configPath, { mcpServers: { x: { type: 'stdio', command: 'x', args: [] } } });
    const [record] = claudeReader.readClaudeCodeMcp({ userConfigPath: configPath });
    assert.equal(record.source.harness, claudeWriter.HARNESS_ID);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every writer HARNESS_ID is a known harness id in the mapping table', () => {
  for (const writer of [claudeWriter, codexWriter, ompWriter]) {
    assert.equal(typeof writer.HARNESS_ID, 'string');
    assert.ok(Object.hasOwn(HARNESS_ID_TO_TARGET_KEY, writer.HARNESS_ID),
      `writer harness id "${writer.HARNESS_ID}" is not in HARNESS_ID_TO_TARGET_KEY`);
  }
  assert.equal(targetKeyForHarnessId(codexWriter.HARNESS_ID), 'codex');
  assert.equal(targetKeyForHarnessId(ompWriter.HARNESS_ID), 'omp');
});

test('the user-facing targets.claude flag still selects the Claude Code writer, in core/mcp.json too', () => {
  const on = { name: 'on', transport: 'stdio', command: 'on', args: [], env: {}, targets: { claude: true, codex: false, omp: false } };
  const off = { name: 'off', transport: 'stdio', command: 'off', args: [], env: {}, targets: { claude: false, codex: true, omp: true } };
  assert.deepEqual(Object.keys(buildClaudeMcpServers([on, off])), ['on']);
  assert.equal(isTargetedAt(on, claudeWriter.HARNESS_ID), true);
  assert.equal(isTargetedAt(off, claudeWriter.HARNESS_ID), false);

  // ...and against the real layer: emitted set === servers whose targets.claude is true.
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
  const coreServers = loadLayer(path.join(repoRoot, 'core', 'mcp.json')).servers;
  const expected = coreServers.filter(s => s.targets && s.targets.claude === true).map(s => s.name);
  assert.ok(expected.length > 0, 'core/mcp.json should still target Claude Code for at least one server');
  assert.deepEqual(Object.keys(buildClaudeMcpServers(coreServers)), expected);
});

test('targetOverrides are looked up by harness id via the same table', () => {
  const server = {
    name: 'serena',
    transport: 'stdio',
    command: 'uvx',
    args: ['--context', 'claude-code'],
    env: {},
    targets: { claude: true, codex: true, omp: true },
    targetOverrides: { claude: { args: ['--context', 'claude'] }, codex: { args: ['--context', 'codex'] } },
  };
  assert.deepEqual(applyTargetOverride(server, claudeWriter.HARNESS_ID).args, ['--context', 'claude']);
  assert.deepEqual(applyTargetOverride(server, codexWriter.HARNESS_ID).args, ['--context', 'codex']);
  assert.deepEqual(applyTargetOverride(server, ompWriter.HARNESS_ID).args, ['--context', 'claude-code']); // no omp override
});

// -----------------------------------------------------------------------------
// source.js: load / merge / secret-reference rule
// -----------------------------------------------------------------------------

test('loadLayer: a missing file is an empty layer', () => {
  const dir = makeTmpDir();
  try {
    const layer = loadLayer(path.join(dir, 'nope.json'));
    assert.deepEqual(layer, { schemaVersion: 'ecc.mcp.v1', servers: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLayer: rejects an unsupported schemaVersion', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'mcp.json');
    writeJson(filePath, { schemaVersion: 'other.v2', servers: [] });
    assert.throws(() => loadLayer(filePath), /unsupported schemaVersion/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLayer: a literal secret-shaped value throws — the dropped local Figma template entry', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'mcp.json');
    writeJson(filePath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{
        name: 'figma',
        transport: 'stdio',
        command: 'npx',
        args: ['tsx', './.tmp/mcp/FigmaMCP/src/index.ts'],
        env: { FIGMA_API_KEY: 'sk-ant-abcdefghijklmnopqrstuvwxyz012345' },
        targets: { claude: false, codex: true, omp: false },
      }],
    });
    assert.throws(() => loadLayer(filePath), /looks like a literal secret/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLayer: a secret-shaped KEY name with a placeholder literal also throws (never literal, always a reference)', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'mcp.json');
    writeJson(filePath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{
        name: 'figma',
        transport: 'stdio',
        command: 'npx',
        args: [],
        env: { FIGMA_API_KEY: '' },
        targets: { claude: false, codex: true, omp: false },
      }],
    });
    assert.throws(() => loadLayer(filePath), /looks like a literal secret/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadLayer: the ${ENV_VAR} reference form for the same key is allowed', () => {
  const dir = makeTmpDir();
  try {
    const filePath = path.join(dir, 'mcp.json');
    writeJson(filePath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{
        name: 'figma',
        transport: 'stdio',
        command: 'npx',
        args: [],
        env: { FIGMA_API_KEY: '${FIGMA_API_KEY}' },
        targets: { claude: false, codex: true, omp: false },
      }],
    });
    const layer = loadLayer(filePath);
    assert.equal(layer.servers[0].env.FIGMA_API_KEY, '${FIGMA_API_KEY}');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAndMerge: a personal-layer server of the same name entirely replaces core\'s', () => {
  const dir = makeTmpDir();
  try {
    const corePath = path.join(dir, 'core.json');
    const personalPath = path.join(dir, 'personal.json');
    writeJson(corePath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [
        { name: 'a', transport: 'stdio', command: 'core-cmd', args: [], env: {}, targets: { claude: true, codex: false, omp: false } },
        { name: 'b', transport: 'http', url: 'https://core.example/mcp', env: {}, targets: { claude: true, codex: false, omp: false } },
      ],
    });
    writeJson(personalPath, {
      schemaVersion: 'ecc.mcp.v1',
      servers: [{ name: 'a', transport: 'stdio', command: 'personal-cmd', args: [], env: {}, targets: { claude: true, codex: false, omp: false } }],
    });

    const merged = loadAndMerge([corePath, personalPath]);
    assert.equal(merged.length, 2); // 'a' replaced in place, 'b' untouched
    assert.equal(merged.find(s => s.name === 'a').command, 'personal-cmd');
    assert.equal(merged.find(s => s.name === 'b').url, 'https://core.example/mcp');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveHome: substitutes {{HOME}} in command/args/env/url and inside targetOverrides', () => {
  const servers = [{
    name: 'codebase-memory-mcp',
    transport: 'stdio',
    command: '{{HOME}}/bin/codebase-memory-mcp-managed',
    args: ['--root', '{{HOME}}/repos'],
    env: { X: '{{HOME}}/x' },
    targets: { claude: false, codex: true, omp: true },
    targetOverrides: { omp: { command: '{{HOME}}/bin/alt' } },
  }];
  const [resolved] = resolveHome(servers, '/Users/exampleperson');
  assert.equal(resolved.command, '/Users/exampleperson/bin/codebase-memory-mcp-managed');
  assert.deepEqual(resolved.args, ['--root', '/Users/exampleperson/repos']);
  assert.equal(resolved.env.X, '/Users/exampleperson/x');
  assert.equal(resolved.targetOverrides.omp.command, '/Users/exampleperson/bin/alt');
});

// -----------------------------------------------------------------------------
// writers/claude.js
// -----------------------------------------------------------------------------

const SAMPLE_SERVERS = [
  { name: 'figma-remote', transport: 'http', url: 'https://mcp.figma.com/mcp', env: {}, targets: { claude: true, codex: false, omp: false } },
  { name: 'figma-desktop', transport: 'http', url: 'http://127.0.0.1:3845/mcp', env: {}, targets: { claude: true, codex: false, omp: false } },
  {
    name: 'serena',
    transport: 'stdio',
    command: 'uvx',
    args: ['-p', '3.13', 'serena-agent==1.5.3', 'start-mcp-server', '--project-from-cwd', '--context', 'claude-code'],
    env: {},
    targets: { claude: false, codex: true, omp: true },
    targetOverrides: {
      codex: { args: ['-p', '3.13', 'serena-agent==1.5.3', 'start-mcp-server', '--project-from-cwd', '--context', 'codex'] },
      omp: { args: ['-p', '3.13', 'serena-agent==1.5.3', 'start-mcp-server', '--project-from-cwd', '--context', 'codex'] },
    },
  },
  { name: 'codebase-memory-mcp', transport: 'stdio', command: '{{HOME}}/bin/codebase-memory-mcp-managed', args: [], env: {}, targets: { claude: false, codex: true, omp: true } },
];

test('writers/claude.js: golden output — only the two figma servers, matching today\'s settings.layer.json exactly', () => {
  const result = buildClaudeMcpServers(SAMPLE_SERVERS);
  assert.deepEqual(result, {
    'figma-remote': { url: 'https://mcp.figma.com/mcp', type: 'http' },
    'figma-desktop': { url: 'http://127.0.0.1:3845/mcp', type: 'http' },
  });
});

test('writers/claude.js: convert() reads the real repo mcp.json layers and reproduces today\'s figma-only output', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
  const coreMcp = path.join(repoRoot, 'core', 'mcp.json');
  const personalMcp = path.join(repoRoot, 'personal', 'mcp.json');
  assert.ok(fs.existsSync(coreMcp), `expected ${coreMcp} to exist`);

  const result = convertClaude([coreMcp, personalMcp]);
  assert.deepEqual(result, {
    'figma-remote': { url: 'https://mcp.figma.com/mcp', type: 'http' },
    'figma-desktop': { url: 'http://127.0.0.1:3845/mcp', type: 'http' },
  });
});

test('writers/claude.js: an env-bearing server carries env, an empty one omits the key', () => {
  const withEnv = { name: 'x', transport: 'stdio', command: 'x', args: [], env: { FOO: '${FOO}' }, targets: { claude: true, codex: false, omp: false } };
  const withoutEnv = { name: 'y', transport: 'stdio', command: 'y', args: [], env: {}, targets: { claude: true, codex: false, omp: false } };
  const result = buildClaudeMcpServers([withEnv, withoutEnv]);
  assert.deepEqual(result.x, { command: 'x', args: [], type: 'stdio', env: { FOO: '${FOO}' } });
  assert.deepEqual(result.y, { command: 'y', args: [], type: 'stdio' });
});

// -----------------------------------------------------------------------------
// writers/codex.js
// -----------------------------------------------------------------------------

test('writers/codex.js: golden output — stdio and http tables, codex targetOverrides applied', () => {
  const { toml, warnings } = buildMcpServersToml(SAMPLE_SERVERS, '');
  assert.deepEqual(warnings, []);
  assert.equal(
    toml,
    [
      '[mcp_servers.serena]',
      'type = "stdio"',
      'command = "uvx"',
      'args = ["-p", "3.13", "serena-agent==1.5.3", "start-mcp-server", "--project-from-cwd", "--context", "codex"]',
      '',
      '[mcp_servers.codebase-memory-mcp]',
      'type = "stdio"',
      'command = "{{HOME}}/bin/codebase-memory-mcp-managed"',
      'args = []',
    ].join('\n')
  );
});

test('writers/codex.js: an http server matches the working config.toml.template shape (command = "")', () => {
  const toml = toTomlTable({ name: 'notion-mcp', transport: 'http', url: 'https://mcp.notion.com/mcp' });
  assert.equal(toml, '[mcp_servers.notion-mcp]\ncommand = ""\ntype = "http"\nurl = "https://mcp.notion.com/mcp"');
});

test('writers/codex.js: a server env table is appended as [mcp_servers.<name>.env]', () => {
  const toml = toTomlTable({ name: 'x', transport: 'stdio', command: 'x', args: [], env: { FOO: '${FOO}' } });
  assert.equal(toml, '[mcp_servers.x]\ntype = "stdio"\ncommand = "x"\nargs = []\n[mcp_servers.x.env]\nFOO = "${FOO}"');
});

test('findServerNamesInText: finds every [mcp_servers.<name>] table header', () => {
  const text = '[projects."/repo"]\ntrust_level = "trusted"\n\n[mcp_servers.serena]\ncommand = "uvx"\n';
  assert.deepEqual([...findServerNamesInText(text)], ['serena']);
});

test('writers/codex.js: a same-named table already declared outside the block is left alone and reported', () => {
  const outside = '[mcp_servers.serena]\ncommand = "hand-added"\n';
  const { toml, warnings } = buildMcpServersToml(SAMPLE_SERVERS, outside);
  assert.ok(!toml.includes('mcp_servers.serena'));
  assert.ok(toml.includes('mcp_servers.codebase-memory-mcp')); // the non-conflicting one still emitted
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /mcp_servers\.serena.*already declared outside the managed block/);
});

test('writers/codex.js: only targets.codex === true servers are emitted (figma servers excluded)', () => {
  const { toml } = buildMcpServersToml(SAMPLE_SERVERS, '');
  assert.ok(!toml.includes('figma'));
});

// -----------------------------------------------------------------------------
// writers/omp.js
// -----------------------------------------------------------------------------

test('writers/omp.js: golden output — stdio servers, omp targetOverrides applied, http mapped to streamable-http', () => {
  const servers = [...SAMPLE_SERVERS, { name: 'notion-mcp', transport: 'http', url: 'https://mcp.notion.com/mcp', env: {}, targets: { claude: false, codex: true, omp: true } }];
  const result = buildOmpMcpServers(servers);
  assert.deepEqual(result, {
    serena: {
      type: 'stdio',
      command: 'uvx',
      args: ['-p', '3.13', 'serena-agent==1.5.3', 'start-mcp-server', '--project-from-cwd', '--context', 'codex'],
    },
    'codebase-memory-mcp': { type: 'stdio', command: '{{HOME}}/bin/codebase-memory-mcp-managed' },
    'notion-mcp': { type: 'streamable-http', url: 'https://mcp.notion.com/mcp' },
  });
});

test('writers/omp.js: an empty args array is omitted, matching the pre-T13 hardcoded shape', () => {
  const result = toOmpEntry({ name: 'codebase-memory-mcp', transport: 'stdio', command: '/x/bin/codebase-memory-mcp-managed', args: [], env: {} });
  assert.deepEqual(result, { type: 'stdio', command: '/x/bin/codebase-memory-mcp-managed' });
});

test('writers/omp.js: figma servers (targets.omp === false) are excluded', () => {
  const result = buildOmpMcpServers(SAMPLE_SERVERS);
  assert.ok(!('figma-remote' in result));
  assert.ok(!('figma-desktop' in result));
});
