'use strict';

/**
 * Per-run journal: one JSONL file at
 * ~/.local/state/yoki/graph/<runId>/journal.jsonl, one line per agent()
 * call outcome: {index, key, label, phase, status, result, tokens?,
 * tokensSource?, usage?, durationMs}.
 *
 * `key` is sha256(prompt + JSON(opts)) — the same call (same prompt, same
 * opts, same explicit label) always produces the same key. `index` is that
 * call's position in the run's `agent()` arrival order.
 *
 * `--resume` replays an index-ordered PREFIX, not a key-addressed cache:
 * the resumed run walks its own calls 0, 1, 2, ... and replays each one
 * only while the journal has a completed entry at that same index whose key
 * matches. The first mismatch ends the replay and everything from there on
 * runs live. A key-only lookup (what this file used to do) would happily
 * hand back the recorded result of call #12 to a rerun whose call #4
 * changed — same prompt, but a different upstream produced it, so it is not
 * the same work. `loadReplaySequence` also discards later-index entries
 * from an earlier generation when a resumed run restarted at a lower index,
 * so a stale tail can never be replayed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const { stateHome } = require('../state-home');

/** `YOKI_STATE_HOME` (documented in core/skills/yoki-graph/SKILL.md as the
 *  graph-specific override) wins, then the shared XDG resolution every other
 *  yoki state file uses. Before the fallback went through lib/state-home.js
 *  this was the only state path that ignored `XDG_STATE_HOME`, so relocating
 *  state moved the loop log, the loop inbox cursor and the pending-context
 *  queue but silently left graph run journals under the real home. */
function stateRoot(env = process.env) {
  const override = typeof env.YOKI_STATE_HOME === 'string' ? env.YOKI_STATE_HOME.trim() : '';
  return override || stateHome(env);
}

function runDir(runId, env = process.env) {
  return path.join(stateRoot(env), 'yoki', 'graph', String(runId));
}

function journalPath(runId, env = process.env) {
  return path.join(runDir(runId, env), 'journal.jsonl');
}

/** Labels yoki-graph invents rather than the script choosing them. These
 *  must stay OUT of the key: they are derived from arrival order, which
 *  interleaves nondeterministically when calls run concurrently, so keeping
 *  them would make the same logical call hash differently between runs and
 *  miss the replay every time. */
const AUTO_LABEL = /^(?:\(unlabeled\)|agent-\d+)$/;

/**
 * sha256(prompt + NUL + JSON(opts + resolved execution)) — stable across
 * process restarts, which is the whole point: it is the resume replay key.
 *
 * A label the *script* chose is part of the caller's identity and stays in
 * the key (two lanes that send the same prompt under different labels are
 * different work); an auto-generated one is stripped.
 *
 * `execution` carries what the RUNNER resolved rather than what the script
 * typed: the per-call backend and the concrete model id. Both belong in the
 * key because they change the work, not just its display. `opts.model` alone
 * cannot stand in for them — it is often absent (the call inherits the run's
 * `--model`) or a tier name whose meaning `--model-map` can redefine — so a
 * key built from opts only would replay gpt-5.4-mini's answer to a run that
 * has since been pointed at gpt-5.6-sol. Undefined/empty entries are left
 * out, so a caller that passes none hashes exactly as before.
 *
 * @param {string} prompt
 * @param {object} [opts] the script's own `agent()` options
 * @param {{backend?: string, model?: string}} [execution] runner-resolved
 */
