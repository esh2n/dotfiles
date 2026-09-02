'use strict';

/**
 * catalog.js — the generator that renders the "which workflow when" table
 * into core/skills/yoki-graph/SKILL.md between `<!-- catalog:begin -->` /
 * `<!-- catalog:end -->`.
 *
 * Two halves are tested:
 *   1. Against a FIXTURE profiles tree (YOKI_PROFILES_ROOT), so ordering,
 *      pack labelling, cell escaping and the marker contract are pinned
 *      without depending on which workflows the repo happens to ship.
 *   2. Against the REAL checked-in layers, so the shipped SKILL.md block is
 *      asserted fresh (this is the staleness check the validator runs) and
 *      every workflow script's meta is asserted parseable and complete —
 *      a script that lands with no `whenToUse` fails here, not silently in
 *      a blank table cell.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const catalog = require('../catalog');

const REAL_ROOT = catalog.profilesRoot({});

function writeScript(file, meta) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `export const meta = ${JSON.stringify(meta, null, 2)}\n\nreturn { ok: true }\n`);
}

/** A throwaway claude-profiles-shaped tree: core/workflows + two packs. */
function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-catalog-'));
  writeScript(path.join(root, 'core', 'workflows', 'zeta.js'), {
    name: 'zeta', description: 'Z desc', whenToUse: 'Z when',
  });
  writeScript(path.join(root, 'core', 'workflows', 'alpha.js'), {
    name: 'alpha', description: 'A | piped desc', whenToUse: 'A when',
  });
  // core/workflows/lib/ holds shared helpers, not workflows.
  fs.mkdirSync(path.join(root, 'core', 'workflows', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'workflows', 'lib', 'lanes.js'), 'module.exports = {}\n');

  writeScript(path.join(root, 'packs', 'go', 'workflows', 'go-thing.js'), {
    name: 'go-thing', description: 'Go desc', whenToUse: 'Go when',
  });
  writeScript(path.join(root, 'packs', 'aaa', 'workflows', 'aaa-thing.js'), {
    name: 'aaa-thing', description: 'AAA desc', whenToUse: 'AAA when',
  });
  // A pack with no workflows/ dir must simply contribute nothing.
  fs.mkdirSync(path.join(root, 'packs', 'empty', 'rules'), { recursive: true });

  fs.mkdirSync(path.join(root, 'core', 'skills', 'yoki-graph'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'core', 'skills', 'yoki-graph', 'SKILL.md'),
    `# t\n\n${catalog.CATALOG_BEGIN}\nstale\n${catalog.CATALOG_END}\n\ntail\n`,
  );
  return root;
}

