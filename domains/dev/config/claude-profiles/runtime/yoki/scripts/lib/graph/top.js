'use strict';

/**
 * `yoki-graph top` — a kubectl-top-style live view over every run under the
 * graph state root.
 *
 * The IO discipline, in order of importance:
 *
 *  1. NO POLLING for data. The state root and each runDir are watched with
 *     `fs.watch` (FSEvents on macOS), and files are read only when a watch
 *     fires. The single allowed timer is a 5-second SAFETY tick — a watch
 *     can silently die (editor swaps, network mounts, the root not existing
 *     yet), and a viewer that quietly freezes is worse than one that
 *     re-checks at a human timescale. Nothing runs faster than that on a
 *     clock.
 *
 *  2. Redraws are COALESCED: paint requests within 100ms of the last paint
 *     collapse into one deferred paint, so a burst of agent-progress lines
 *     costs one redraw, not one per line. And a frame identical to the
 *     previous one is NOT written — `fs.watch` fires for our own reads'
 *     atime side effects on some platforms, and rewriting an unchanged
 *     screen turns those echoes into flicker.
 *
 *  3. Reading is incremental: each run's events.ndjson is tailed with
 *     journal.js's FileTail (partial-line carry, truncation detection),
 *     with `skipTailBytes` set so attaching to a file already past 2MB
 *     starts at its tail rather than ingesting the history.
 *
 *  4. Display state comes from the event stream fold only (top-fold.js).
 *     run.json is consulted for LIVENESS (its `status` field) and the lock
 *     file for whether the pid behind a "running" status still exists —
 *     the two things the stream cannot know. journal.jsonl is never read:
 *     that file belongs to resume.
 *
 * Off a TTY, or under `--once`, the same screen is printed exactly once
 * (no ANSI, no watchers) and the process exits 0 — the first-class path
 * for tests and scripts, not a degraded one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const journalLib = require('./journal');
const lockLib = require('./lock');
const { EVENTS_FILE } = require('./events');
const fold = require('./top-fold');
const render = require('./top-render');

/** Attach point for a large events file: skip ahead to the final 2MB (see
 *  FileTail's skipTailBytes). Chosen well above any healthy run's stream —
 *  event lines are a few hundred bytes — so the skip only ever fires on a
 *  pathological or very long-lived file. */
const EVENTS_SKIP_TAIL_BYTES = 2 * 1024 * 1024;

/** The safety tick (see header §1) — the ONLY recurring timer. */
const SAFETY_INTERVAL_MS = 5000;

/** Minimum spacing between two paints (see header §2). */
const MIN_PAINT_INTERVAL_MS = 100;

const LANE_MARKER = '-lane-';

function graphRoot(env) {
  return path.join(journalLib.stateRoot(env), 'yoki', 'graph');
}

/** Default config location; `--columns <path>` overrides it. */
function defaultColumnsPath(env) {
  const configHome = typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME.trim() : path.join(os.homedir(), '.config');
  return path.join(configHome, 'yoki-graph', 'top-columns.json');
}

/**
 * Load and validate the column layout. A MISSING file is only worth a
 * warning when the user explicitly pointed at it (`--columns`); the default
 * path not existing is the normal state of most machines. Any other problem
 * (unreadable, unparseable, invalid) warns and falls back — the viewer
 * must start regardless (top-render.js's resolveColumns contract).
 */
function loadColumns(file, explicit) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const columns = render.resolveColumns(null).columns;
    const warnings = explicit ? [`--columns ${file}: cannot read (${err.message}) — using default columns`] : [];
    return { columns, warnings };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      columns: render.resolveColumns(null).columns,
      warnings: [`${file} is not valid JSON (${err.message}) — using default columns`],
    };
  }
  return render.resolveColumns(raw);
}

/**
 * One watched run: its incremental events tail, the fold state built from
 * it, and the last-read liveness inputs. `refresh()` folds only the lines
 * that appeared since the previous call; a truncation (FileTail reset its
 * entry list under us) rebuilds the fold from scratch, because a fold has
 * no way to subtract events.
 */
class RunView {
  constructor(runId, env) {
    this.runId = runId;
    this.env = env;
    this.dir = journalLib.runDir(runId, env);
    this.tail = new journalLib.FileTail(path.join(this.dir, EVENTS_FILE), {
      skipTailBytes: EVENTS_SKIP_TAIL_BYTES,
    });
    this.state = fold.createTopState();
    this.consumed = 0;
    this.meta = null;
    this.liveness = 'unknown';
    this.children = [];
    this.laneLabel = null;
  }

  refresh(now = Date.now(), hostname = os.hostname()) {
    const entries = this.tail.read();
    if (entries.length < this.consumed) {
      this.state = fold.createTopState();
      this.consumed = 0;
    }
    for (; this.consumed < entries.length; this.consumed += 1) {
      fold.foldTopEvent(this.state, entries[this.consumed]);
    }
    this.meta = readMeta(this.dir);
    this.liveness = livenessOf(this.meta, this.dir, hostname, now);
  }
}

