'use strict';

/**
 * Fold one run's events.ndjson ENVELOPE lines into the state `yoki-graph
 * top` displays.
 *
 * progress.js's `foldEvent` stays the base — it already knows how a phase
 * counter advances and how the done/failed/gate/replayed tallies move, and
 * changing its behaviour would change the live `run` status line too. What
 * it deliberately does NOT keep is what a top view needs: finished lanes
 * (its `running` map deletes an agent on `agent-end`, because a one-line
 * status only shows in-flight work), per-lane durations and tokens (the
 * estimator's prior), and the envelope bookkeeping (`seq`/`gen`) that tells
 * a reader whether it lost lines. So this module wraps a progress state and
 * keeps its own lane ledger beside it, instead of forking foldEvent.
 *
 * The display state comes from the EVENT STREAM ALONE. journal.jsonl is the
 * resume path's file and is never read here — the one deliberate exception
 * to "events are observation only" is that top observes, which is exactly
 * what the stream is for. Liveness (is the writing process alive) cannot
 * come from events at all and is the caller's job (lock pid + run.json
 * status).
 *
 * Envelope handling: a line whose `v` is not 1 is SKIPPED and counted
 * (events.js's contract: an unknown envelope version must be skipped, not
 * guessed at). `seq`/`gen` are tracked so sequential reopens of the file —
 * a retry re-running a lane command under the same derived runId bumps
 * `gen` while `seq` continues — fold as one continuous history, and so a
 * seq gap can be surfaced as loss rather than silently absorbed.
 */

const progress = require('./progress');

function createTopState() {
  return {
    // The shared fold progress.js maintains: name/backend/phases, phase
    // position, done/failed/gateFailed/replayed tallies, finished/status.
    progress: progress.createState(),
    // index -> lane record, kept AFTER the lane finishes (unlike
    // progress.js's running map). `order` preserves first-seen order so the
    // display does not reshuffle as a Map would on delete/re-add.
    lanes: new Map(),
    order: [],
    // Envelope-time run boundaries (epoch ms) — elapsed shows event time,
    // not the viewer's attach time.
    startTs: null,
    endTs: null,
    // Sum of agent-end token counts. The journal's usageTotals is NOT
    // consulted (single source: the event stream).
    tokens: 0,
    // Envelope bookkeeping: last seq/gen seen, and how many lines were
    // skipped for an unknown envelope version.
    lastSeq: 0,
    lastGen: 0,
    seqGaps: 0,
    skipped: 0,
    // Lanes flagged by the reserved `needs-human` event (events.js header).
    needsHuman: false,
  };
}

/** A lane record's fields, created on first sight of its index. */
function laneAt(state, index, seed = {}) {
  if (!state.lanes.has(index)) {
    state.lanes.set(index, {
      index,
      label: null,
      phase: null,
      backend: null,
      model: null,
      status: 'pending',
      startedTs: null,
      endedTs: null,
      durationMs: null,
      toolCalls: 0,
      tokens: null,
      retrying: false,
      retried: false,
      gate: null,
      needsHuman: false,
      error: null,
    });
    state.order.push(index);
  }
  const lane = state.lanes.get(index);
  for (const [key, value] of Object.entries(seed)) {
    if (value !== undefined && value !== null) lane[key] = value;
  }
  return lane;
}

/**
 * Fold one envelope line (an already-parsed events.ndjson object) into
 * `state`. Mutates and returns `state` — same convention as foldEvent, and
 * for the same reason: this runs once per line on the redraw path.
 */
