'use strict';

/**
 * Pure rendering for `yoki-graph top`: fold state in, strings out.
 *
 * Nothing here reads a file, a clock, or a terminal — `now` is a parameter,
 * the column layout is a parameter, and the output is a plain string — so
 * every layout decision (column schema overrides, full-width truncation,
 * the snapshot format) is assertable from a fixture. The IO shell (top.js)
 * owns discovery, tailing and the ANSI frame.
 *
 * Column layout is DATA, not code: the default run/lane column lists below
 * can be reordered, resized, right-aligned or dropped per machine via
 * `~/.config/yoki-graph/top-columns.json` (or `--columns <path>`). A config
 * problem — unknown key, malformed entry, unparseable JSON — degrades to
 * the defaults with a one-line warning, NEVER a refusal to start: a viewer
 * that dies on a stale config file is useless exactly when it is wanted.
 *
 * Width arithmetic counts DISPLAY cells, not string length: lane labels and
 * phase titles in this repo are routinely Japanese, and `String.length`
 * would let a 12-character 全角 label occupy 24 terminal cells and shear
 * every column after it. `displayWidth`/`truncateToWidth` implement the
 * East Asian Wide/Fullwidth ranges (there is no prior art in this repo —
 * cli.js/progress.js pad by `text.length` because their one status line
 * never columnizes user text).
 */

const { formatElapsed } = require('./progress');
const { estimateProgress } = require('./top-estimate');
const { laneList, completedSiblings } = require('./top-fold');

// ---------------------------------------------------------------------------
// Display width (East Asian Wide / Fullwidth), truncation, padding
// ---------------------------------------------------------------------------

/**
 * Control characters that must never reach the terminal: C0 (0x00-0x1F),
 * DEL (0x7F) and C1 (0x80-0x9F). ESC is in C0, so stripping the set kills
 * every ANSI CSI/OSC sequence wholesale — which is the point: lane labels,
 * run names and phase titles are WORKFLOW-AUTHORED (and, through a lane's
 * payload, can carry attacker-influenced text), and a label containing
 * `\x1b]0;…\x07` would otherwise retitle the viewer's terminal, or worse,
 * from inside a status screen. Tab becomes one space (it is layout, not an
 * attack, but a raw tab would still shear the columns); everything else in
 * the set becomes U+FFFD, visibly marking that something was removed
 * rather than silently splicing the remainder together.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0A-\x1F\x7F\x80-\x9F]/g;

/**
 * The one sanitation point for external text on its way into a cell. Runs
 * BEFORE any width arithmetic, so truncation and padding measure the
 * replaced string, never the raw one.
 *
 * TODO: progress.js's live status line renders the same external labels
 * unsanitized — only into the invoker's own terminal (self-harm at worst,
 * no cross-run exposure), but it should share this function once it is
 * touched for other reasons.
 */
function sanitizeText(text) {
  return String(text).replace(/\t/g, ' ').replace(CONTROL_CHARS_RE, '�');
}

/**
 * Code-point ranges rendered two cells wide by monospace terminals: the
 * Unicode East Asian Wide (W) and Fullwidth (F) blocks, plus the emoji
 * blocks macOS terminals draw double-width. Ambiguous-width characters
 * (①, ⚠, ●, …) are counted NARROW — that is what iTerm2/Terminal.app,
 * Ghostty and tmux default to, and overcounting them would misalign every
 * icon column on those defaults.
 */
const WIDE_RANGES = [
  [0x1100, 0x115F],   // Hangul Jamo (leading consonants)
  [0x2E80, 0x303E],   // CJK Radicals … CJK Symbols and Punctuation
  [0x3041, 0x33FF],   // Hiragana … CJK Compatibility
  [0x3400, 0x4DBF],   // CJK Extension A
  [0x4E00, 0x9FFF],   // CJK Unified Ideographs
  [0xA000, 0xA4CF],   // Yi
  [0xAC00, 0xD7A3],   // Hangul Syllables
  [0xF900, 0xFAFF],   // CJK Compatibility Ideographs
  [0xFE30, 0xFE4F],   // CJK Compatibility Forms
  [0xFF00, 0xFF60],   // Fullwidth Forms
  [0xFFE0, 0xFFE6],   // Fullwidth signs
  [0x1F300, 0x1F64F], // Misc Symbols and Pictographs, Emoticons
  [0x1F900, 0x1F9FF], // Supplemental Symbols and Pictographs
  [0x20000, 0x2FFFD], // CJK Extension B+
  [0x30000, 0x3FFFD], // CJK Extension G+
];