test('workflowSources: core first (alphabetical), then packs alphabetically; lib/ and pack-without-workflows contribute nothing', () => {
  const root = makeFixtureRoot();
  try {
    const got = catalog.workflowSources(root).map((s) => [path.basename(s.file), s.layer]);
    assert.deepEqual(got, [
      ['alpha.js', 'core'],
      ['zeta.js', 'core'],
      ['aaa-thing.js', 'pack:aaa'],
      ['go-thing.js', 'pack:go'],
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readCatalog: pulls name/description/whenToUse out of every script meta', () => {
  const root = makeFixtureRoot();
  try {
    const entries = catalog.readCatalog(root);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries[0], {
      ...entries[0],
      name: 'alpha',
      description: 'A | piped desc',
      whenToUse: 'A when',
      layer: 'core',
      pack: null,
    });
    assert.equal(entries[3].pack, 'go');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readCatalog: an unparseable meta is a hard error naming the file, never a skipped row', () => {
  const root = makeFixtureRoot();
  try {
    fs.writeFileSync(path.join(root, 'core', 'workflows', 'broken.js'), 'const meta = {}\n');
    assert.throws(() => catalog.readCatalog(root), /broken\.js/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderCatalogTable: one row per workflow, pack-gated rows labelled, `|` escaped so a row never breaks', () => {
  const root = makeFixtureRoot();
  try {
    const table = catalog.renderCatalogTable(catalog.readCatalog(root));
    const rows = table.split('\n').filter((l) => l.startsWith('| '));
    assert.equal(rows.length, 2 + 4); // header + separator + 4 workflows
    assert.match(table, /\| `alpha` \| A \\\| piped desc \| A when \|/);
    assert.match(table, /\| `go-thing` \(go pack\) \| Go desc \| Go when \|/);
    assert.doesNotMatch(table, /`zeta` \(.* pack\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('applyCatalogBlock: replaces only between the markers and keeps the rest byte-for-byte', () => {
  const before = `head\n${catalog.CATALOG_BEGIN}\nold\n${catalog.CATALOG_END}\ntail\n`;
  const after = catalog.applyCatalogBlock(before, 'new table');
  assert.equal(after, `head\n${catalog.CATALOG_BEGIN}\nnew table\n${catalog.CATALOG_END}\ntail\n`);
  assert.equal(catalog.extractCatalogBlock(after), 'new table');
});

test('applyCatalogBlock: missing or reversed markers throw rather than growing a second table', () => {
  assert.throws(() => catalog.applyCatalogBlock('no markers here', 'x'), /markers not found/);
  assert.throws(
    () => catalog.applyCatalogBlock(`${catalog.CATALOG_END}\n${catalog.CATALOG_BEGIN}`, 'x'),
    /out of order/,
  );
});

test('writeCatalog: writes once, then is a no-op (so `yoki-switch apply` never dirties the checkout)', () => {
  const root = makeFixtureRoot();
  try {
    assert.equal(catalog.checkCatalog(root).fresh, false);
    assert.equal(catalog.writeCatalog(root).changed, true);
    assert.equal(catalog.checkCatalog(root).fresh, true);
    assert.equal(catalog.writeCatalog(root).changed, false);
    const md = fs.readFileSync(catalog.skillMdPath(root), 'utf8');
    assert.match(md, /^tail$/m);
    assert.doesNotMatch(md, /^stale$/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- against the real checked-in layers -------------------------------------

test('real layers: every shipped workflow has a parseable meta with name, description and whenToUse', () => {
  const entries = catalog.readCatalog(REAL_ROOT);
  assert.ok(entries.length >= 10, `expected >=10 workflows, got ${entries.length}`);
  for (const e of entries) {
    assert.ok(e.name, `${e.file}: meta.name is empty`);
    assert.ok(e.description, `${e.name}: meta.description is empty`);
    assert.ok(e.whenToUse, `${e.name}: meta.whenToUse is empty`);
  }
  const names = entries.map((e) => e.name);
  for (const required of ['review', 'research', 'implement', 'go-optimize']) {
    assert.ok(names.includes(required), `catalog is missing ${required}`);
  }
  assert.equal(entries.find((e) => e.name === 'go-optimize').pack, 'go');
});

// The frontmatter `description` is the discovery surface — it is what a
// harness matches a user's request against before the body is ever read —
// and it enumerates the graphs by name. That enumeration is hand-written,
// sits directly above a GENERATED table, and is exactly the kind of list
// this generator exists to stop drifting. It stays hand-written (the
// wording around the names is doing real triggering work), so it is pinned
// here instead: add a workflow without naming it in the description and
// this fails.
test('real layers: the yoki-graph frontmatter description names every workflow in the catalog', () => {
  const md = fs.readFileSync(catalog.skillMdPath(REAL_ROOT), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  assert.ok(fm, 'yoki-graph SKILL.md has no frontmatter');
  const description = /^description:\s*(.+)$/m.exec(fm[1]);
  assert.ok(description, 'yoki-graph frontmatter has no description');

  const missing = [];
  for (const { name } of catalog.readCatalog(REAL_ROOT)) {
    // Whole-token match: a bare `review` must not be satisfied by the
    // `review` inside `design-review`.
    const token = new RegExp(`(?<![a-z-])${name}(?![a-z-])`);
    if (!token.test(description[1])) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `the yoki-graph frontmatter description does not name: ${missing.join(', ')}`,
  );
});
test('real layers: the SKILL.md catalog block is up to date (regenerate with catalog.js --write)', () => {
  const { fresh, path: file, expected, actual } = catalog.checkCatalog(REAL_ROOT);
  assert.ok(
    fresh,
    `${file} catalog block is stale — run:\n`
    + '  node runtime/yoki/scripts/lib/graph/catalog.js --write\n'
    + `--- expected ---\n${expected}\n--- actual ---\n${actual}\n`,
  );
});