function callKey(prompt, opts = {}, execution = {}) {
  const { label, ...identity } = opts || {};
  const explicit = typeof label === 'string' ? label.trim() : '';
  if (explicit && !AUTO_LABEL.test(explicit)) identity.label = explicit;
  // Prefixed names so a script option can never collide with them.
  if (execution && execution.backend) identity['@backend'] = String(execution.backend);
  if (execution && execution.model) identity['@model'] = String(execution.model);
  const h = crypto.createHash('sha256');
  h.update(String(prompt));
  h.update('\0');
  h.update(stableStringify(identity));
  return h.digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

class Journal {
  constructor(runId) {
    this.runId = runId;
    this.dir = runDir(runId);
    this.file = journalPath(runId);
    this._replay = null; // Map<index, entry> — loaded lazily, only for resume
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * The generation this process's own entries belong to: one more than the
   * highest already in the file, so every `executeScript` invocation against
   * this runId is a distinct generation. Computed lazily on the first
   * append, so a run that replays everything and writes nothing does not
   * burn a generation number. The run lock guarantees only one process is
   * numbering itself at a time.
   */
  generation() {
    if (this._generation === undefined) {
      let highest = -1;
      for (const entry of this.readAll()) {
        if (entry && Number.isInteger(entry.gen) && entry.gen > highest) highest = entry.gen;
      }
      this._generation = highest + 1;
    }
    return this._generation;
  }

  /**
   * The completed ("ok") entries available to replay, as `Map<index, entry>`.
   *
   * Generations, not file order, decide what is current. A resumed run only
   * appends entries from its divergence point onward, so generation N's
   * lines cover indices `[divergedAt .. lastReached]`: everything BELOW that
   * range was replayed (and therefore confirmed) from an earlier generation
   * and stays; everything ABOVE it is stale, because generation N changed
   * the upstream and never reached those calls. So each generation, applied
   * oldest first, overrides its own indices and truncates anything past its
   * highest one.
   *
   * File order cannot substitute for this: agent() calls complete out of
   * order under concurrency, so a journal's lines are in completion order
   * while `index` is arrival order.
   *
   * Entries from before `gen`/`index` existed (an older journal) are treated
   * as one generation 0 and positioned by file order — a best-effort read of
   * state that is transient anyway, not a format guarantee.
   */
  loadReplaySequence() {
    if (this._replay) return this._replay;
    const byGeneration = new Map();
    for (const entry of this.readAll()) {
      if (!entry || entry.status !== 'ok') continue;
      const gen = Number.isInteger(entry.gen) ? entry.gen : 0;
      if (!byGeneration.has(gen)) byGeneration.set(gen, []);
      byGeneration.get(gen).push(entry);
    }

    const byIndex = new Map();
    for (const gen of [...byGeneration.keys()].sort((a, b) => a - b)) {
      const entries = byGeneration.get(gen);
      const allIndexed = entries.every((entry) => Number.isInteger(entry.index));
      const positioned = entries.map((entry, position) => [allIndexed ? entry.index : position, entry]);
      const highest = positioned.reduce((max, [index]) => (index > max ? index : max), -1);
      for (const known of [...byIndex.keys()]) {
        if (known > highest) byIndex.delete(known);
      }
      for (const [index, entry] of positioned) byIndex.set(index, entry);
    }
    this._replay = byIndex;
    return byIndex;
  }

  /** The completed entry recorded for call `index`, but only when its key
   *  matches this run's call at that position. `undefined` means "diverged
   *  here" — the caller must stop replaying, not skip ahead. */
  replayAt(index, key) {
    const entry = this.loadReplaySequence().get(index);
    if (!entry || entry.key !== key) return undefined;
    return entry;
  }

  append(entry) {
    const stamped = Number.isInteger(entry.gen) ? entry : { ...entry, gen: this.generation() };
    this.ensureDir();
    fs.appendFileSync(this.file, `${JSON.stringify(stamped)}\n`);
    if (this._replay && stamped.status === 'ok' && Number.isInteger(stamped.index)) {
      this._replay.set(stamped.index, stamped);
    }
  }

  /**
   * Sum of every recorded token count in this run's journal — the resumed
   * prefix included, since those tokens were really spent on this run's
   * behalf — backing `budget.spent()`. Failed and timed-out calls count too
   * when they reported usage: the provider charged for them.
   */
  tokensSpent() {
    let total = 0;
    for (const entry of this.readAll()) {
      if (entry && typeof entry.tokens === 'number') total += entry.tokens;
    }
    return total;
  }

  /** Per-run totals for the end-of-run line: how many tokens, how many of
   *  them measured vs. estimated, and USD when a backend reported it. */
  usageTotals() {
    return usageTotalsFrom(this.readAll());
  }

  /**
   * Per-model totals for the end-of-run table. See `usageByModelFrom`.
   */
  usageByModel() {
    return usageByModelFrom(this.readAll());
  }

  readAll() {
    if (!fs.existsSync(this.file)) return [];
    return parseEntries(fs.readFileSync(this.file, 'utf8'));
  }
}

/**
 * The three journal summaries as PURE functions over an already-parsed
 * entry list, with the `Journal` methods above as thin wrappers.
 *
 * `yoki-graph status` used to materialize `readAll()` for its counts and
 * then call `usageTotals()` and `usageByModel()`, each of which re-read and
 * re-parsed the whole file: three synchronous full reads and three JSON.parse
 * passes over the same NDJSON per invocation, growing with the run's length.
 * cli.js now parses once and calls these.
 */
function usageTotalsFrom(entries) {
  const totals = {
    calls: 0, tokens: 0, reportedTokens: 0, estimatedTokens: 0,
    inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, hasCost: false,
  };
  for (const entry of entries) {
      if (!entry || entry.status !== 'ok') continue;
      totals.calls += 1;
      const tokens = typeof entry.tokens === 'number' ? entry.tokens : 0;
      totals.tokens += tokens;
      if (entry.tokensSource === 'estimated') totals.estimatedTokens += tokens;
      else if (entry.tokensSource === 'mixed') {
        totals.reportedTokens += (entry.usage && entry.usage.reportedTokens) || 0;
        totals.estimatedTokens += (entry.usage && entry.usage.estimatedTokens) || 0;
      } else totals.reportedTokens += tokens;
    if (entry.usage) {
      totals.inputTokens += entry.usage.inputTokens || 0;
      totals.outputTokens += entry.usage.outputTokens || 0;
      totals.cachedTokens += entry.usage.cacheRead || 0;
      if (typeof entry.usage.costUsd === 'number') {
        totals.costUsd += entry.usage.costUsd;
        totals.hasCost = true;
      }
    }
  }
  return totals;
}

/**
 * Per-model totals for the end-of-run table: how many calls each RESOLVED
 * model id took, what they cost in tokens, how much of their input was
 * served from cache, and how long they spent in the backend. Keyed by
 * BACKEND + resolved id rather than the tier the script asked for —
 * "sonnet: 12 calls" does not say which model actually ran, a `--model-map`
 * override or a per-call `model` makes them differ, and a mixed-backend run
 * (MP1) can send the same id to two CLIs whose spend should not blur into
 * one row.
 *
 * `cached` is informational, never added into `tokens`: on codex it is a
 * subset of the input already counted, on omp it is disjoint and the
 * backend's own total already includes it (see backends/codex.js's note and
 * API.md's token-accounting table).
 *
 * Wall time is the sum of each call's own backend duration, so a run whose
 * lanes ran concurrently reports more model-seconds than the run took —
 * which is the number that matters when comparing two models.
 */
function usageByModelFrom(entries) {
  const rows = new Map();
  for (const entry of entries) {
    if (!entry || entry.status !== 'ok') continue;
    const model = entry.model || '(unreported)';
    const backend = entry.backend || '';
    const key = `${backend}\u0000${model}`;
    if (!rows.has(key)) rows.set(key, { backend, model, calls: 0, tokens: 0, cached: 0, wallMs: 0 });
    const row = rows.get(key);
    row.calls += 1;
    if (typeof entry.tokens === 'number') row.tokens += entry.tokens;
    if (entry.usage && typeof entry.usage.cacheRead === 'number') row.cached += entry.usage.cacheRead;
    if (typeof entry.durationMs === 'number') row.wallMs += entry.durationMs;
  }
  return [...rows.values()].sort((a, b) => b.tokens - a.tokens
    || a.backend.localeCompare(b.backend)
    || a.model.localeCompare(b.model));
}

function parseEntries(text) {
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/**
 * An incremental reader for one run's journal, for `status --watch`.
 *
 * Each poll used to call `readAll()`: a synchronous read and JSON.parse of
 * the ENTIRE growing NDJSON file, every two seconds, so the cost of watching
 * grew with the run's total length instead of with what had appeared since
 * the last tick — and blocked the event loop while it did.
 *
 * This keeps a byte offset and parses only the bytes appended since. A
 * partial trailing line (the writer is mid-append) is held back and re-read
 * next tick rather than parsed and dropped. If the file ever gets SHORTER
 * than the offset — truncated, rotated, or a fresh run reusing the id — the
 * offset is meaningless and everything is re-read from zero.
 */
class JournalTail {
  constructor(runId, env = process.env) {
    this.file = journalPath(runId, env);
    this.reset();
  }

  reset() {
    this.offset = 0;
    this.pending = '';   // partial last line, not yet terminated by \n
    this.entries = [];
    // Two different partial things have to be held across polls, and they
    // are not the same thing. `pending` is a partial LINE (the writer has
    // not appended its \n yet). The decoder holds a partial CHARACTER: a
    // read at an arbitrary byte offset can land in the middle of a
    // multi-byte UTF-8 sequence, and journal entries are full of Japanese
    // (labels, results, log messages). Decoding each chunk with
    // `buffer.toString('utf8')` would turn that split character into U+FFFD
    // and corrupt the line; StringDecoder carries the leftover bytes into
    // the next chunk instead.
    this.decoder = new StringDecoder('utf8');
  }

  /** Every entry seen so far, including this poll's new ones. */
  read() {
    let stat;
    try {
      stat = fs.statSync(this.file);
    } catch {
      return this.entries; // not written yet — nothing to add
    }
    if (stat.size < this.offset) {
      // Truncated/rotated: the offset points past the end, so nothing about
      // the old position is trustworthy. Full re-read.
      this.reset();
    }
    if (stat.size === this.offset) return this.entries;

    const fd = fs.openSync(this.file, 'r');
    try {
      const length = stat.size - this.offset;
      const buffer = Buffer.allocUnsafe(length);
      const bytes = fs.readSync(fd, buffer, 0, length, this.offset);
      this.offset += bytes;
      const chunk = this.pending + this.decoder.write(buffer.subarray(0, bytes));
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline === -1) {
        this.pending = chunk;
        return this.entries;
      }
      this.pending = chunk.slice(lastNewline + 1);
      this.entries.push(...parseEntries(chunk.slice(0, lastNewline)));
    } finally {
      fs.closeSync(fd);
    }
    return this.entries;
  }
}

module.exports = {
  Journal, callKey, runDir, journalPath, stateRoot, AUTO_LABEL,
  usageTotalsFrom, usageByModelFrom, parseEntries, JournalTail,
};