function charWidth(codePoint) {
  // Combining marks and zero-width joiners occupy no cell of their own.
  if ((codePoint >= 0x0300 && codePoint <= 0x036F) || codePoint === 0x200D || codePoint === 0xFE0F) return 0;
  for (const [lo, hi] of WIDE_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return 2;
  }
  return 1;
}

/** Terminal display cells `text` occupies (see WIDE_RANGES). */
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += charWidth(ch.codePointAt(0));
  return width;
}

/**
 * `text` cut to at most `width` display cells, with `…` marking the cut.
 * Cutting counts cells, not characters: chopping a 全角 label at
 * `width - 1` CHARACTERS would still overflow the column.
 */
function truncateToWidth(text, width) {
  const str = String(text);
  if (displayWidth(str) <= width) return str;
  if (width <= 1) return width === 1 ? '…' : '';
  let out = '';
  let used = 0;
  for (const ch of str) {
    const w = charWidth(ch.codePointAt(0));
    if (used + w > width - 1) break; // leave one cell for the ellipsis
    out += ch;
    used += w;
  }
  return `${out}…`;
}

/** Sanitize-then-truncate-then-pad to exactly `width` cells; `align:
 *  'right'` pads left. Every cell — and therefore every piece of external
 *  text — funnels through here, so this is the choke point where control
 *  characters die BEFORE any width is measured. */
function padCell(text, width, align) {
  const cut = truncateToWidth(sanitizeText(text), width);
  const pad = ' '.repeat(Math.max(0, width - displayWidth(cut)));
  return align === 'right' ? pad + cut : cut + pad;
}

// ---------------------------------------------------------------------------
// Column schema
// ---------------------------------------------------------------------------

/** Every column a run row can carry, with its default width. The `status`
 *  width is 2 because 🔸 (needs-human) is a double-width glyph. */
const RUN_COLUMN_DEFS = {
  status: { width: 2 },
  name: { width: 20 },
  // 7, not 5: the header row labels this column BACKEND and a header that
  // truncates its own label ("BACK…") reads worse than two spare cells.
  backend: { width: 7 },
  phase: { width: 16 },
  elapsed: { width: 7, align: 'right' },
  tokens: { width: 8, align: 'right' },
  lanes: { width: 7, align: 'right' },
  id: { width: 28 },
};

/** Every column a lane row can carry. `model` renders `backend/model`. */
const LANE_COLUMN_DEFS = {
  status: { width: 2 },
  label: { width: 24 },
  phase: { width: 12 },
  backend: { width: 7 }, // see RUN_COLUMN_DEFS.backend
  model: { width: 20 },
  elapsed: { width: 7, align: 'right' },
  tick: { width: 5, align: 'right' },
  tokens: { width: 8, align: 'right' },
  bar: { width: 12 },
};

const DEFAULT_RUN_COLUMNS = ['status', 'name', 'backend', 'phase', 'elapsed', 'tokens', 'lanes'];
const DEFAULT_LANE_COLUMNS = ['status', 'label', 'phase', 'model', 'elapsed', 'tick', 'tokens', 'bar'];

function defaultsFor(defs, keys) {
  return keys.map((key) => ({ key, width: defs[key].width, align: defs[key].align || 'left' }));
}

function defaultColumns() {
  return {
    run: defaultsFor(RUN_COLUMN_DEFS, DEFAULT_RUN_COLUMNS),
    lane: defaultsFor(LANE_COLUMN_DEFS, DEFAULT_LANE_COLUMNS),
  };
}