function foldTopEvent(state, line) {
  if (!line || typeof line !== 'object') return state;
  if (line.v !== 1) {
    state.skipped += 1;
    return state;
  }
  if (Number.isInteger(line.seq)) {
    const gen = Number.isInteger(line.gen) ? line.gen : 1;
    // Within one generation seq increments by exactly 1; across a reopen it
    // continues from the previous writer's count (events.js). Either way a
    // jump of more than 1 means lines were lost or never written.
    if (state.lastSeq && line.seq > state.lastSeq + 1) state.seqGaps += 1;
    state.lastSeq = line.seq;
    state.lastGen = gen;
  }
  const ts = Number.isFinite(line.ts) ? line.ts : Date.now();

  // The shared tallies first. foldEvent's `now` parameter is fed the
  // ENVELOPE timestamp, so a state rebuilt from a file agrees with one that
  // was folded live — an attach-time Date.now() would stamp every replayed
  // agent-start with the viewer's clock.
  progress.foldEvent(state.progress, line, ts);

  // Every agent-* event addresses its lane by `index`; a line without one
  // (hand-mangled, or a future shape) has no lane to update and must not
  // invent a Map entry keyed `undefined`.
  const hasIndex = Number.isInteger(line.index);
  switch (line.type) {
    case 'run-start':
      state.startTs = ts;
      break;
    case 'run-end':
      state.endTs = ts;
      break;
    case 'agent-start':
      if (!hasIndex) break;
      laneAt(state, line.index, {
        label: line.label, phase: line.phase, backend: line.backend, model: line.model,
      }).status = 'running';
      laneAt(state, line.index).startedTs = ts;
      laneAt(state, line.index).retrying = false;
      break;
    case 'agent-progress': {
      if (!hasIndex) break;
      const lane = laneAt(state, line.index, {
        label: line.label, backend: line.backend, model: line.model,
      });
      lane.toolCalls = Number.isFinite(line.toolCalls) ? line.toolCalls : lane.toolCalls;
      // A tick after a retry announcement means the next attempt is really
      // underway — the ↻ marker should not outlive the stall it reports.
      lane.retrying = false;
      break;
    }
    case 'agent-retry': {
      if (!hasIndex) break;
      const lane = laneAt(state, line.index, { label: line.label });
      lane.retrying = true;
      lane.retried = true;
      break;
    }
    case 'agent-gate': {
      if (!hasIndex) break;
      const lane = laneAt(state, line.index, { label: line.label });
      lane.gate = line.status === 'pass' ? 'pass' : 'fail';
      break;
    }
    case 'agent-cached': {
      if (!hasIndex) break;
      const lane = laneAt(state, line.index, {
        label: line.label, phase: line.phase, backend: line.backend, model: line.model,
      });
      lane.status = 'cached';
      lane.endedTs = ts;
      break;
    }
    case 'agent-end': {
      if (!hasIndex) break;
      const lane = laneAt(state, line.index, {
        label: line.label, phase: line.phase, backend: line.backend, model: line.model,
      });
      lane.status = line.status === 'error' ? 'error' : 'ok';
      lane.endedTs = ts;
      lane.retrying = false;
      if (Number.isFinite(line.durationMs)) lane.durationMs = line.durationMs;
      else if (Number.isFinite(lane.startedTs)) lane.durationMs = ts - lane.startedTs;
      if (Number.isFinite(line.tokens)) {
        lane.tokens = line.tokens;
        state.tokens += line.tokens;
      }
      if (line.error) lane.error = String(line.error);
      break;
    }
    case 'needs-human': {
      // Reserved type (events.js header): nothing emits it yet, but a line
      // that carries it must already surface — with an index it flags that
      // lane, without one it flags the run.
      if (Number.isInteger(line.index)) {
        laneAt(state, line.index, { label: line.label }).needsHuman = true;
      }
      state.needsHuman = true;
      break;
    }
    default:
      break;
  }
  return state;
}

/** Lanes in first-seen order — with `needs-human` lanes hoisted to the
 *  front, because a lane waiting on a person outranks every lane a machine
 *  is still working through. */
function laneList(state) {
  const lanes = state.order.map((index) => state.lanes.get(index));
  const flagged = lanes.filter((l) => l.needsHuman);
  if (!flagged.length) return lanes;
  return [...flagged, ...lanes.filter((l) => !l.needsHuman)];
}

/**
 * The estimator's prior: `(durationMs, toolCalls)` of the SAME run's
 * completed lanes. Only status 'ok' with a real duration qualifies —
 * an errored lane's duration measures where it broke, not how long the
 * work takes, and a replayed (`cached`) lane took no backend time at all.
 */
function completedSiblings(state, excludeIndex) {
  const out = [];
  for (const lane of state.lanes.values()) {
    if (lane.index === excludeIndex) continue;
    if (lane.status !== 'ok') continue;
    if (!Number.isFinite(lane.durationMs) || lane.durationMs <= 0) continue;
    out.push({ durationMs: lane.durationMs, toolCalls: lane.toolCalls });
  }
  return out;
}

module.exports = { createTopState, foldTopEvent, laneList, completedSiblings };
