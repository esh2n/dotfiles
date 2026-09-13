'use strict';

/**
 * Progress estimation for a RUNNING lane, from its finished siblings.
 *
 * There is no ground truth for "how far along" an agent call is — the
 * backend reports tool-call ticks and wall time, not a fraction — so any
 * bar is a prediction. The prediction here is deliberately narrow:
 *
 *   - The PRIOR is the finished sibling lanes of the same run: their
 *     `(durationMs, toolCalls)` pairs. Lanes of one run do comparable work
 *     (the same review diff, the same research question), which is what
 *     makes them a usable prior; lanes of OTHER runs are not, and no
 *     cross-run history is consulted.
 *   - The central estimate is the LOG-median (exp of the median of logs),
 *     not the mean: durations are heavy-tailed — one lane that hit a retry
 *     loop must not double everyone else's expected duration — and the
 *     median of two values degrades to their geometric mean rather than
 *     their arithmetic one.
 *   - The displayed fraction is CAPPED at 0.85. A bar that reaches 100%
 *     while the lane is still running is a lie with a progress bar's
 *     authority; capping keeps "almost done" visibly distinct from "done".
 *   - ZERO siblings means NO estimate (`null`), never a made-up fraction.
 *     The caller shows elapsed time instead of a bar — an honest "no idea"
 *     beats a percentage with nothing behind it.
 *
 * The estimation approach (sibling prior + capped fraction) follows a
 * design described for kimi-code's viewer; this is an independent
 * implementation from that description, not derived from its code.
 *
 * This module imports nothing on purpose: it is a pure function from
 * numbers to a number, testable and reusable with no environment at all.
 */

/** The display ceiling for a running lane's estimated fraction. */
const PROGRESS_CAP = 0.85;

/**
 * exp(median(log v)) over the positive finite entries of `values`; null
 * when none qualify. For an even count this is the geometric mean of the
 * two middle values — the log-domain analogue of the usual median.
 */
function logMedian(values) {
  const logs = (Array.isArray(values) ? values : [])
    .filter((v) => Number.isFinite(v) && v > 0)
    .map(Math.log)
    .sort((a, b) => a - b);
  if (!logs.length) return null;
  const mid = logs.length >> 1;
  const median = logs.length % 2 ? logs[mid] : (logs[mid - 1] + logs[mid]) / 2;
  return Math.exp(median);
}

/**
 * Estimated completion fraction of a running lane, in [0, cap] — or null
 * when there is nothing to estimate FROM (no usable sibling, or a current
 * observation with neither elapsed time nor ticks to compare).
 *
 * Two independent signals are fused: how far the lane's elapsed time is
 * along the siblings' log-median duration, and how far its tool-call count
 * is along their log-median tick count. Each contributes only when the
 * prior actually has it (siblings that reported zero ticks — a replay, a
 * one-shot answer — leave the tick prior empty rather than dividing by
 * zero), and the two are averaged so a lane that is slow in time but ahead
 * in ticks reads as roughly on track instead of oscillating with whichever
 * single signal was consulted.
 *
 * @param {{elapsedMs?: number, toolCalls?: number}} current
 * @param {Array<{durationMs?: number, toolCalls?: number}>} siblings
 *   finished lanes of the SAME run
 * @param {{cap?: number}} [options]
 * @returns {number|null}
 */
function estimateProgress(current, siblings, options = {}) {
  const cap = Number.isFinite(options.cap) ? options.cap : PROGRESS_CAP;
  const done = (Array.isArray(siblings) ? siblings : [])
    .filter((s) => s && Number.isFinite(s.durationMs) && s.durationMs > 0);
  if (!done.length) return null;

  const expectedMs = logMedian(done.map((s) => s.durationMs));
  const expectedTicks = logMedian(done.map((s) => s.toolCalls));
  const elapsedMs = current && Number.isFinite(current.elapsedMs) ? Math.max(0, current.elapsedMs) : 0;
  const toolCalls = current && Number.isFinite(current.toolCalls) ? Math.max(0, current.toolCalls) : 0;

  const fractions = [];
  if (expectedMs) fractions.push(elapsedMs / expectedMs);
  if (expectedTicks) fractions.push(toolCalls / expectedTicks);
  if (!fractions.length) return null;

  const value = fractions.reduce((a, b) => a + b, 0) / fractions.length;
  return Math.min(cap, Math.max(0, value));
}

module.exports = { estimateProgress, logMedian, PROGRESS_CAP };
