'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseExternalLinksYaml,
  loadLayer,
  dedupeEntries,
  expandHome,
  resolveDestPath,
  resolveEntry,
  loadAndResolve,
} = require('../external-links');

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// parseExternalLinksYaml
// ---------------------------------------------------------------------------

test('parseExternalLinksYaml reads the real personal/external-links.yaml entry shape', () => {
  const text = '- {dest: commands/prompts, src: ~/.config/prompts/global, purpose: prompt-save skill が保存する共有プロンプト}\n';
  const entries = parseExternalLinksYaml(text);
  assert.deepEqual(entries, [
    { dest: 'commands/prompts', src: '~/.config/prompts/global', purpose: 'prompt-save skill が保存する共有プロンプト' },
  ]);
});

test('parseExternalLinksYaml ignores blank lines and full-line comments', () => {
  const text = [
    '# a comment',
    '',
    '- {dest: skills/foo, src: /abs/path}',
    '  ',
    '# another comment',
  ].join('\n');
  const entries = parseExternalLinksYaml(text);
  assert.deepEqual(entries, [{ dest: 'skills/foo', src: '/abs/path', purpose: '' }]);
});

test('parseExternalLinksYaml handles quoted values and multiple entries', () => {
  const text = [
    '- {dest: commands/a, src: "~/a", purpose: "quoted, with a comma"}',
    "- {dest: commands/b, src: '~/b', purpose: 'single quoted'}",
  ].join('\n');
  const entries = parseExternalLinksYaml(text);
  assert.deepEqual(entries, [
    { dest: 'commands/a', src: '~/a', purpose: 'quoted, with a comma' },
    { dest: 'commands/b', src: '~/b', purpose: 'single quoted' },
  ]);
});

test('parseExternalLinksYaml requires both dest and src', () => {
  assert.throws(() => parseExternalLinksYaml('- {dest: commands/a}'), /requires both "dest" and "src"/);
  assert.throws(() => parseExternalLinksYaml('- {src: ~/a}'), /requires both "dest" and "src"/);
});

test('parseExternalLinksYaml rejects a line that is not a flow-mapping list item', () => {
  assert.throws(() => parseExternalLinksYaml('dest: commands/a\n'), /unrecognized line/);
});

// ---------------------------------------------------------------------------
// loadLayer
// ---------------------------------------------------------------------------

test('loadLayer treats a missing file as an empty layer', () => {
  assert.deepEqual(loadLayer('/nonexistent/external-links.yaml'), []);
});

test('loadLayer parses a real file on disk', () => {
  const dir = makeTmpDir('yoki-external-links-load-');
  try {
    const file = path.join(dir, 'external-links.yaml');
    fs.writeFileSync(file, '- {dest: commands/prompts, src: ~/.config/prompts/global, purpose: test}\n');
    assert.deepEqual(loadLayer(file), [{ dest: 'commands/prompts', src: '~/.config/prompts/global', purpose: 'test' }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// dedupeEntries
// ---------------------------------------------------------------------------

test('dedupeEntries drops an identical (dest, src) pair from a later layer, keeping the first', () => {
  const entries = [
    { dest: 'commands/prompts', src: '~/.config/prompts/global', purpose: 'core' },
    { dest: 'commands/prompts', src: '~/.config/prompts/global', purpose: 'personal override attempt' },
  ];
  assert.deepEqual(dedupeEntries(entries), [{ dest: 'commands/prompts', src: '~/.config/prompts/global', purpose: 'core' }]);
});

test('dedupeEntries keeps entries whose dest OR src differs', () => {
  const entries = [
    { dest: 'commands/a', src: '~/a', purpose: '' },
    { dest: 'commands/a', src: '~/b', purpose: '' },
    { dest: 'commands/c', src: '~/a', purpose: '' },
  ];
  assert.equal(dedupeEntries(entries).length, 3);
});

// ---------------------------------------------------------------------------
// expandHome / resolveDestPath / resolveEntry
// ---------------------------------------------------------------------------

test('expandHome expands a leading ~ and ~/, passes absolute paths through', () => {
  assert.equal(expandHome('~', '/home/exampleperson'), '/home/exampleperson');
  assert.equal(expandHome('~/.config/prompts/global', '/home/exampleperson'), path.join('/home/exampleperson', '.config/prompts/global'));
  assert.equal(expandHome('/already/absolute', '/home/exampleperson'), '/already/absolute');
});

test('resolveDestPath lands "commands/prompts" in the commands staging dir', () => {
  assert.equal(
    resolveDestPath('/home/exampleperson/.claude', 'commands/prompts'),
    path.join('/home/exampleperson/.claude', '.commands-merged', 'prompts')
  );
});

test('resolveDestPath supports a nested rest path', () => {
  assert.equal(
    resolveDestPath('/home/exampleperson/.claude', 'skills/foo/bar'),
    path.join('/home/exampleperson/.claude', '.skills-merged', 'foo/bar')
  );
});

test('resolveDestPath rejects a dest with no "/"', () => {
  assert.throws(() => resolveDestPath('/home/exampleperson/.claude', 'commands'), /must be "<merge-dir>\/<rest>"/);
});

test('resolveEntry attaches srcExpanded and destPath without touching the original fields', () => {
  const entry = { dest: 'commands/prompts', src: '~/.config/prompts/global', purpose: 'p' };
  const resolved = resolveEntry(entry, { home: '/home/exampleperson', claudeDir: '/home/exampleperson/.claude' });
  assert.equal(resolved.dest, 'commands/prompts');
  assert.equal(resolved.src, '~/.config/prompts/global');
  assert.equal(resolved.purpose, 'p');
  assert.equal(resolved.srcExpanded, path.join('/home/exampleperson', '.config/prompts/global'));
  assert.equal(resolved.destPath, path.join('/home/exampleperson/.claude', '.commands-merged', 'prompts'));
});

// ---------------------------------------------------------------------------
// loadAndResolve (core -> packs -> personal precedence)
// ---------------------------------------------------------------------------

test('loadAndResolve unions layers in order and dedupes identical entries across them', () => {
  const dir = makeTmpDir('yoki-external-links-merge-');
  try {
    const core = path.join(dir, 'core.yaml');
    const personal = path.join(dir, 'personal.yaml');
    fs.writeFileSync(core, '- {dest: commands/prompts, src: ~/.config/prompts/global, purpose: shared}\n');
    fs.writeFileSync(
      personal,
      ['- {dest: commands/prompts, src: ~/.config/prompts/global, purpose: shared}', '- {dest: skills/extra, src: /abs/extra}'].join(
        '\n'
      )
    );

    const resolved = loadAndResolve([core, personal], { home: '/home/exampleperson', claudeDir: '/home/exampleperson/.claude' });
    assert.equal(resolved.length, 2);
    assert.equal(resolved[0].dest, 'commands/prompts');
    assert.equal(resolved[1].dest, 'skills/extra');
    assert.equal(resolved[1].srcExpanded, '/abs/extra');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAndResolve treats a missing layer file as empty rather than throwing', () => {
  const dir = makeTmpDir('yoki-external-links-missing-');
  try {
    const personal = path.join(dir, 'personal.yaml');
    fs.writeFileSync(personal, '- {dest: commands/prompts, src: ~/x}\n');
    const resolved = loadAndResolve([path.join(dir, 'core-does-not-exist.yaml'), personal], {
      home: '/home/exampleperson',
      claudeDir: '/home/exampleperson/.claude',
    });
    assert.equal(resolved.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
