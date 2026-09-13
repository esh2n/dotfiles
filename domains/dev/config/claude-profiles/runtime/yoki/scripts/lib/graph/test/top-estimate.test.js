'use strict';

/**
 * The lane-progress estimator (top-estimate.js): a pure function from a
 * running lane's observation and its finished siblings to a fraction — or
 * to `null`, which is the load-bearing case. Everything here is a plain
 * numeric assertion; the module imports nothing and neither does this file
 * beyond the test runner.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { estimateProgress, logMedian, PROGRESS_CAP } = require('../top-estimate');

// ---------------------------------------------------------------------------
// logMedian
// ---------------------------------------------------------------------------

test('logMedian: odd count is the middle value', () => {
  assert.ok(Math.abs(logMedian([100, 1000, 10000]) - 1000) < 1e-6);
});

test('logMedian: even count is the geometric mean of the middles, not the arithmetic one', () => {
  // Arithmetic median of [100, 10000] would be 5050; the log-domain median
  // is sqrt(100 * 10000) = 1000 — the whole point of estimating in logs,
  // so one slow outlier lane cannot drag the prior linearly.
  assert.ok(Math.abs(logMedian([100, 10000]) - 1000) < 1e-6);
});

test('logMedian: non-positive and non-finite entries are ignored; none left means null', () => {
  assert.ok(Math.abs(logMedian([0, -5, NaN, Infinity, 42]) - 42) < 1e-9);
  assert.equal(logMedian([0, -1, NaN]), null);
  assert.equal(logMedian([]), null);
  assert.equal(logMedian(undefined), null);
});

// ---------------------------------------------------------------------------
// estimateProgress
// ---------------------------------------------------------------------------

test('zero siblings: no estimate at all, never a made-up fraction', () => {
  assert.equal(estimateProgress({ elapsedMs: 60000, toolCalls: 10 }, []), null);
  assert.equal(estimateProgress({ elapsedMs: 60000, toolCalls: 10 }, undefined), null);
  // Siblings without a usable duration are not a prior either.
  assert.equal(estimateProgress({ elapsedMs: 60000 }, [{ durationMs: 0, toolCalls: 3 }]), null);
});

test('one sibling: both signals compare against that lane and average', () => {
  // Sibling: 100s, 10 ticks. Current: 50s, 5 ticks -> 0.5 on both axes.
  const p = estimateProgress(
    { elapsedMs: 50000, toolCalls: 5 },
    [{ durationMs: 100000, toolCalls: 10 }],
  );
  assert.ok(Math.abs(p - 0.5) < 1e-9);
});

test('three siblings: the log-median of each axis is the prior', () => {
  const siblings = [
    { durationMs: 50000, toolCalls: 4 },
    { durationMs: 100000, toolCalls: 8 },
    { durationMs: 200000, toolCalls: 16 },
  ];
  // Medians: 100s, 8 ticks. Current 25s/2 ticks -> 0.25 on both axes.
  const p = estimateProgress({ elapsedMs: 25000, toolCalls: 2 }, siblings);
  assert.ok(Math.abs(p - 0.25) < 1e-9);
});

test('sibling ticks of zero leave the tick axis out instead of dividing by it', () => {
  // All siblings finished with zero recorded ticks (replays would, and so
  // does a backend that never reported progress): only the time axis
  // remains, and the current lane's own ticks must not produce NaN.
  const p = estimateProgress(
    { elapsedMs: 30000, toolCalls: 7 },
    [{ durationMs: 60000, toolCalls: 0 }, { durationMs: 60000, toolCalls: 0 }],
  );
  assert.ok(Math.abs(p - 0.5) < 1e-9);
});

test('the display cap: a lane past its prior reads 0.85, not 100%', () => {
  const p = estimateProgress(
    { elapsedMs: 500000, toolCalls: 50 },
    [{ durationMs: 100000, toolCalls: 10 }],
  );
  assert.equal(p, PROGRESS_CAP);
  assert.equal(PROGRESS_CAP, 0.85);
});

test('cap is overridable, and the floor is zero', () => {
  const capped = estimateProgress(
    { elapsedMs: 500000, toolCalls: 50 },
    [{ durationMs: 100000, toolCalls: 10 }],
    { cap: 0.5 },
  );
  assert.equal(capped, 0.5);
  const floored = estimateProgress(
    { elapsedMs: -100, toolCalls: 0 },
    [{ durationMs: 100000, toolCalls: 10 }],
  );
  assert.equal(floored, 0);
});
