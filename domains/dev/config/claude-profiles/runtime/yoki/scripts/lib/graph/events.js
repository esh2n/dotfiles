'use strict';

/**
 * Per-run event stream: <runDir>/events.ndjson, one line per runner event,
 * appended in emit order as the run progresses.
 *
 * This file exists to separate OBSERVATION from RECOVERY. journal.jsonl is
 * the resume source of truth (journal.js's index-prefix replay) and must stay
 * exactly what replay needs; the event stream is everything else — what a
 * status page, a tail -f, or a post-mortem wants to see — and NOTHING may
 * ever read it back into a run. Resume never touches events.ndjson, and a
 * corrupt or deleted events file must not change what a `--resume` replays
 * (events.test.js pins that).
 *
 * The contract, in order of importance:
 *
 *  1. NEVER fail the workflow. A run that produced its result but could not
 *     narrate itself is a successful run. Every failure path — the runDir
 *     unwritable at creation, a write stream error mid-run (disk full, fd
 *     revoked), an unserializable event — is swallowed and counted, and
 *     `dropped()` reports how many events never made it, so a reader who
 *     cares can tell "quiet run" from "muted run".
 *
 *  2. SINGLE WRITER. Only the process that holds the run lock (lock.js)
 *     writes a run's events.ndjson — the same guarantee journal.jsonl gets —
 *     so `seq` can be a plain in-process counter and a reader can treat a
 *     gap as loss, never as interleaving. yoki-agent runs under ids of its
 *     own (or a lane-derived id no workflow process shares), so it holds the
 *     same property without holding the lock.
 *
 *  3. The envelope is `{ v, seq, ts, runId, type, ...event fields }`.
 *     - `v: 1` is the ENVELOPE version, bumped only when these outer fields
 *       change meaning — a reader that sees an unknown `v` should skip the
 *       line, not guess.
 *     - `seq` starts at 1 and increases by 1 per line written; it is the
 *       reader's ordering key (two events can share a `ts` millisecond).
 *     - `ts` is the HOST clock (epoch ms). The Date restriction is a rule on
 *       script bodies (worker-source.js), not on the runner — journal.js has
 *       always stamped host time, and this follows it.
 *     The event's own `ts`/`runId` (api.js stamps an ISO ts) are dropped in
 *     favour of the envelope's: one clock, one id, per line.
 *
 * Lines are `\n`-terminated. A reader must expect a torn final line while
 * the run is live (the writer can be mid-append) — journal.js's JournalTail
 * already holds a partial line back until it completes, and works unchanged
 * when pointed at an events.ndjson.
 */

const fs = require('fs');
const path = require('path');

const EVENTS_FILE = 'events.ndjson';

function eventsPath(runDirPath) {
  return path.join(runDirPath, EVENTS_FILE);
}

/**
 * @param {string} runDirPath the run's directory (journal.js's runDir(runId))
 * @param {{runId?: string}} [options]
 * @returns {{emit: (event: object) => void, close: () => Promise<void>, dropped: () => number}}
 */
function createEventSink(runDirPath, options = {}) {
  const runId = options.runId;
  let stream = null;
  let broken = false;
  let droppedCount = 0;
  let seq = 0;

  try {
    fs.mkdirSync(runDirPath, { recursive: true });
    stream = fs.createWriteStream(eventsPath(runDirPath), { flags: 'a' });
    // A write stream's failures arrive asynchronously as 'error' events, and
    // an 'error' with no listener throws out of the event loop — the one
    // thing this sink must never do to its run. Mark the sink broken instead;
    // lines the kernel already accepted before the error may still be lost,
    // which is why `broken` also counts as at least one drop.
    stream.on('error', () => {
      broken = true;
      droppedCount += 1;
      stream = null;
    });
  } catch {
    broken = true;
    stream = null;
  }

  function emit(event) {
    if (broken || !stream) {
      droppedCount += 1;
      return;
    }
    try {
      // Envelope fields win over same-named event fields (one clock, one id
      // per line — see the header); everything else rides through untouched.
      const { type, ts, runId: eventRunId, ...fields } = event || {};
      const line = JSON.stringify({
        v: 1, seq: seq + 1, ts: Date.now(), runId: eventRunId || runId, type, ...fields,
      });
      stream.write(`${line}\n`);
      seq += 1; // after the write is queued, so a failed stringify leaves no gap
    } catch {
      droppedCount += 1;
    }
  }

  /** Flush and close the stream. Resolves always — closing a broken sink is
   *  a no-op, and a close error is just one more thing not worth failing
   *  the run over. */
  function close() {
    return new Promise((resolve) => {
      const s = stream;
      stream = null;
      if (!s) { resolve(); return; }
      try {
        s.end(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  return { emit, close, dropped: () => droppedCount };
}

module.exports = { createEventSink, eventsPath, EVENTS_FILE };