/**
 * Validate a parsed top-columns.json value into a usable column layout.
 *
 * Returns `{ columns, warnings }` and NEVER throws: every malformed piece
 * degrades — an unknown key or broken entry is dropped with a warning, a
 * table that ends up empty (or was invalid wholesale) falls back to that
 * table's defaults. The caller decides what to do with the warnings; the
 * layout that comes back is always renderable.
 */
function resolveColumns(raw) {
  const warnings = [];
  const columns = defaultColumns();
  if (raw === null || raw === undefined) return { columns, warnings };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('top-columns config is not an object — using default columns');
    return { columns, warnings };
  }
  if (raw.v !== 1) {
    warnings.push(`top-columns config has unknown version ${JSON.stringify(raw.v)} (expected 1) — using default columns`);
    return { columns, warnings };
  }
  for (const [table, defs, fallbackKeys] of [
    ['run', RUN_COLUMN_DEFS, DEFAULT_RUN_COLUMNS],
    ['lane', LANE_COLUMN_DEFS, DEFAULT_LANE_COLUMNS],
  ]) {
    const given = raw[table];
    if (given === undefined) continue; // that table keeps its defaults
    if (!Array.isArray(given)) {
      warnings.push(`top-columns "${table}" is not an array — using default ${table} columns`);
      continue;
    }
    const resolved = [];
    for (const entry of given) {
      if (!entry || typeof entry !== 'object' || typeof entry.key !== 'string') {
        warnings.push(`top-columns "${table}" has a malformed entry ${JSON.stringify(entry)} — dropped`);
        continue;
      }
      const def = defs[entry.key];
      if (!def) {
        warnings.push(`top-columns "${table}" has unknown column "${entry.key}" (known: ${Object.keys(defs).join(', ')}) — dropped`);
        continue;
      }
      const width = Number.isInteger(entry.width) && entry.width >= 1 && entry.width <= 120
        ? entry.width : def.width;
      if (entry.width !== undefined && width !== entry.width) {
        warnings.push(`top-columns "${table}.${entry.key}" width ${JSON.stringify(entry.width)} is not an integer in 1..120 — using ${width}`);
      }
      const align = entry.align === 'right' || entry.align === 'left'
        ? entry.align : (def.align || 'left');
      if (entry.align !== undefined && align !== entry.align) {
        warnings.push(`top-columns "${table}.${entry.key}" align ${JSON.stringify(entry.align)} is not "left"|"right" — using ${align}`);
      }
      resolved.push({ key: entry.key, width, align });
    }
    if (!resolved.length) {
      warnings.push(`top-columns "${table}" resolved to no usable columns — using default ${table} columns`);
      continue;
    }
    columns[table] = resolved;
  }
  return { columns, warnings };
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

/** Eight fill levels per cell (empty, then the braille ramp). */
const BAR_RAMP = ['⣀', '⣄', '⣤', '⣦', '⣶', '⣷', '⣿'];

/**
 * A `width`-cell bar for `fraction` in [0,1]: full cells are ⣿, the
 * boundary cell shows one of the seven ramp glyphs by its fractional fill,
 * the rest stays blank. `null` fraction renders an empty string — the
 * estimator's "no basis" answer must show NOTHING rather than an empty
 * gauge that reads as 0%.
 */
function renderBar(fraction, width) {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '';
  const clamped = Math.min(1, Math.max(0, fraction));
  const cells = clamped * width;
  const full = Math.floor(cells);
  let bar = BAR_RAMP[BAR_RAMP.length - 1].repeat(full);
  if (full < width) {
    const partial = cells - full;
    const step = Math.floor(partial * BAR_RAMP.length);
    if (step > 0) bar += BAR_RAMP[step - 1];
  }
  return bar;
}

// ---------------------------------------------------------------------------
// Segment bar (state-composition bar for a run's lanes)
// ---------------------------------------------------------------------------

/** The glyph a segment bar is drawn with — one heavy horizontal per cell. */
const SEGMENT_CHAR = '━';

