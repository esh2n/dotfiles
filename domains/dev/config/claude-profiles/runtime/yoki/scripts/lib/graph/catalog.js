'use strict';

/**
 * Workflow catalog: the single source of the "which workflow when" table.
 *
 * The table in `core/skills/yoki-graph/SKILL.md` is NOT hand-maintained —
 * it is rendered from the scripts themselves (`export const meta = {name,
 * description, whenToUse}`) into a managed block delimited by
 * `<!-- catalog:begin -->` / `<!-- catalog:end -->`. A hand-written table
 * drifts the moment a workflow is added, renamed, or re-scoped; a rendered
 * one cannot.
 *
 * Sources are the checked-in layers, not `~/.claude/workflows` (which only
 * holds what the packs enabled on THIS machine installed — a catalog built
 * from it would silently omit `go-optimize` on a machine without the go
 * pack, and the skill ships to every machine). `runner.extractMeta` is
 * reused verbatim so the catalog reads a script's meta exactly the way the
 * runner does.
 *
 * CLI:
 *   node catalog.js --check   exit 1 when SKILL.md's block is stale
 *   node catalog.js --write   rewrite the block (no-op when already current)
 *   node catalog.js --print   print the rendered table to stdout
 */

const fs = require('fs');
const path = require('path');

const { extractMeta } = require('./runner');

const CATALOG_BEGIN = '<!-- catalog:begin -->';
const CATALOG_END = '<!-- catalog:end -->';

/** The `claude-profiles` checkout this file is installed from:
 *  runtime/yoki/scripts/lib/graph -> five levels up. `YOKI_PROFILES_ROOT`
 *  overrides it — the injection seam the unit tests build fixture trees
 *  against instead of the real layers. */
function profilesRoot(env = process.env) {
  const override = typeof env.YOKI_PROFILES_ROOT === 'string' ? env.YOKI_PROFILES_ROOT.trim() : '';
  return override || path.resolve(__dirname, '..', '..', '..', '..', '..');
}

/** Path of the SKILL.md whose catalog block this module owns. */
function skillMdPath(root = profilesRoot()) {
  return path.join(root, 'core', 'skills', 'yoki-graph', 'SKILL.md');
}

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Every workflow script the layers ship, in catalog order: core first,
 * then each pack (alphabetically), each group alphabetical by filename.
 *
 * `core/workflows/lib/` is a directory, so readdir's `.js` filter already
 * excludes it; the shared lane helpers there are not workflows.
 *
 * @param {string} [root] claude-profiles root
 * @returns {Array<{file: string, layer: string, pack: string|null}>}
 */