/** run.json, read against THIS view's env (runner.readRunMeta reads
 *  process.env, which cmdTop's `--state-home` must be able to override). */
function readMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Liveness from the two signals the event stream cannot carry:
 *
 *  - run.json's `status` says what the run last claimed about itself.
 *  - the lock file's pid says whether the claiming process still exists.
 *
 * "running" with a live same-host lock pid is RUNNING. "running" with a
 * dead pid — or no lock at all, since both writers release their lock in a
 * `finally` that even most crashes reach — is STALE: the run died without
 * writing its final status, and only a human (or a `--resume`) can say
 * what it was worth. A lock from another host is trusted as alive (a pid
 * means nothing across machines — same rule as lock.js's isStale).
 */
function livenessOf(meta, dir, hostname) {
  if (!meta || typeof meta.status !== 'string') return 'unknown';
  if (meta.status === 'running') {
    const info = lockLib.readLockFile(path.join(dir, 'lock'));
    if (info && info.host !== hostname) return 'running';
    if (info && lockLib.pidAlive(info.pid)) return 'running';
    return 'stale';
  }
  return meta.status === 'ok' ? 'ok' : 'error';
}

/** Directory names under the graph root that are valid run ids. */
function discoverRunIds(env) {
  let names;
  try {
    names = fs.readdirSync(graphRoot(env), { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter((d) => d.isDirectory() && journalLib.RUN_ID_RE.test(d.name))
    .map((d) => d.name)
    .sort();
}

/**
 * Split run ids into top-level runs and lane-derived children.
 *
 * A lane run's id is `<parentRunId>-lane-<label>` (core/workflows/lib/
 * lanes.js mints them), so nesting is decided by the id alone: the segment
 * before the FIRST `-lane-` names the parent. The parent must actually
 * exist as a runDir — an orphan lane id (its parent's state pruned) stays
 * top-level rather than vanishing under a parent that is not there.
 */
function groupRunIds(ids) {
  const set = new Set(ids);
  const top = [];
  const childrenOf = new Map();
  for (const id of ids) {
    const marker = id.indexOf(LANE_MARKER);
    const parent = marker > 0 ? id.slice(0, marker) : null;
    if (parent && set.has(parent)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push({ id, laneLabel: id.slice(marker + LANE_MARKER.length) });
    } else {
      top.push(id);
    }
  }
  return { top, childrenOf };
}

/**
 * The full view tree for one paint: discover, (re)attach RunViews, refresh
 * the requested ones, nest lane runs under their parents.
 *
 * @param {Map<string, RunView>} views persistent across paints — each holds
 *   an incremental tail whose offset must survive between refreshes
 * @param {Set<string>|null} dirty runIds to refresh; null refreshes all
 */
function buildViews(views, env, dirty, now, hostname) {
  const ids = discoverRunIds(env);
  const present = new Set(ids);
  for (const known of [...views.keys()]) {
    if (!present.has(known)) views.delete(known);
  }
  for (const id of ids) {
    if (!views.has(id)) {
      views.set(id, new RunView(id, env));
      if (dirty) dirty.add(id); // a run we have never read is always dirty
    }
  }
  for (const id of ids) {
    if (!dirty || dirty.has(id)) views.get(id).refresh(now, hostname);
  }
  const { top, childrenOf } = groupRunIds(ids);
  const out = [];
  for (const id of top) {
    const view = views.get(id);
    view.children = (childrenOf.get(id) || []).map(({ id: childId, laneLabel }) => {
      const child = views.get(childId);
      child.laneLabel = laneLabel;
      return child;
    });
    out.push(view);
  }
  return out;
}

/**
 * `yoki-graph top [--state-home <dir>] [--once] [--columns <path>]`
 *
 * Injectable deps (tests): `stream`, `stderr`, `isTty`, `env`, `now`,
 * `hostname`. Returns when the viewer exits — immediately for a snapshot,
 * on `q`/Ctrl-C for the live view.
 */
async function cmdTop(rest, flags, deps = {}) {
  const baseEnv = deps.env || process.env;
  const env = flags['state-home']
    ? { ...baseEnv, YOKI_STATE_HOME: path.resolve(String(flags['state-home'])) }
    : baseEnv;
  const stream = deps.stream || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const isTty = deps.isTty === undefined ? !!stream.isTTY : deps.isTty;
  const now = deps.now || (() => Date.now());
  const hostname = deps.hostname || os.hostname();

  const columnsPath = flags.columns ? path.resolve(String(flags.columns)) : defaultColumnsPath(env);
  const { columns, warnings } = loadColumns(columnsPath, !!flags.columns);
  for (const warning of warnings) stderr.write(`yoki-graph top: ${warning}\n`);

  // Color only when a human is looking AND has not opted out: a TTY without
  // NO_COLOR (https://no-color.org — set and non-empty means off). The
  // renderer itself stays pure — the paint function is a parameter, and a
  // piped/`--once`-into-a-file screen carries not one escape byte.
  const paint = isTty && !(typeof env.NO_COLOR === 'string' && env.NO_COLOR !== '')
    ? render.createAnsiPaint() : undefined;

  const views = new Map();

  if (flags.once || !isTty) {
    const tree = buildViews(views, env, null, now(), hostname);
    stream.write(render.renderScreen(tree, columns, now(), { hint: null, paint }));
    return;
  }

  await liveLoop({
    views, env, columns, cellPaint: paint, stream, now, hostname,
    stdin: deps.stdin, stderr, proc: deps.proc, watch: deps.watch,
    safetyIntervalMs: deps.safetyIntervalMs,
  });
}

/**
 * The interactive loop: watchers in, coalesced frames out, `q` to leave.
 *
 * Terminal restoration is guaranteed on EVERY exit path, because a viewer
 * that leaves the user's shell trapped in the alternate screen with raw
 * input is worse than any bug it might have crashed on:
 *
 *  - `cleanup()` is idempotent and is the single exit point (q key,
 *    signals, internal failure).
 *  - SIGINT/SIGTERM/SIGHUP run cleanup, then exit with the conventional
 *    128+signum code.
 *  - every async entry point (paint, watch callbacks, the safety tick, the
 *    key handler) is wrapped: an exception cleans up, prints ONE line to
 *    stderr and exits non-zero instead of unwinding past the alt screen.
 *  - a process 'exit' listener is the last resort: it synchronously
 *    restores the terminal even if cleanup never ran (a process.exit from
 *    elsewhere), and tolerates an already-destroyed stream.
 *
 * `watch` (default fs.watch), `proc` (default process), `stderr` and
 * `safetyIntervalMs` are injectable so the failure paths are testable.
 */
function liveLoop({
  views, env, columns, cellPaint, stream, now, hostname,
  stdin = process.stdin, stderr = process.stderr, proc = process,
  watch = fs.watch, safetyIntervalMs = SAFETY_INTERVAL_MS,
}) {
  return new Promise((resolve) => {
    let lastFrame = '';
    let lastPaintAt = 0;
    let paintTimer = null;
    let refreshAll = true; // first paint reads everything
    const dirty = new Set();
    const runWatchers = new Map(); // runId -> fs.FSWatcher
    let rootWatcher = null;
    let safety = null;
    let closed = false;
    let restored = false;

    /** Put the terminal back — raw mode off, cursor shown, alternate
     *  screen left. Idempotent and throw-free: this also runs from the
     *  process 'exit' listener, where the stream may already be destroyed
     *  and a throw would turn an orderly exit into a crash. */
    function restoreTerminal() {
      if (restored) return;
      restored = true;
      try {
        if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
      } catch { /* stdin already gone */ }
      try {
        // Leave the alternate screen and restore the cursor — the shell's
        // scrollback comes back exactly as it was before `top` started.
        stream.write('\x1b[?25h\x1b[?1049l');
      } catch { /* stream already gone */ }
    }

    /** Wrap an async entry point (timer, watcher, key handler): a throw
     *  inside one must restore the terminal and report, never unwind into
     *  nowhere with the alt screen still active. */
    function guarded(fn) {
      return (...args) => {
        try {
          fn(...args);
        } catch (err) {
          cleanup();
          try { stderr.write(`yoki-graph top: ${err && err.message ? err.message : err}\n`); } catch { /* stderr gone */ }
          proc.exitCode = 1;
        }
      };
    }

    function paint() {
      paintTimer = null;
      lastPaintAt = now();
      const tree = buildViews(views, env, refreshAll ? null : dirty, now(), hostname);
      refreshAll = false;
      dirty.clear();
      syncRunWatchers();
      const text = render.renderScreen(tree, columns, now(), { paint: cellPaint });
      if (text === lastFrame) return;
      lastFrame = text;
      // Home the cursor and repaint over the old frame, erasing each line's
      // remainder (\x1b[K) and everything below the new frame (\x1b[J) —
      // a full clear-screen per frame flickers on slower terminals.
      stream.write(`\x1b[H${text.replace(/\n/g, '\x1b[K\n')}\x1b[J`);
    }
    const guardedPaint = guarded(paint);

    /** Coalesce paint requests: at most one paint per MIN_PAINT_INTERVAL_MS,
     *  the trailing request deferred, never dropped. */
    function schedulePaint() {
      if (closed || paintTimer) return;
      const wait = Math.max(0, lastPaintAt + MIN_PAINT_INTERVAL_MS - now());
      paintTimer = setTimeout(guardedPaint, wait);
      if (typeof paintTimer.unref === 'function') paintTimer.unref();
    }

    /** Watch every known runDir; drop watchers for pruned runs. A runDir
     *  watch fires for events.ndjson appends, run.json renames and lock
     *  create/delete alike — all of them mean "this run needs re-reading".
     *  An errored watcher is closed and REMOVED from the registry, so the
     *  next sync (every paint, and at latest the safety tick's refreshAll
     *  paint) attaches a fresh one instead of trusting a dead handle. */
    function syncRunWatchers() {
      for (const [runId, watcher] of [...runWatchers]) {
        if (!views.has(runId)) {
          try { watcher.close(); } catch { /* already closed */ }
          runWatchers.delete(runId);
        }
      }
      for (const runId of views.keys()) {
        if (runWatchers.has(runId)) continue;
        try {
          const watcher = watch(views.get(runId).dir, guarded(() => {
            dirty.add(runId);
            schedulePaint();
          }));
          watcher.on('error', guarded(() => {
            try { watcher.close(); } catch { /* already closed */ }
            runWatchers.delete(runId);
            dirty.add(runId);
            schedulePaint(); // re-read now; that paint's sync re-attaches
          }));
          runWatchers.set(runId, watcher);
        } catch { /* runDir vanished between discovery and watch — safety tick re-syncs */ }
      }
    }

    function watchRoot() {
      try {
        const watcher = watch(graphRoot(env), guarded(() => {
          refreshAll = true; // a new/removed runDir — re-discover everything
          schedulePaint();
        }));
        watcher.on('error', guarded(() => {
          try { watcher.close(); } catch { /* already closed */ }
          // Null the handle so the safety tick's `if (!rootWatcher)`
          // re-attaches it — a dead watcher held here would satisfy that
          // check forever while watching nothing.
          if (rootWatcher === watcher) rootWatcher = null;
          refreshAll = true;
          schedulePaint();
        }));
        rootWatcher = watcher;
      } catch { /* root not created yet — the safety tick retries */ }
    }

    function cleanup() {
      if (closed) return;
      closed = true;
      if (paintTimer) clearTimeout(paintTimer);
      clearInterval(safety);
      if (rootWatcher) { try { rootWatcher.close(); } catch { /* already closed */ } }
      for (const watcher of runWatchers.values()) { try { watcher.close(); } catch { /* already closed */ } }
      stdin.removeListener('data', onKey);
      try { stdin.pause(); } catch { /* stdin gone */ }
      for (const [signal, handler] of signalHandlers) proc.removeListener(signal, handler);
      proc.removeListener('exit', restoreTerminal);
      restoreTerminal();
      resolve();
    }

    const onKey = guarded((data) => {
      const key = String(data);
      // `q` is the documented key; Ctrl-C arrives as raw ETX (0x03) in
      // raw mode — the terminal no longer turns it into SIGINT for us.
      if (key === 'q' || key === 'Q' || key === '\u0003') cleanup();
    });

    // A signal must restore the terminal BEFORE the process dies — the
    // default disposition would kill us mid-alt-screen. Exit with the
    // conventional 128+signum so callers can still tell how we went.
    const SIGNAL_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
    const signalHandlers = Object.entries(SIGNAL_CODES).map(([signal, code]) => {
      const handler = () => {
        cleanup();
        proc.exit(code);
      };
      proc.on(signal, handler);
      return [signal, handler];
    });
    // Last resort: someone else calls process.exit() while we are live.
    // 'exit' allows only synchronous work — restoreTerminal is exactly that.
    proc.on('exit', restoreTerminal);

    // Alternate screen + hidden cursor for the duration of the viewer.
    stream.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.on('data', onKey);
    stdin.resume();

    watchRoot();
    // The safety tick: re-discover and re-read EVERYTHING at a human
    // timescale, so a dead watcher (or a root that appeared after startup)
    // degrades to a 5s-latency view instead of a frozen one. It also keeps
    // the elapsed columns moving between events. A missing root watcher is
    // re-attached here; missing RUN watchers are re-attached by the paint
    // this tick schedules (syncRunWatchers runs on every paint).
    safety = setInterval(guarded(() => {
      refreshAll = true;
      if (!rootWatcher) watchRoot();
      schedulePaint();
    }), safetyIntervalMs);
    if (typeof safety.unref === 'function') safety.unref();

    schedulePaint();
  });
}

module.exports = {
  cmdTop, loadColumns, defaultColumnsPath, graphRoot, groupRunIds, livenessOf,
  discoverRunIds, RunView, buildViews,
  EVENTS_SKIP_TAIL_BYTES, SAFETY_INTERVAL_MS, MIN_PAINT_INTERVAL_MS,
};
