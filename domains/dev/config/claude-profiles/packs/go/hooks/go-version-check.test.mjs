import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  extractGoVersion,
  parseMajorMinor,
  isNewerMajorMinor,
  extractLatestStable,
  isFresh,
  formatWarning,
  checkOnce,
} = require('./go-version-check.js');

// ---- pure helpers -----------------------------------------------------

test('extractGoVersion parses "go env GOVERSION" output', () => {
  assert.equal(extractGoVersion('go1.27.1\n'), '1.27.1');
  assert.equal(extractGoVersion('go1.27'), '1.27');
  assert.equal(extractGoVersion('not-go\n'), null);
  assert.equal(extractGoVersion(''), null);
  assert.equal(extractGoVersion(undefined), null);
});

test('parseMajorMinor extracts major/minor and ignores patch', () => {
  assert.deepEqual(parseMajorMinor('1.27.1'), [1, 27]);
  assert.deepEqual(parseMajorMinor('1.28'), [1, 28]);
  assert.equal(parseMajorMinor('garbage'), null);
  assert.equal(parseMajorMinor(''), null);
});

test('isNewerMajorMinor compares by major.minor only, ignores patch', () => {
  assert.equal(isNewerMajorMinor('1.28.0', '1.27.1'), true);
  assert.equal(isNewerMajorMinor('1.27.9', '1.27.1'), false); // patch-only diff
  assert.equal(isNewerMajorMinor('1.27.0', '1.27.0'), false);
  assert.equal(isNewerMajorMinor('2.0.0', '1.99.0'), true);
  assert.equal(isNewerMajorMinor('1.27.0', '1.28.0'), false);
  assert.equal(isNewerMajorMinor(null, '1.27.0'), false);
  assert.equal(isNewerMajorMinor('1.27.0', null), false);
});

test('extractLatestStable picks the first stable:true entry', () => {
  const body = JSON.stringify([
    { version: 'go1.28', stable: false },
    { version: 'go1.27.1', stable: true },
    { version: 'go1.26.5', stable: true },
  ]);
  assert.equal(extractLatestStable(body), '1.27.1');
});

test('extractLatestStable is null on malformed / non-array / no-stable input', () => {
  assert.equal(extractLatestStable('not json'), null);
  assert.equal(extractLatestStable(JSON.stringify({ not: 'an array' })), null);
  assert.equal(
    extractLatestStable(JSON.stringify([{ version: 'go1.28', stable: false }])),
    null,
  );
});

test('isFresh respects the TTL boundary', () => {
  const now = 1_000_000;
  assert.equal(isFresh({ checkedAt: now - 1000 }, now, 7 * 24 * 60 * 60 * 1000), true);
  assert.equal(isFresh({ checkedAt: now - 8 * 24 * 60 * 60 * 1000 }, now, 7 * 24 * 60 * 60 * 1000), false);
  assert.equal(isFresh(null, now, 7 * 24 * 60 * 60 * 1000), false);
  assert.equal(isFresh({}, now, 7 * 24 * 60 * 60 * 1000), false);
});

test('formatWarning is a single line naming both versions and the agent', () => {
  const line = formatWarning('1.28.0', '1.27.1');
  assert.match(line, /^\[go-version-check\] Go 1\.28 is out \(installed 1\.27\.1\)\. Run the go-version-scout agent/);
  assert.equal(line.split('\n').filter(Boolean).length, 1);
});

// ---- checkOnce orchestration (network + go binary mocked out) ---------

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A "now" far enough past epoch that a checkedAt:0 cache reads as stale.
const STALE_NOW = TTL_MS + 24 * 60 * 60 * 1000; // 8 days past epoch

function fakeCacheStore(initial) {
  let store = initial ? { ...initial } : null;
  return {
    read: () => store,
    write: (_path, entry) => {
      store = entry;
    },
    peek: () => store,
  };
}

