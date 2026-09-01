'use strict';

/**
 * Live progress for a human watching a run.
 *
 * The event stream (`--json`) stays the machine-readable source of truth;
 * this folds the same events into a small state object and renders one
 * compact status line from it:
 *
 *   phase 2/5 Review — running 3 / done 7 / failed 0 — [security gpt-5.6-sol 41s +2 tools] …
 *
 * Folding is a pure function (`foldEvent`) so the rendering can be asserted
 * from a fixture event list — and so `yoki-graph status --watch` can build
 * the same view from a journal it did not itself produce.
 *
 * On a TTY the line is rewritten in place with `\r`; when stdout is a pipe
 * or a file the same information is printed as one line per event, because a
 * carriage-return redraw in a log file is a single unreadable line.
 */

const MAX_RUNNING_SHOWN = 3;

function createState() {
  return {
    runId: null,
    name: null,
    backend: null,
    phases: [],        // titles from meta.phases, when the run reported them
    phaseIndex: 0,     // 1-based position of the current phase
    phaseTitle: null,
    running: new Map(), // index -> {label, model, startedAt, toolCalls}
    done: 0,
    failed: 0,
    // Agents whose `opts.gate` command exited non-zero (or was killed at its
    // timeout). Counted separately from `failed` — which they also become —
    // because "the model answered but the build is broken" and "the backend
    // died" are different things to see at a glance.
    gateFailed: 0,
    replayed: 0,
    finished: false,
    status: null,
  };
}

/** Fold one event into `state`, returning it (mutated in place — this runs
 *  once per event on a hot path and the state is private to one renderer). */
function foldEvent(state, event, now = Date.now()) {
  if (!event || typeof event !== 'object') return state;
  switch (event.type) {
    case 'run-start':
      state.runId = event.runId;
      state.name = event.name;
      state.backend = event.backend;
      state.phases = Array.isArray(event.phases) ? event.phases : [];
      break;
    case 'phase': {
      state.phaseTitle = event.title;
      const known = state.phases.indexOf(event.title);
      // A phase() call the script makes but `meta.phases` never declared
      // still advances the counter, rather than resetting it to 0.
      state.phaseIndex = known >= 0 ? known + 1 : state.phaseIndex + 1;
      break;
    }
    case 'agent-start':
      state.running.set(event.index, {
        label: event.label,
        model: event.model || null,
        phase: event.phase || null,
        startedAt: now,
        toolCalls: 0,
      });
      break;
    case 'agent-progress': {
      const entry = state.running.get(event.index);
      if (entry) entry.toolCalls = event.toolCalls || 0;
      break;
    }
    case 'agent-gate': {
      // Emitted between the backend call and `agent-end`, so the entry is
      // still in `running` and the status line can say the lane moved from
      // "waiting on a model" to "waiting on a command".
      const entry = state.running.get(event.index);
      if (entry) entry.gate = event.status === 'pass' ? 'pass' : 'fail';
      if (event.status !== 'pass') state.gateFailed += 1;
      break;
    }
    case 'agent-cached':
      state.replayed += 1;
      break;
    case 'agent-end':
      state.running.delete(event.index);
      if (event.status === 'error') state.failed += 1;
      else state.done += 1;
      break;
    case 'run-end':
      state.finished = true;
      state.status = event.status;
      break;
    default:
      break;
  }
  return state;
}

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * The compact one-line status. Each in-flight agent shows its label, the
 * RESOLVED model id (not the tier the script asked for — that is the whole
 * point of showing it) and how long it has been running.
 */
function renderStatus(state, now = Date.now()) {
  const parts = [];
  if (state.phaseTitle) {
    const total = state.phases.length;
    parts.push(total ? `phase ${state.phaseIndex}/${total} ${state.phaseTitle}` : `phase ${state.phaseTitle}`);
  } else if (state.name) {
    parts.push(state.name);
  }
  parts.push(`running ${state.running.size} / done ${state.done} / failed ${state.failed}`);
  if (state.gateFailed) parts.push(`gate-failed ${state.gateFailed}`);
  if (state.replayed) parts.push(`replayed ${state.replayed}`);

  const inFlight = [...state.running.values()].slice(0, MAX_RUNNING_SHOWN).map((entry) => {
    const bits = [entry.label];
    if (entry.model) bits.push(entry.model);
    bits.push(formatElapsed(now - entry.startedAt));
    if (entry.toolCalls) bits.push(`+${entry.toolCalls} tools`);
    if (entry.gate) bits.push(`gate:${entry.gate}`);
    return `[${bits.join(' ')}]`;
  });
  const hidden = state.running.size - inFlight.length;
  if (inFlight.length) parts.push(inFlight.join(' ') + (hidden > 0 ? ` +${hidden} more` : ''));
  return parts.join(' — ');
}

/**
 * A renderer bound to an output stream.
 *
 * @param {object} [options]
 * @param {NodeJS.WritableStream} [options.stream=process.stdout]
 * @param {boolean} [options.isTty] defaults to the stream's own `isTTY`
 * @param {() => number} [options.now] injectable clock (tests)
 * @param {(event: object) => string|null} [options.lineFor] the non-TTY
 *   per-event printer; returning null prints nothing for that event.
 */
function createRenderer(options = {}) {
  const stream = options.stream || process.stdout;
  const isTty = options.isTty === undefined ? !!stream.isTTY : options.isTty;
  const now = options.now || (() => Date.now());
  const lineFor = options.lineFor;
  const state = createState();
  let lastWidth = 0;

  function clearLine() {
    if (!lastWidth) return;
    stream.write(`\r${' '.repeat(lastWidth)}\r`);
    lastWidth = 0;
  }

  function paint() {
    const text = renderStatus(state, now());
    // Pad to the previous width so a shorter line does not leave the tail of
    // the longer one behind it.
    const padded = text.length < lastWidth ? text + ' '.repeat(lastWidth - text.length) : text;
    stream.write(`\r${padded}`);
    lastWidth = text.length;
  }

  return {
    state,
    /** Feed one event; prints per-event lines off a TTY, repaints on one. */
    handle(event) {
      foldEvent(state, event, now());
      if (!isTty) {
        const line = lineFor ? lineFor(event) : null;
        if (line !== null && line !== undefined) stream.write(line);
        return;
      }
      // A permanent line (a phase header, a narrator log, a finished agent)
      // has to survive the next repaint, so the status line is cleared,
      // the permanent line printed, and the status repainted beneath it.
      const line = lineFor ? lineFor(event) : null;
      if (line !== null && line !== undefined) {
        clearLine();
        stream.write(line);
      }
      if (state.finished) { clearLine(); return; }
      paint();
    },
    /** Erase the transient status line (end of run, or before a final report). */
    finish() { clearLine(); },
    renderStatus: () => renderStatus(state, now()),
  };
}

module.exports = { createState, foldEvent, renderStatus, createRenderer, formatElapsed, MAX_RUNNING_SHOWN };