/**
 * Allocate `width` cells across `parts` ({role, count}) proportionally to
 * their counts, using the largest-remainder (Hamilton) method: floors first,
 * then the leftover cells go to the largest fractional remainders, ties
 * broken by part order. Every part with a nonzero count keeps at least the
 * cells its floor earned — the method never invents cells and always sums
 * to exactly `width` (or to 0 when every count is 0).
 *
 * Returns `[{role, text}]` segments, zero-cell segments dropped. The concept
 * (a composition bar over lane states) follows kimi-code's status pip bar;
 * this is an independent implementation.
 */
function segmentBar(parts, width) {
  const list = (Array.isArray(parts) ? parts : [])
    .filter((p) => p && Number.isFinite(p.count) && p.count > 0);
  const total = list.reduce((sum, p) => sum + p.count, 0);
  if (!total || !Number.isFinite(width) || width < 1) return [];
  const quotas = list.map((p, i) => {
    const exact = (p.count * width) / total;
    const base = Math.floor(exact);
    return { i, role: p.role, base, remainder: exact - base };
  });
  let leftover = width - quotas.reduce((sum, q) => sum + q.base, 0);
  const byRemainder = [...quotas].sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const q of byRemainder) {
    if (leftover <= 0) break;
    q.base += 1;
    leftover -= 1;
  }
  return quotas
    .filter((q) => q.base > 0)
    .map((q) => ({ role: q.role, text: SEGMENT_CHAR.repeat(q.base) }));
}

// ---------------------------------------------------------------------------
// Segments (role-tagged text runs) — the color-safe line representation
// ---------------------------------------------------------------------------

/**
 * Cut a list of `{role, text}` segments to at most `width` display cells,
 * marking the cut with `…` — the segment-list analogue of truncateToWidth.
 * All arithmetic happens on the PLAIN text (segments carry no ANSI); color
 * is applied only after this, by paintSegments, so escape codes can never
 * be sheared in half or counted as cells.
 */
function truncateSegments(segments, width) {
  const list = Array.isArray(segments) ? segments : [];
  const totalWidth = list.reduce((sum, s) => sum + displayWidth(s.text), 0);
  if (totalWidth <= width) return list;
  if (width <= 1) return width === 1 ? [{ role: null, text: '…' }] : [];
  const out = [];
  let used = 0;
  for (const seg of list) {
    let kept = '';
    for (const ch of String(seg.text)) {
      const w = charWidth(ch.codePointAt(0));
      if (used + w > width - 1) break; // one cell reserved for the ellipsis
      kept += ch;
      used += w;
    }
    if (kept) out.push({ role: seg.role, text: kept });
    if (kept.length < String(seg.text).length) break;
  }
  out.push({ role: null, text: '…' });
  return out;
}

/** Join segments into one string, painting each through `paint(role, text)`.
 *  A null/unknown role or a missing paint function is plain text — the
 *  colorless path is byte-identical to simply concatenating the texts. */
function paintSegments(segments, paint) {
  const p = typeof paint === 'function' ? paint : null;
  return (Array.isArray(segments) ? segments : [])
    .map((seg) => (p && seg.role && seg.text ? p(seg.role, seg.text) : seg.text))
    .join('');
}

/**
 * SGR paint for a real terminal: role -> basic 16-color/attribute codes
 * that every terminal understands (no 256-color assumptions in a viewer
 * that must work over ssh and inside tmux). Applied strictly AFTER
 * sanitize/truncate/pad — paint receives finished plain cells and only
 * wraps them.
 */
const ANSI_PAINT = {
  accent: ['36', '39'], // cyan — running / in motion
  success: ['32', '39'],
  error: ['31', '39'],
  warning: ['33', '39'],
  dim: ['2', '22'],
  bold: ['1', '22'],
};

function createAnsiPaint() {
  return (role, text) => {
    const codes = ANSI_PAINT[role];
    if (!codes || !text) return text;
    return `\x1b[${codes[0]}m${text}\x1b[${codes[1]}m`;
  };
}

// ---------------------------------------------------------------------------
// Compact numbers
// ---------------------------------------------------------------------------

/** `842`, `9.6k`, `128k`, `1.2M` — token totals in a fixed-width-friendly
 *  form. Empty string for zero/absent: a count that does not exist renders
 *  as nothing, same rule as every other optional cell. */