test('checkOnce: fresh cache short-circuits — no fetch, no go, no warning', async () => {
  const cache = fakeCacheStore({ checkedAt: 1_000_000, installed: '1.27.0', latest: '1.27.0' });
  let fetchCalled = false;
  let goCalled = false;

  const result = await checkOnce({
    cachePath: '/fake/cache.json',
    ttlMs: TTL_MS,
    now: 1_000_000 + 1000, // well within TTL
    readCache: cache.read,
    writeCache: cache.write,
    getInstalledVersion: () => {
      goCalled = true;
      return '1.27.0';
    },
    fetchLatestStable: async () => {
      fetchCalled = true;
      return '1.27.0';
    },
  });

  assert.equal(result.stderrLine, '');
  assert.equal(fetchCalled, false);
  assert.equal(goCalled, false);
});

test('checkOnce: stale cache, go missing — skips silently but still caches', async () => {
  const cache = fakeCacheStore({ checkedAt: 0 });
  const result = await checkOnce({
    cachePath: '/fake/cache.json',
    ttlMs: TTL_MS,
    now: STALE_NOW,
    readCache: cache.read,
    writeCache: cache.write,
    getInstalledVersion: () => null, // `go` not on PATH
    fetchLatestStable: async () => {
      throw new Error('should never be called when go is missing');
    },
  });

  assert.equal(result.stderrLine, '');
  assert.deepEqual(cache.peek(), { checkedAt: STALE_NOW });
});

test('checkOnce: stale cache, newer release available — warns and updates cache', async () => {
  const cache = fakeCacheStore({ checkedAt: 0 });
  const result = await checkOnce({
    cachePath: '/fake/cache.json',
    ttlMs: TTL_MS,
    now: STALE_NOW,
    readCache: cache.read,
    writeCache: cache.write,
    getInstalledVersion: () => '1.27.1',
    fetchLatestStable: async () => '1.28.0',
  });

  assert.match(result.stderrLine, /Go 1\.28 is out \(installed 1\.27\.1\)/);
  assert.deepEqual(cache.peek(), { checkedAt: STALE_NOW, installed: '1.27.1', latest: '1.28.0' });
});

test('checkOnce: stale cache, already current — no warning, cache still refreshed', async () => {
  const cache = fakeCacheStore({ checkedAt: 0 });
  const result = await checkOnce({
    cachePath: '/fake/cache.json',
    ttlMs: TTL_MS,
    now: STALE_NOW,
    readCache: cache.read,
    writeCache: cache.write,
    getInstalledVersion: () => '1.27.1',
    fetchLatestStable: async () => '1.27.1',
  });

  assert.equal(result.stderrLine, '');
  assert.deepEqual(cache.peek(), { checkedAt: STALE_NOW, installed: '1.27.1', latest: '1.27.1' });
});

test('checkOnce: fetch fails (network error simulated as null) — silent, cache still refreshed', async () => {
  const cache = fakeCacheStore({ checkedAt: 0 });
  const result = await checkOnce({
    cachePath: '/fake/cache.json',
    ttlMs: TTL_MS,
    now: STALE_NOW,
    readCache: cache.read,
    writeCache: cache.write,
    getInstalledVersion: () => '1.27.1',
    fetchLatestStable: async () => null, // simulates timeout/network error
  });

  assert.equal(result.stderrLine, '');
  assert.deepEqual(cache.peek(), { checkedAt: STALE_NOW, installed: '1.27.1', latest: null });
});

test('checkOnce: never throws even if a dependency throws', async () => {
  const result = await checkOnce({
    cachePath: '/fake/cache.json',
    ttlMs: TTL_MS,
    now: STALE_NOW,
    readCache: () => {
      throw new Error('disk on fire');
    },
    writeCache: () => {},
    getInstalledVersion: () => '1.27.1',
    fetchLatestStable: async () => '1.28.0',
  });

  assert.equal(result.stderrLine, '');
});
