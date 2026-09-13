'use strict';

/**
 * End-to-end smoke for session scoping through the REAL pi extension.
 *
 * Everything else about the widget is asserted from fold-state fixtures in
 * widget-lines.test.js (no pi, no jiti). This file closes the one seam those
 * cannot reach: the .ts extension itself — does session_start actually stamp
 * YOKI_RUN_SCOPE, and does its render path actually filter run.json on disk to
 * this session's runs? It jiti-loads yoki-graph-widget.ts (the same loader pi
 * uses; the `import type` lines are erased, so only node builtins load), drives
 * a fake pi lifecycle over a temp state home holding real run.json files, and
 * reads the rendered widget lines back.
 *
 * jiti is pi's dependency, not yoki's (no dep is added for this). When it
 * cannot be resolved — a machine without pi installed — the test SKIPS rather
 * than fails, so the suite stays green everywhere while still exercising the
 * real load wherever pi lives.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const YOKI_ROOT = path.resolve(__dirname, '../../../..');
// yoki root -> claude-profiles -> runtime? no: yoki/../../../ = config, then pi/.
const EXT = path.resolve(YOKI_ROOT, '../../../pi/extensions/yoki-graph-widget.ts');

/** Locate jiti through the pi package (its dependency), or return null. */
function resolveJiti() {
  const piIndexes = [
    path.join(os.homedir(), '.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js'),
    path.join(os.homedir(), '.local/share/mise/installs/node'),
  ];
  const candidates = [];
  try { candidates.push(require.resolve('jiti')); } catch { /* not local */ }
  for (const idx of piIndexes) {
    if (!fs.existsSync(idx)) continue;
    try { candidates.push(createRequire(idx).resolve('jiti')); } catch { /* keep trying */ }
  }
  for (const p of candidates) {
    try { return require(p); } catch { /* keep trying */ }
  }
  return null;
}

/** Write a minimal run under <stateHome>/yoki/graph/<runId>: run.json (status
 *  running, no lock -> "stale", which the widget treats as active) plus an
 *  empty events stream. */
function writeRun(stateHome, runId, name, scope) {
  const dir = path.join(stateHome, 'yoki', 'graph', runId);
  fs.mkdirSync(dir, { recursive: true });
  const meta = { name, backend: 'mock', status: 'running', startedAt: new Date().toISOString() };
  if (scope !== undefined) meta.scope = scope;
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'events.ndjson'), '');
}

test('jiti smoke: the pi extension stamps YOKI_RUN_SCOPE and renders only my runs', (t) => {
  const jiti = resolveJiti();
  if (!jiti) { t.skip('jiti not resolvable (pi not installed) — real-load smoke skipped'); return; }

  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-scope-smoke-'));
  const prevState = process.env.YOKI_STATE_HOME;
  const prevRoot = process.env.YOKI_ROOT;
  const prevScope = process.env.YOKI_RUN_SCOPE;
  process.env.YOKI_STATE_HOME = stateHome;
  process.env.YOKI_ROOT = YOKI_ROOT;
  delete process.env.YOKI_RUN_SCOPE;

  const restore = () => {
    if (prevState === undefined) delete process.env.YOKI_STATE_HOME; else process.env.YOKI_STATE_HOME = prevState;
    if (prevRoot === undefined) delete process.env.YOKI_ROOT; else process.env.YOKI_ROOT = prevRoot;
    if (prevScope === undefined) delete process.env.YOKI_RUN_SCOPE; else process.env.YOKI_RUN_SCOPE = prevScope;
    fs.rmSync(stateHome, { recursive: true, force: true });
  };

  const handlers = new Map();
  let widgetFactory = null;
  try {
    // Three runs on disk: one launched by THIS session, one by another, one
    // unscoped (an older run.json / a Claude Code lane).
    writeRun(stateHome, 'run-mine', 'my-review', 'pi-sess-me');
    writeRun(stateHome, 'run-other', 'their-review', 'pi-other');
    writeRun(stateHome, 'run-legacy', 'legacy-run', undefined);

    const createJiti = jiti.createJiti || jiti.default || jiti;
    const load = createJiti(__filename, { interopDefault: true });
    const loaded = load(EXT);
    const factory = typeof loaded === 'function' ? loaded : loaded && loaded.default;
    assert.equal(typeof factory, 'function', 'extension default export must be the factory');

    factory({ on: (event, fn) => handlers.set(event, fn) });
    const start = handlers.get('session_start');
    assert.equal(typeof start, 'function', 'extension must register session_start');

    const ctx = {
      mode: 'tui',
      sessionManager: { getSessionId: () => 'sess-me' },
      ui: { setWidget: (_key, content) => { widgetFactory = content; } },
    };
    start({ type: 'session_start', reason: 'startup' }, ctx);

    // 1. session_start propagated this session's scope into the environment.
    assert.equal(process.env.YOKI_RUN_SCOPE, 'pi-sess-me', 'scope must be set for child runs to inherit');

    // 2. the widget was armed (there are active runs) and renders only mine,
    //    folding the other two into one elsewhere line.
    assert.equal(typeof widgetFactory, 'function', 'widget factory must be set when runs are active');
    const component = widgetFactory({ requestRender() {} }, undefined);
    const lines = component.render(120);

    assert.ok(lines.some((l) => l.includes('my-review')), `my run must be shown: ${JSON.stringify(lines)}`);
    assert.ok(!lines.some((l) => l.includes('their-review') || l.includes('legacy-run')), 'other sessions never get rows');
    assert.equal(lines[lines.length - 1], '… +2 runs elsewhere (yoki-graph top)');
  } finally {
    try { handlers.get('session_shutdown')?.(); } catch { /* cleanup best-effort */ }
    restore();
  }
});