function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

// ---------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------

/** Run liveness icon: ▶ running, ● ok, ✗ error, ⚠ stale (the lock's pid is
 *  gone while run.json still says running), · unknown. */
const RUN_ICONS = { running: '▶', ok: '●', error: '✗', stale: '⚠', unknown: '·' };

/** Lane state icons (spec order): ◉ running / ● ok / ✗ error / ↻ retrying /
 *  ○ cached (replayed) / 🔸 needs-human. */
function laneIcon(lane) {
  if (lane.needsHuman) return '🔸';
  if (lane.retrying) return '↻';
  switch (lane.status) {
    case 'running': return '◉';
    case 'ok': return '●';
    case 'error': return '✗';
    case 'cached': return '○';
    default: return '·';
  }
}

function runElapsed(view, now) {
  const state = view.state;
  if (!Number.isFinite(state.startTs)) return '';
  const end = Number.isFinite(state.endTs) ? state.endTs : now;
  return formatElapsed(Math.max(0, end - state.startTs));
}

/** `done/total` over the run's own agent lanes AND its nested lane runs. */
function laneCounts(view) {
  let total = view.state.lanes.size;
  let done = 0;
  for (const lane of view.state.lanes.values()) {
    if (lane.status === 'ok' || lane.status === 'error' || lane.status === 'cached') done += 1;
  }
  for (const child of view.children || []) {
    total += 1;
    if (child.liveness === 'ok' || child.liveness === 'error') done += 1;
  }
  return { done, total };
}

function runCellValue(key, view, now) {
  const p = view.state.progress;
  switch (key) {
    case 'status': return RUN_ICONS[view.liveness] || RUN_ICONS.unknown;
    case 'name': return p.name || (view.meta && view.meta.name) || view.runId;
    case 'backend': return p.backend || (view.meta && view.meta.backend) || '';
    case 'phase': {
      if (!p.phaseTitle && !p.phases.length) return '';
      const counter = p.phases.length ? `${p.phaseIndex}/${p.phases.length}` : '';
      return [counter, p.phaseTitle || ''].filter(Boolean).join(' ');
    }
    case 'elapsed': return runElapsed(view, now);
    case 'tokens': return view.state.tokens ? String(view.state.tokens) : '';
    case 'lanes': {
      const { done, total } = laneCounts(view);
      return total ? `${done}/${total}` : '';
    }
    case 'id': return view.runId;
    default: return '';
  }
}

function laneElapsedMs(lane, now) {
  if (Number.isFinite(lane.durationMs)) return lane.durationMs;
  if (!Number.isFinite(lane.startedTs)) return null;
  const end = Number.isFinite(lane.endedTs) ? lane.endedTs : now;
  return Math.max(0, end - lane.startedTs);
}