function workflowSources(root = profilesRoot()) {
  const out = listJsFiles(path.join(root, 'core', 'workflows'))
    .map((file) => ({ file, layer: 'core', pack: null }));

  const packsDir = path.join(root, 'packs');
  const packs = fs.existsSync(packsDir)
    ? fs.readdirSync(packsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    : [];

  for (const pack of packs) {
    for (const file of listJsFiles(path.join(packsDir, pack, 'workflows'))) {
      out.push({ file, layer: `pack:${pack}`, pack });
    }
  }
  return out;
}

/**
 * Read `meta` out of every workflow script.
 *
 * A script whose meta cannot be parsed is a hard error rather than a
 * skipped row: a silently missing row is exactly the drift this generator
 * exists to make impossible.
 *
 * @param {string} [root]
 * @returns {Array<{name, description, whenToUse, layer, pack, file}>}
 */
function readCatalog(root = profilesRoot()) {
  return workflowSources(root).map(({ file, layer, pack }) => {
    let meta;
    try {
      ({ meta } = extractMeta(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      throw new Error(`${path.relative(root, file)}: ${err.message}`);
    }
    const name = meta && typeof meta.name === 'string' && meta.name
      ? meta.name
      : path.basename(file, '.js');
    return {
      name,
      description: (meta && meta.description) || '',
      whenToUse: (meta && meta.whenToUse) || '',
      layer,
      pack,
      file,
    };
  });
}

/** A table cell must not break the row: `|` is escaped and any newline
 *  collapsed to a space. */
function cell(text) {
  return String(text || '').replace(/\s*\r?\n\s*/g, ' ').split('|').join('\\|').trim();
}

/**
 * @param {ReturnType<typeof readCatalog>} entries
 * @returns {string} the managed block's INNER content (no markers)
 */
function renderCatalogTable(entries) {
  const lines = [
    '<!-- GENERATED from core/workflows/*.js + packs/*/workflows/*.js by',
    '     runtime/yoki/scripts/lib/graph/catalog.js. Edit a script\'s `meta`, not this table. -->',
    '',
    '| workflow | 何をするか | いつ使うか |',
    '| --- | --- | --- |',
  ];
  for (const e of entries) {
    const label = e.pack ? `\`${e.name}\` (${e.pack} pack)` : `\`${e.name}\``;
    lines.push(`| ${label} | ${cell(e.description)} | ${cell(e.whenToUse)} |`);
  }
  return lines.join('\n');
}

/**
 * Replace the managed block's content in `markdown`.
 * @throws when the markers are missing or out of order — a SKILL.md that
 *   lost its markers must fail loudly, not grow a second table.
 */
function applyCatalogBlock(markdown, blockContent) {
  const text = String(markdown || '');
  const start = text.indexOf(CATALOG_BEGIN);
  const end = text.indexOf(CATALOG_END);
  if (start === -1 || end === -1) {
    throw new Error(`catalog markers not found (${CATALOG_BEGIN} / ${CATALOG_END})`);
  }
  if (end < start) throw new Error('catalog markers are out of order');
  const before = text.slice(0, start + CATALOG_BEGIN.length);
  const after = text.slice(end);
  return `${before}\n${blockContent}\n${after}`;
}

/** The current inner content of the managed block, or null when absent. */
function extractCatalogBlock(markdown) {
  const text = String(markdown || '');
  const start = text.indexOf(CATALOG_BEGIN);
  const end = text.indexOf(CATALOG_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start + CATALOG_BEGIN.length, end).replace(/^\n/, '').replace(/\n$/, '');
}

/**
 * @param {string} [root]
 * @returns {{fresh: boolean, path: string, expected: string, actual: string|null}}
 */
function checkCatalog(root = profilesRoot()) {
  const file = skillMdPath(root);
  const markdown = fs.readFileSync(file, 'utf8');
  const expected = renderCatalogTable(readCatalog(root));
  const actual = extractCatalogBlock(markdown);
  return { fresh: actual === expected, path: file, expected, actual };
}

/**
 * Rewrite the block when it differs. Writing only on a real difference
 * keeps `yoki-switch apply` from touching the checkout's mtime (and its
 * git status) on every run.
 * @returns {{changed: boolean, path: string}}
 */
function writeCatalog(root = profilesRoot()) {
  const file = skillMdPath(root);
  const markdown = fs.readFileSync(file, 'utf8');
  const next = applyCatalogBlock(markdown, renderCatalogTable(readCatalog(root)));
  if (next === markdown) return { changed: false, path: file };
  fs.writeFileSync(file, next);
  return { changed: true, path: file };
}

module.exports = {
  CATALOG_BEGIN,
  CATALOG_END,
  profilesRoot,
  skillMdPath,
  workflowSources,
  readCatalog,
  renderCatalogTable,
  applyCatalogBlock,
  extractCatalogBlock,
  checkCatalog,
  writeCatalog,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const mode = argv.find((a) => a === '--check' || a === '--write' || a === '--print') || '--check';
  const rootIdx = argv.indexOf('--profiles-root');
  const root = rootIdx !== -1 && argv[rootIdx + 1] ? path.resolve(argv[rootIdx + 1]) : profilesRoot();

  try {
    if (mode === '--print') {
      process.stdout.write(`${renderCatalogTable(readCatalog(root))}\n`);
    } else if (mode === '--write') {
      const { changed, path: file } = writeCatalog(root);
      process.stdout.write(changed ? `catalog: updated ${file}\n` : 'catalog: up to date\n');
    } else {
      const { fresh, path: file } = checkCatalog(root);
      if (fresh) {
        process.stdout.write('catalog: up to date\n');
      } else {
        process.stderr.write(
          `catalog: STALE — ${file} does not match core/workflows + packs/*/workflows.\n`
          + '  Run: node runtime/yoki/scripts/lib/graph/catalog.js --write\n',
        );
        process.exit(1);
      }
    }
  } catch (err) {
    process.stderr.write(`catalog: ${err.message}\n`);
    process.exit(1);
  }
}
