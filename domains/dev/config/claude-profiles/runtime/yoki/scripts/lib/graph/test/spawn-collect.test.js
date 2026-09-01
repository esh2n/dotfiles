'use strict';

/**
 * backends/common.js `spawnCollect` — its stated contract is: "Resolves
 * {stdout, stderr, code} even on a non-zero exit; rejects only if the process
 * itself could not be spawned." It could not honour that: it wrote to
 * `child.stdin` with no 'error' listener on that stream, and a Writable with
 * no 'error' listener turns the error into an UNCAUGHT exception — killing
 * the whole node process, and with it every other concurrently running
 * agent() call, rather than settling this one promise.
 *
 * The reachable case is EPIPE: the child exits (crashes, refuses its args,
 * finishes early) while a large prompt is still being written. The codex
 * backend is the highest-risk caller, since it always pipes the entire
 * prompt through stdin. Verified against this repo's node (v22): without the
 * listener the first test below takes the process down with `UNCAUGHT:
 * EPIPE`; with it, the call resolves normally.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const common = require('../backends/common');
const COMMON_PATH = path.join(__dirname, '..', 'backends', 'common.js');

test('a child that exits mid-write does not take the process down with an uncaught EPIPE', () => {
  // Run in a CHILD node process: the failure mode being guarded against is a
  // process-level crash, which an in-process assertion cannot survive to
  // report. Exit 9 = the bug is back.
  const script = `
    const { spawnCollect } = require(${JSON.stringify(COMMON_PATH)});
    process.on('uncaughtException', (e) => { console.log('UNCAUGHT:' + (e.code || e.message)); process.exit(9); });
    spawnCollect(process.execPath, ['-e', 'process.exit(0)'], { input: 'y'.repeat(50 * 1024 * 1024) })
      .then((r) => { console.log('resolved:' + r.code); }, (e) => { console.log('rejected:' + e.code); });
  `;
  const res = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.notEqual(res.status, 9, `spawnCollect crashed the process: ${res.stdout.trim()}`);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^resolved:0$/m);
});

test('spawnCollect rejects when the binary cannot be spawned at all', async () => {
  await assert.rejects(
    () => common.spawnCollect('yoki-definitely-not-a-real-binary-xyz', ['--nope'], { input: 'x'.repeat(200000) }),
    (err) => Boolean(err) && (err.code === 'ENOENT' || /ENOENT|spawn/i.test(err.message))
  );
});

test('spawnCollect resolves {stdout, stderr, code} on a NON-ZERO exit rather than rejecting', async () => {
  const res = await common.spawnCollect(
    process.execPath,
    ['-e', 'process.stderr.write("nope"); process.exit(3)'],
    {}
  );
  assert.equal(res.code, 3);
  assert.equal(res.stderr, 'nope');
});

test('spawnCollect writes input to stdin and then closes it', async () => {
  const child = [
    'let d = "";',
    'process.stdin.on("data", (c) => { d += c; });',
    'process.stdin.on("end", () => process.stdout.write("got:" + d));',
  ].join('');
  const res = await common.spawnCollect(process.execPath, ['-e', child], { input: 'the prompt' });
  assert.equal(res.code, 0);
  assert.equal(res.stdout, 'got:the prompt');
});

test('spawnCollect closes stdin even with no input — codex exec hangs otherwise', async () => {
  const child = 'process.stdin.on("end", () => process.stdout.write("stdin closed"));process.stdin.resume();';
  const res = await common.spawnCollect(process.execPath, ['-e', child], {});
  assert.equal(res.stdout, 'stdin closed');
});