function laneCellValue(key, lane, view, now, barWidth) {
  switch (key) {
    case 'status': return laneIcon(lane);
    case 'label': return lane.label || `#${lane.index}`;
    case 'phase': return lane.phase || '';
    case 'backend': return lane.backend || '';
    case 'model': return [lane.backend, lane.model].filter(Boolean).join('/');
    case 'elapsed': {
      const ms = laneElapsedMs(lane, now);
      return ms === null ? '' : formatElapsed(ms);
    }
    case 'tick': return lane.toolCalls ? String(lane.toolCalls) : '';
    case 'tokens': return Number.isFinite(lane.tokens) ? String(lane.tokens) : '';
    case 'bar': {
      // Only a RUNNING lane gets a bar, and only when the run has finished
      // siblings to base it on — estimateProgress returns null otherwise
      // and null renders as nothing (no invented percentage).
      if (lane.status !== 'running') return '';
      const elapsedMs = laneElapsedMs(lane, now);
      const fraction = estimateProgress(
        { elapsedMs: elapsedMs === null ? 0 : elapsedMs, toolCalls: lane.toolCalls },
        completedSiblings(view.state, lane.index),
      );
      return renderBar(fraction, barWidth);
    }
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Rows and screen
// ---------------------------------------------------------------------------

const CELL_GAP = '  ';
const LANE_INDENT = '  ';

/** Paint role for a run's liveness — colors carry STATE, nothing else, so
 *  the mapping is fixed: motion is accent, settled-good is success,
 *  settled-bad is error, needs-a-human (stale) is warning. */
function runStatusRole(liveness) {
  switch (liveness) {
    case 'running': return 'accent';
    case 'ok': return 'success';
    case 'error': return 'error';
    case 'stale': return 'warning';
    default: return 'dim';
  }
}

/** Paint role for a lane's state — same precedence order as laneIcon, so
 *  icon shape and icon color never disagree. */
function laneStatusRole(lane) {
  if (lane.needsHuman) return 'warning';
  if (lane.retrying) return 'warning';
  switch (lane.status) {
    case 'running': return 'accent';
    case 'ok': return 'success';
    case 'error': return 'error';
    case 'cached': return 'dim';
    default: return 'dim';
  }
}

/**
 * Join padded cells into one row: trailing all-blank cells are dropped and
 * the last surviving cell is right-trimmed BEFORE paint runs, so the
 * colorless output is byte-identical to the historical `.replace(/\s+$/)`
 * form and no trailing spaces ever hide inside an ANSI wrapper.
 * `cells` is `[{text, role}]`; only the status cell ever carries a role
 * here (kubectl's discipline: color the state, keep the data plain).
 */
function joinCells(cells, paint) {
  const kept = [...cells];
  while (kept.length && !kept[kept.length - 1].text.trim()) kept.pop();
  if (!kept.length) return '';
  const last = kept.length - 1;
  kept[last] = { ...kept[last], text: kept[last].text.replace(/\s+$/, '') };
  const p = typeof paint === 'function' ? paint : null;
  return kept
    .map((cell) => (p && cell.role && cell.text ? p(cell.role, cell.text) : cell.text))
    .join(CELL_GAP);
}

function renderRunRow(view, runColumns, now, paint) {
  const cells = runColumns.map((col) => ({
    text: padCell(runCellValue(col.key, view, now), col.width, col.align),
    role: col.key === 'status' ? runStatusRole(view.liveness) : null,
  }));
  return joinCells(cells, paint);
}

function renderLaneRow(lane, view, laneColumns, now, paint) {
  const cells = laneColumns.map((col) => ({
    text: padCell(laneCellValue(col.key, lane, view, now, col.width), col.width, col.align),
    role: col.key === 'status' ? laneStatusRole(lane) : null,
  }));
  const row = joinCells(cells, paint);
  return row ? LANE_INDENT + row : LANE_INDENT.replace(/\s+$/, '');
}

/** kubectl-style column labels. The 2-cell status column is labelled blank
 *  (an icon column explains itself; "STATUS" cannot fit in 2 cells), and
 *  `elapsed` reads AGE — the kubectl word for exactly this column. */
const COLUMN_LABELS = {
  status: '', name: 'NAME', backend: 'BACKEND', phase: 'PHASE',
  elapsed: 'AGE', tokens: 'TOKENS', lanes: 'LANES', id: 'ID',
  label: 'LANE', model: 'MODEL', tick: 'TICK', bar: 'PROGRESS',
};

/** The dim header row over the run table — kubectl's "a header makes the
 *  table legible to someone who has never seen it" move. Same padCell
 *  arithmetic as the data rows, so the labels sit exactly over their
 *  columns whatever the schema override says. */
function renderHeaderRow(columns, paint) {
  const cells = columns.map((col) => ({
    text: padCell(COLUMN_LABELS[col.key] !== undefined ? COLUMN_LABELS[col.key] : col.key.toUpperCase(), col.width, col.align),
    role: null,
  }));
  const row = joinCells(cells, null);
  const painted = typeof paint === 'function' && row ? paint('dim', row) : row;
  return painted;
}

/**
 * A nested lane run (runId `<parent>-lane-<label>`) rendered as lane rows
 * of its parent's block: its own agent calls, labelled by the lane suffix
 * when the call's label is the generic transport one. A child with no
 * events yet still gets one row, so a lane that has locked its runDir but
 * not spoken shows up instead of silently not existing.
 */
function renderChildRows(child, laneColumns, now, paint) {
  const lanes = laneList(child.state);
  if (!lanes.length) {
    const placeholder = {
      index: 0,
      label: child.laneLabel,
      phase: null,
      backend: (child.meta && child.meta.backend) || null,
      model: (child.meta && child.meta.model) || null,
      status: child.liveness === 'running' || child.liveness === 'stale' ? 'running' : child.liveness,
      startedTs: null,
      endedTs: null,
      durationMs: null,
      toolCalls: 0,
      tokens: null,
      retrying: false,
      needsHuman: false,
    };
    return [renderLaneRow(placeholder, child, laneColumns, now, paint)];
  }
  return lanes.map((lane) => {
    // 'yoki-agent' is the CLI's default label — the lane suffix from the
    // runId names the work better than the transport does.
    const label = !lane.label || lane.label === 'yoki-agent' ? child.laneLabel : lane.label;
    return renderLaneRow({ ...lane, label }, child, laneColumns, now, paint);
  });
}

function clock(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * The whole screen as one string (no ANSI — the frame is top.js's job):
 * header, one block per top-level run (run row, its lane rows, then its
 * nested lane runs' rows), footer with the token total and the quit hint.
 *
 * Color (`options.paint`) is a pure parameter, not an environment probe:
 * the caller decides (TTY and NO_COLOR live in top.js), and the paint
 * function only ever wraps cells that padCell has already sanitized and
 * measured. With no paint the output is byte-identical to the historical
 * plain screen. What gets color follows kubectl's restraint — the status
 * icons (state), the column header and the footer (chrome, dimmed); every
 * data cell stays the terminal's normal text color.
 *
 * @param {Array<object>} views top-level run views, each
 *   `{runId, state, liveness, meta, children: [{runId, laneLabel, state, liveness, meta}]}`
 * @param {{run: Array, lane: Array}} columns from resolveColumns
 * @param {number} now epoch ms
 * @param {{hint?: string|null, paint?: Function}} [options] footer hint
 *   (null for snapshots) and the cell paint function (absent for plain)
 */
function renderScreen(views, columns, now, options = {}) {
  const paint = typeof options.paint === 'function' ? options.paint : null;
  const dim = (text) => (paint ? paint('dim', text) : text);
  const lines = [];
  const active = views.filter((v) => v.liveness === 'running' || v.liveness === 'stale').length;
  const done = views.length - active;
  lines.push(`yoki-graph top — ${active} active / ${done} done — ${clock(now)}`);
  lines.push('');
  if (!views.length) {
    lines.push('(no runs)');
  } else {
    lines.push(renderHeaderRow(columns.run, paint));
  }
  let tokens = 0;
  for (const view of views) {
    tokens += view.state.tokens;
    lines.push(renderRunRow(view, columns.run, now, paint));
    for (const lane of laneList(view.state)) {
      lines.push(renderLaneRow(lane, view, columns.lane, now, paint));
    }
    for (const child of view.children || []) {
      tokens += child.state.tokens;
      lines.push(...renderChildRows(child, columns.lane, now, paint));
    }
    lines.push('');
  }
  const hint = options.hint === undefined ? 'q quit' : options.hint;
  lines.push(dim([`tokens ${tokens}`, hint].filter(Boolean).join(' — ')));
  return `${lines.join('\n')}\n`;
}

module.exports = {
  displayWidth, truncateToWidth, padCell, charWidth, sanitizeText,
  resolveColumns, defaultColumns,
  RUN_COLUMN_DEFS, LANE_COLUMN_DEFS, DEFAULT_RUN_COLUMNS, DEFAULT_LANE_COLUMNS,
  renderBar, BAR_RAMP,
  segmentBar, SEGMENT_CHAR, truncateSegments, paintSegments, createAnsiPaint,
  formatTokens,
  renderRunRow, renderLaneRow, renderScreen, renderHeaderRow, COLUMN_LABELS,
  runStatusRole, laneStatusRole,
  runCellValue, laneCellValue, laneIcon, RUN_ICONS, laneCounts,
};
