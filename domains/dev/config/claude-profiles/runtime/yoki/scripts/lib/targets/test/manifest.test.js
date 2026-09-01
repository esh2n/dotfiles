'use strict';

/**
 * The `--prune` blast radius. `remove` ops are the one destructive thing this
 * generator does, they are driven by a JSON file living in the user's home
 * dir, and they call fs.rmSync(recursive). These tests pin both halves of the
 * containment contract: the manifest can only ever RECORD paths under `out`,
 * and a manifest that nevertheless LISTS one outside `out` is rejected whole
 * (no partial prune) rather than obeyed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  manifestRelativePath,
  manifestPathFor,
  manifestDestinations,
  readManifest,
  buildPruneOperations,
} = require('../manifest');
const gen = require('../gen');

function tmpdir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

const readJson = p => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

test('manifestRelativePath/manifestPathFor: <out>/.yoki/<target>-manifest.json', () => {
  assert.equal(manifestRelativePath('codex'), path.join('.yoki', 'codex-manifest.json'));
  assert.equal(manifestRelativePath('omp'), path.join('.yoki', 'omp-manifest.json'));
  assert.equal(manifestPathFor('/o', 'omp'), path.join('/o', '.yoki', 'omp-manifest.json'));
});

test('manifestDestinations: records per-layer outputs under out, drops generated singletons and out-of-root ports', () => {
  const out = tmpdir('yoki-manifest-dest-');
  const home = path.dirname(out);
  const ops = [
    { kind: 'write', destinationPath: path.join(out, 'hooks.json'), layer: 'generated' },
    { kind: 'write', destinationPath: path.join(out, 'agents', 'a.md'), layer: '/src/core' },
    { kind: 'symlink', destinationPath: path.join(out, 'skills', 'ported'), layer: '/src/core' },
    { kind: 'symlink', destinationPath: path.join(home, '.agents', 'skills', 'plain'), layer: '/src/core' },
    { kind: 'remove', destinationPath: path.join(out, 'agents', 'gone.md'), layer: 'generated' },
  ];
  assert.deepEqual(manifestDestinations(ops, out), [
    path.join(out, 'agents', 'a.md'),
    path.join(out, 'skills', 'ported'),
  ]);
});

test('readManifest: absent manifest -> [] (nothing to prune, not an error)', () => {
  const out = tmpdir('yoki-manifest-absent-');
  assert.deepEqual(readManifest(manifestPathFor(out, 'codex'), out, readJson), []);
});

test('readManifest: a hostile entry outside out is rejected whole, with a clear error', () => {
  const out = tmpdir('yoki-manifest-hostile-');
  const victim = tmpdir('yoki-manifest-victim-');
  const manifestPath = manifestPathFor(out, 'codex');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify([path.join(out, 'agents', 'a.toml'), victim]), 'utf8');

  assert.throws(
    () => readManifest(manifestPath, out, readJson),
    err => /Refusing to prune/.test(err.message) && err.message.includes(victim) && /No files were removed/.test(err.message)
  );
});

test('readManifest: a non-string entry is rejected too', () => {
  const out = tmpdir('yoki-manifest-shape-');
  const manifestPath = manifestPathFor(out, 'codex');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify([{ destinationPath: '/etc/passwd' }]), 'utf8');
  assert.throws(() => readManifest(manifestPath, out, readJson), /Refusing to prune/);
});

test('buildPruneOperations: only manifest entries the current plan no longer produces', () => {
  const out = tmpdir('yoki-manifest-prune-');
  const manifestPath = manifestPathFor(out, 'omp');
  const kept = path.join(out, 'agents', 'kept.md');
  const gone = path.join(out, 'agents', 'gone.md');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify([kept, gone]), 'utf8');

  assert.deepEqual(
    buildPruneOperations({ manifestPath, out, prunableDestinations: [kept], prune: true, readJsonIfExists: readJson }),
    [{ kind: 'remove', destinationPath: gone, layer: 'generated' }]
  );
  assert.deepEqual(
    buildPruneOperations({ manifestPath, out, prunableDestinations: [kept], prune: false, readJsonIfExists: readJson }),
    []
  );
});

// ---------------------------------------------------------------------------
// gen.apply(): the guard that actually stands between a crafted manifest and
// fs.rmSync. Even if a remove op reaches apply() by some other route, it must
// be refused unless it is inside `out` — no $HOME fallback.
// ---------------------------------------------------------------------------

test('gen.apply: a remove op outside out is refused, and the target survives', () => {
  const home = tmpdir('yoki-gen-remove-home-');
  const out = path.join(home, '.codex');
  fs.mkdirSync(out, { recursive: true });

  const victimDir = path.join(home, 'Documents');
  fs.mkdirSync(victimDir, { recursive: true });
  fs.writeFileSync(path.join(victimDir, 'thesis.txt'), 'important', 'utf8');

  assert.throws(
    () => gen.apply({
      target: 'codex',
      out,
      home,
      sources: [],
      operations: [{ kind: 'remove', destinationPath: victimDir, layer: 'generated' }],
      warnings: [],
    }),
    /Refusing to remove/
  );
  assert.ok(fs.existsSync(path.join(victimDir, 'thesis.txt')), '$HOME must not be a trusted root for remove');
});

test('gen.apply: a remove op inside out is performed', () => {
  const home = tmpdir('yoki-gen-remove-ok-');
  const out = path.join(home, '.omp', 'agent');
  fs.mkdirSync(path.join(out, 'agents'), { recursive: true });
  const stale = path.join(out, 'agents', 'stale.md');
  fs.writeFileSync(stale, 'x', 'utf8');

  gen.apply({
    target: 'omp',
    out,
    home,
    sources: [],
    operations: [{ kind: 'remove', destinationPath: stale, layer: 'generated' }],
    warnings: [],
  });
  assert.equal(fs.existsSync(stale), false);
});

test('gen.apply: a remove op whose leaf IS a symlink pointing out of root still works (omp config.yml case)', () => {
  const home = tmpdir('yoki-gen-remove-symlink-');
  const out = path.join(home, '.omp', 'agent');
  fs.mkdirSync(out, { recursive: true });
  const repoFile = path.join(home, 'repo-config.yml');
  fs.writeFileSync(repoFile, 'from repo', 'utf8');
  const link = path.join(out, 'config.yml');
  fs.symlinkSync(repoFile, link);

  gen.apply({
    target: 'omp',
    out,
    home,
    sources: [],
    operations: [{ kind: 'remove', destinationPath: link, layer: 'generated' }],
    warnings: [],
  });
  assert.equal(fs.existsSync(link), false);
  assert.ok(fs.existsSync(repoFile), 'only the link is removed, never what it pointed at');
});
