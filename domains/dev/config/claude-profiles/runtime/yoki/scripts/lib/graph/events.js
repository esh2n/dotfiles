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
 *  2. SINGLE WRITER AT A TIME. Only the process that holds the run lock
 *     (lock.js) writes a run's events.ndjson — runner.js and agent-cli.js
 *     both take that lock — so `seq` can be a plain in-process counter and a
 *     reader can treat a gap as loss, never as interleaving. SEQUENTIAL
 *     reuse of a runDir is normal, though (a workflow retry re-running the
 *     same lane command under the same derived id), so a sink OPENING an
 *     existing file continues: it reads the last complete line in the final
 *     64KB and numbers itself from that line's `seq + 1`, under a `gen`
 *     one higher than that line's. When the tail is unreadable (garbage, or
 *     no complete line in the window) `seq` restarts at 1 and `gen`
 *     best-effort-bumps to 2 — the field a reader must use to tell "same
 *     writer, next line" from "a new writer began here". A torn final line
 *     left by a previous writer is terminated with one `\n` before the
 *     first new line, so it can never splice into this generation's output.
 *
 *  3. The envelope is `{ v, seq, gen, ts, runId, type, ...event fields }`.
 *     - `v: 1` is the ENVELOPE version, bumped only when these outer fields
 *       change meaning — a reader that sees an unknown `v` should skip the
 *       line, not guess.
 *     - `seq` starts at 1 and increases by 1 per line written, continuing
 *       across sequential reopens; it is the reader's ordering key (two
 *       events can share a `ts` millisecond).
 *     - `gen` is the writer generation: 1 for the file's first writer,
 *       one higher per reopen (see above).
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

/** How far back an opening sink looks for the previous writer's last line.
 *  Event lines are small (a few hundred bytes; agent-end with a gate record
 *  is the largest), so 64KB spans hundreds of lines — if none of them is
 *  complete and parseable, the tail is garbage, not merely long. */
const TAIL_WINDOW_BYTES = 64 * 1024;

/**
 * Where a new sink on `file` should start: `{ seq, gen, needsNewline }` —
 * the seq to continue from (0 for a fresh count), the generation to stamp,
 * and whether the file ends mid-line (a previous writer died mid-append)
 * and needs one `\n` before anything else is written.
 *
 * Walks the final window's complete lines backwards past unparseable ones:
 * the window's first line is usually cut mid-line by the window boundary,
 * and that must not read as "the whole tail is garbage".
 */
function readTailState(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { seq: 0, gen: 1, needsNewline: false }; // no file yet: first writer
  }
  if (stat.size === 0) return { seq: 0, gen: 1, needsNewline: false };
  try {
    const start = Math.max(0, stat.size - TAIL_WINDOW_BYTES);
    const fd = fs.openSync(file, 'r');
    let text;
    try {
      const buffer = Buffer.allocUnsafe(stat.size - start);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
      text = buffer.subarray(0, bytes).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
    const needsNewline = !text.endsWith('\n');
    const lastNewline = text.lastIndexOf('\n');
    const complete = lastNewline === -1 ? [] : text.slice(0, lastNewline).split('\n');
    for (let i = complete.length - 1; i >= 0; i -= 1) {
      const line = complete[i].trim();
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // walk past a corrupt or boundary-cut line
      }
      if (parsed && Number.isInteger(parsed.seq)) {
        // A pre-`gen` line (the field's introduction) counts as generation 1.
        const gen = Number.isInteger(parsed.gen) ? parsed.gen : 1;
        return { seq: parsed.seq, gen: gen + 1, needsNewline };
      }
    }
    // Bytes exist but nothing in the window parses: restart the count and
    // best-effort bump the generation so a reader at least sees a boundary.
    return { seq: 0, gen: 2, needsNewline };
  } catch {
    return { seq: 0, gen: 2, needsNewline: true };
  }
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
  let gen = 1;

  try {
    fs.mkdirSync(runDirPath, { recursive: true });
    const tail = readTailState(eventsPath(runDirPath));
    seq = tail.seq;
    gen = tail.gen;
    stream = fs.createWriteStream(eventsPath(runDirPath), { flags: 'a' });
    // Terminate a torn final line a previous (dead) writer left, so this
    // generation's first line starts at column 0 rather than splicing into
    // it. JournalTail-style readers drop the unparseable half-line.
    if (tail.needsNewline) stream.write('\n');
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
        v: 1, seq: seq + 1, gen, ts: Date.now(), runId: eventRunId || runId, type, ...fields,
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
