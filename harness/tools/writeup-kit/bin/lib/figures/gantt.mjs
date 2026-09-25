// `type: gantt` — tasks on a time axis: one row per task, rows gathered
// under a group band (phase), a tick header whose labels are thinned until
// none overlap, bars for spans, diamonds for milestones and finish-to-start
// dependency arrows that leave a bar's end and drop into the next bar's
// start. The figure answers "what runs when, what overlaps, and which
// milestone gates which step" — the reading the diagram-pattern survey
// files under "Gantt" (left label column + time axis, 40px rows, 24px bars,
// phases as background zones).
//
// IR shape: `{ id, type:'gantt', title, caption, unit, range, tasks, deps }`.
//   - `unit`  — `day` (`YYYY-MM-DD`), `week` (`YYYY-Www`, ISO week),
//     `month` (`YYYY-MM`) or `ordinal` (integer ≥ 0: sprint 1, 2, 3 …);
//     every `from`/`to`/`range` value is written in that unit's syntax;
//   - `range` — `{ from, to }`, optional; derived from the tasks when absent
//     (normalize() fills it in so the embedded IR re-normalizes unchanged);
//   - `tasks` — `[{ id, label, from, to, group?, emphasis?, tone?, milestone? }]`
//     in row order (≤ 12 guidance); `to` is inclusive; a milestone has no
//     `to` (it equals `from`); either every task carries a `group` or none;
//   - `deps`  — `[{ from, to }]` finish-to-start arrows between task ids.
//     Deliberate deviation from the diagram-pattern survey (#22), which
//     forbids dependency arrows by default: the kit keeps them as an
//     opt-in, but any use is reported as `budget:deps` (limit 0) so the
//     author hears the survey's advice — say the order with rows and
//     phases first, draw an arrow only for the gate the caption is about.
//
// Budgets (survey #22): tasks ≤ 12, groups ≤ 4, label ≤ 14 chars, one
// focal task, at most 5 tasks in flight at once inside a group
// (`budget:parallel`; milestones are points and do not count), deps 0.
//
// Layout is a deterministic grid, no layout engine: the label column is
// fitted to the widest task label, the unit width is chosen so the chart
// fills the column (clamped to 4..48px, multiples of 4 so every bar edge
// sits on the 4px grid), tick labels are thinned to the first step whose
// pitch holds the widest label, rows are 40px with 24px bars. A dependency
// arrow leaves the predecessor's right edge, runs 8px past the successor's
// start and drops into the successor's top (or rises into its bottom); a
// successor that starts before its predecessor ends is routed around the
// row edge instead. Whether an arrow crosses another bar is what the
// `deps-clear` row then proves — the plugin never hides a bad schedule.
//
// Import rule (references/figure-types.md): _shared.mjs and diagram.mjs
// constants only — never ir.mjs / verify-diagram.mjs / figures/index.mjs.
import { IrError, isObj, requireStr, optStr, validateTone, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE, COLUMN, BOLD_FACTOR } from '../diagram.mjs'

export const type = 'gantt'

export const limits = { maxTasks: 12, maxGroups: 4, maxLabelLen: 14, maxEmphasis: 1, maxDeps: 0, maxParallel: 5 }

const UNITS = ['day', 'week', 'month', 'ordinal']

// --- layout constants (multiples of 4 unless noted) ------------------------
const MARGIN = 16
const HEADER_H = 24           // tick labels above the axis rule
const BAND_H = 24             // group label band
const ROW_H = 40
const BAR_H = 24
const BAR_TOP = (ROW_H - BAR_H) / 2
const MS_HALF = 8             // milestone diamond half-diagonal
const LABEL_GAP = 16          // label column → chart
const GROUP_INDENT = 12       // task labels under a group band
const UNIT_W_MIN = 4
const UNIT_W_MAX = 48
const TICK_LABEL_PAD = 8      // thinning: step pitch must hold the label + this
const DEP_STUB = 8
const TICK_STEPS = {
  day: [1, 2, 7, 14, 28, 56, 112],
  week: [1, 2, 4, 8, 13, 26, 52],
  month: [1, 2, 3, 6, 12, 24],
  ordinal: [1, 2, 5, 10, 20, 50, 100],
}

// --- time arithmetic -----------------------------------------------------
//
// Every unit maps its syntax onto an integer index (days since 1970-01-01,
// ISO weeks since the week of 1970-01-05, months since 0000-01, the ordinal
// itself) so layout only ever multiplies an index difference by the unit
// width. Labels go the other way.

const DAY_MS = 86400000
const pad2 = (n) => String(n).padStart(2, '0')
const daysOf = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
const ymdOf = (days) => { const dt = new Date(days * DAY_MS); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() } }
const isoDow = (days) => (((days + 3) % 7) + 7) % 7 + 1          // Mon=1 … Sun=7 (day 0 is a Thursday)
const mondayOf = (days) => days - (isoDow(days) - 1)
const week1Monday = (y) => mondayOf(daysOf(y, 1, 4))
const weekIndexOfMonday = (monday) => (monday - 4) / 7           // 1970-01-05 → 0
const mondayOfWeekIndex = (k) => k * 7 + 4
function isoWeekOf(days) {
  const monday = mondayOf(days)
  const y = ymdOf(monday + 3).y                                   // the ISO year is the Thursday's year
  return { y, w: (monday - week1Monday(y)) / 7 + 1 }
}

const SYNTAX = {
  day: 'YYYY-MM-DD',
  week: 'YYYY-Www (ISO week)',
  month: 'YYYY-MM',
  ordinal: 'an integer ≥ 0',
}

/** Parse one `from`/`to`/`range` value in `unit` syntax → integer index, or
 * throw IrError naming the field. */
function parseTime(value, unit, ctx) {
  const bad = () => new IrError(`${ctx} must be ${SYNTAX[unit]} for unit "${unit}" (got: ${JSON.stringify(value)})`)
  if (unit === 'ordinal') {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN)
    if (!Number.isInteger(n) || n < 0) throw bad()
    return n
  }
  if (typeof value !== 'string') throw bad()
  if (unit === 'day') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!m) throw bad()
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const days = daysOf(y, mo, d)
    const back = ymdOf(days)
    if (back.y !== y || back.m !== mo || back.d !== d) throw bad()
    return days
  }
  if (unit === 'week') {
    const m = /^(\d{4})-W(\d{2})$/.exec(value)
    if (!m) throw bad()
    const [y, w] = [Number(m[1]), Number(m[2])]
    if (w < 1 || w > 53) throw bad()
    const monday = week1Monday(y) + (w - 1) * 7
    if (isoWeekOf(monday).y !== y) throw bad()   // week 53 of a 52-week year
    return weekIndexOfMonday(monday)
  }
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  if (!m) throw bad()
  const [y, mo] = [Number(m[1]), Number(m[2])]
  if (mo < 1 || mo > 12) throw bad()
  return y * 12 + (mo - 1)
}

/** The canonical text of index `t` in `unit` syntax (what normalize stores). */
function formatTime(t, unit) {
  if (unit === 'ordinal') return t
  if (unit === 'day') { const { y, m, d } = ymdOf(t); return `${y}-${pad2(m)}-${pad2(d)}` }
  if (unit === 'week') { const { y, w } = isoWeekOf(mondayOfWeekIndex(t)); return `${y}-W${pad2(w)}` }
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`
}

/** The short tick label of index `t`. */
function tickLabel(t, unit) {
  if (unit === 'ordinal') return String(t)
  if (unit === 'day') { const { m, d } = ymdOf(t); return `${m}/${d}` }
  if (unit === 'week') return `W${pad2(isoWeekOf(mondayOfWeekIndex(t)).w)}`
  return formatTime(t, unit)
}

/** Whether index `t` is a tick at `step` — anchored on Mondays for weekly
 * day steps, on January for months, on multiples otherwise. */
function isTick(t, unit, step) {
  if (unit === 'day' && step % 7 === 0) return isoDow(t) === 1 && (((weekIndexOfMonday(mondayOf(t)) % (step / 7)) + step / 7) % (step / 7)) === 0
  return ((t % step) + step) % step === 0
}

// --- schema --------------------------------------------------------------

const compact = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const unit = normalizeUnit(raw.unit, ctx)
  const tasks = normalizeTasks(raw.tasks, unit, ctx)
  const range = normalizeRange(raw.range, unit, tasks, ctx)
  const deps = normalizeDeps(raw.deps, tasks, ctx)
  return compact({ id, type, title, caption, unit, range, tasks, deps })
}

function normalizeUnit(raw, ctx) {
  if (typeof raw !== 'string' || !UNITS.includes(raw)) throw new IrError(`${ctx}.unit must be ${UNITS.join('|')} (got: ${JSON.stringify(raw)})`)
  return raw
}

function normalizeTasks(raw, unit, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.tasks must be a non-empty list`)
  const seen = new Set()
  const tasks = raw.map((t, i) => {
    const tctx = `${ctx}.tasks[${i}]`
    if (!isObj(t)) throw new IrError(`${tctx} must be a mapping`)
    const id = requireStr(t, 'id', tctx)
    if (seen.has(id)) throw new IrError(`${ctx}.tasks: duplicate task id "${id}"`)
    seen.add(id)
    const label = requireStr(t, 'label', tctx)
    const group = optStr(t, 'group', tctx)
    if (group !== undefined && group.trim() === '') throw new IrError(`${tctx}.group must be a non-empty string`)
    const emphasis = validateBool(t, 'emphasis', tctx)
    const tone = validateTone(t.tone, tctx)
    const milestone = validateBool(t, 'milestone', tctx)
    if (t.from === undefined || t.from === null) throw new IrError(`${tctx}.from is required (${SYNTAX[unit]})`)
    const t0 = parseTime(t.from, unit, `${tctx}.from`)
    let t1
    if (milestone) {
      t1 = t.to === undefined || t.to === null ? t0 : parseTime(t.to, unit, `${tctx}.to`)
      if (t1 !== t0) throw new IrError(`${tctx}.to must equal from for a milestone (got: ${JSON.stringify(t.to)})`)
    } else {
      if (t.to === undefined || t.to === null) throw new IrError(`${tctx}.to is required for a task (${SYNTAX[unit]}); set milestone: true for a single point`)
      t1 = parseTime(t.to, unit, `${tctx}.to`)
      if (t1 < t0) throw new IrError(`${tctx}.to (${formatTime(t1, unit)}) is before from (${formatTime(t0, unit)})`)
    }
    return compact({ id, label, from: formatTime(t0, unit), to: formatTime(t1, unit), group, emphasis, tone, milestone })
  })
  const grouped = tasks.filter((t) => t.group !== undefined).length
  if (grouped !== 0 && grouped !== tasks.length) {
    const first = tasks.find((t) => t.group === undefined)
    throw new IrError(`${ctx}.tasks[${tasks.indexOf(first)}].group is missing — either every task carries a group or none does`)
  }
  return tasks
}

function normalizeRange(raw, unit, tasks, ctx) {
  const idx = (t) => parseTime(t.from, unit, `${ctx}.tasks`)
  const end = (t) => parseTime(t.to, unit, `${ctx}.tasks`)
  if (raw === undefined || raw === null) {
    const from = Math.min(...tasks.map(idx))
    const to = Math.max(...tasks.map(end))
    return { from: formatTime(from, unit), to: formatTime(to, unit) }
  }
  if (!isObj(raw)) throw new IrError(`${ctx}.range must be a mapping { from, to }`)
  if (raw.from === undefined || raw.from === null) throw new IrError(`${ctx}.range.from is required (${SYNTAX[unit]})`)
  if (raw.to === undefined || raw.to === null) throw new IrError(`${ctx}.range.to is required (${SYNTAX[unit]})`)
  const from = parseTime(raw.from, unit, `${ctx}.range.from`)
  const to = parseTime(raw.to, unit, `${ctx}.range.to`)
  if (to < from) throw new IrError(`${ctx}.range.to (${formatTime(to, unit)}) is before range.from (${formatTime(from, unit)})`)
  return { from: formatTime(from, unit), to: formatTime(to, unit) }
}

function normalizeDeps(raw, tasks, ctx) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new IrError(`${ctx}.deps must be a list of { from, to } task references`)
  const ids = new Set(tasks.map((t) => t.id))
  return raw.map((d, i) => {
    const dctx = `${ctx}.deps[${i}]`
    if (!isObj(d)) throw new IrError(`${dctx} must be a mapping`)
    const from = requireStr(d, 'from', dctx)
    const to = requireStr(d, 'to', dctx)
    if (!ids.has(from)) throw new IrError(`${dctx}.from references unknown task "${from}"`)
    if (!ids.has(to)) throw new IrError(`${dctx}.to references unknown task "${to}"`)
    if (from === to) throw new IrError(`${dctx}: from and to must differ`)
    return { from, to }
  })
}

// --- budgets -------------------------------------------------------------

const groupsOf = (ir) => [...new Set(ir.tasks.map((t) => t.group).filter((g) => g !== undefined))]

/** Per group (the whole chart when ungrouped): the most tasks in flight at
 * one time, by sweeping start/end events — `to` is inclusive, so a task
 * ending at t and one starting at t overlap while t+1 is clear. Milestones
 * are points, not work, and are left out. */
function peakParallel(ir) {
  const blocks = new Map()
  for (const t of ir.tasks) {
    if (t.milestone) continue
    const key = t.group ?? ''
    if (!blocks.has(key)) blocks.set(key, [])
    blocks.get(key).push({ t0: parseTime(t.from, ir.unit, 'ir.tasks'), t1: parseTime(t.to, ir.unit, 'ir.tasks') })
  }
  let peak = { group: undefined, count: 0 }
  for (const [group, spans] of blocks) {
    const events = spans.flatMap((s) => [{ t: s.t0, d: 1 }, { t: s.t1 + 1, d: -1 }])
      .sort((a, b) => a.t - b.t || a.d - b.d)
    let open = 0
    for (const e of events) {
      open += e.d
      if (open > peak.count) peak = { group: group === '' ? undefined : group, count: open }
    }
  }
  return peak
}

export function budgetWarnings(ir) {
  const out = []
  const n = ir.tasks.length
  if (n > limits.maxTasks) {
    out.push(budgetWarning('budget:tasks', n, limits.maxTasks,
      `${n} task(s) (guidance ≤ ${limits.maxTasks})`,
      `split the chart after task ${limits.maxTasks} ("${ir.tasks[limits.maxTasks - 1].label}") into a second figure, or roll sub-tasks up into their phase`))
  }
  const groups = groupsOf(ir)
  if (groups.length > limits.maxGroups) {
    out.push(budgetWarning('budget:groups', groups.length, limits.maxGroups,
      `${groups.length} group(s) (guidance ≤ ${limits.maxGroups})`,
      `merge groups past "${groups[limits.maxGroups - 1]}" — a 5th band reads as a table of phases, not a schedule`))
  }
  const long = []
  for (const t of ir.tasks) {
    const len = [...t.label].length
    if (len > limits.maxLabelLen) long.push({ id: t.id, label: t.label, len })
  }
  for (const g of groups) {
    const len = [...g].length
    if (len > limits.maxLabelLen) long.push({ id: `group "${g}"`, label: g, len })
  }
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:label', longest.len, limits.maxLabelLen,
      long.map((e) => `${e.id.startsWith('group') ? e.id : `task "${e.id}"`} label "${e.label}" is ${e.len} chars (guidance ≤ ${limits.maxLabelLen})`).join('; '),
      long.map((e) => `shorten "${e.label}" (${e.len} > ${limits.maxLabelLen})`).join('; ') + ', or move the detail into the caption'))
  }
  const emphasized = ir.tasks.filter((t) => t.emphasis)
  if (emphasized.length > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized.length, limits.maxEmphasis,
      `${emphasized.length} emphasized task(s) (guidance ≤ ${limits.maxEmphasis})`,
      `keep emphasis on the one task the schedule hinges on (${emphasized.map((t) => `"${t.id}"`).join(', ')} are all emphasized)`))
  }
  if (ir.deps.length > limits.maxDeps) {
    out.push(budgetWarning('budget:deps', ir.deps.length, limits.maxDeps,
      `${ir.deps.length} dependency arrow(s) (guidance: none — the survey forbids them by default)`,
      'say the order with row order and phases instead; keep an arrow only for the one gate the caption is about'))
  }
  const peak = peakParallel(ir)
  if (peak.count > limits.maxParallel) {
    out.push(budgetWarning('budget:parallel', peak.count, limits.maxParallel,
      `${peak.count} task(s) in flight at once${peak.group !== undefined ? ` in group "${peak.group}"` : ''} (guidance ≤ ${limits.maxParallel})`,
      'stagger the tasks, roll the parallel ones up into one bar, or split the phase into two groups'))
  }
  return out
}

// --- layout --------------------------------------------------------------

export async function layout(ir, { column = COLUMN } = {}) {
  const { unit } = ir
  const r0 = parseTime(ir.range.from, unit, 'ir.range.from')
  const r1 = parseTime(ir.range.to, unit, 'ir.range.to')
  const nUnits = r1 - r0 + 1
  const grouped = ir.tasks.some((t) => t.group !== undefined)
  const indent = grouped ? GROUP_INDENT : 0

  // 1. label column fitted to the widest task label
  const labelW = Math.max(...ir.tasks.map((t) => textWidth(t.label, FONT_SIZE) * (t.emphasis ? BOLD_FACTOR : 1)))
  const labelColW = snapUp4(indent + Math.ceil(labelW))
  const chartLeft = MARGIN + labelColW + LABEL_GAP

  // 2. unit width: fill the column, clamped to 4..48 on the 4px grid
  const available = column - MARGIN - chartLeft
  const unitW = Math.max(UNIT_W_MIN, Math.min(UNIT_W_MAX, Math.floor(available / nUnits / 4) * 4))
  const chartRight = chartLeft + nUnits * unitW
  const width = snapUp4(chartRight + MARGIN)
  const xOf = (t) => chartLeft + (t - r0) * unitW

  // 3. ticks: the first step whose pitch holds the widest label
  const steps = TICK_STEPS[unit]
  let step = steps[steps.length - 1]
  for (const s of steps) {
    const labels = []
    for (let t = r0; t <= r1; t++) if (isTick(t, unit, s)) labels.push(tickLabel(t, unit))
    const widest = labels.length ? Math.max(...labels.map((l) => textWidth(l, EDGE_LABEL_SIZE))) : 0
    if (s * unitW >= Math.ceil(widest) + TICK_LABEL_PAD) { step = s; break }
  }
  const axisY = MARGIN + HEADER_H
  const ticks = []
  for (let t = r0; t <= r1; t++) {
    if (!isTick(t, unit, step)) continue
    const label = tickLabel(t, unit)
    const x = xOf(t)
    const labelWidth = Math.ceil(textWidth(label, EDGE_LABEL_SIZE))
    ticks.push({ t, x, label, labelX: x + 4, labelY: axisY - 8, labelWidth, showLabel: x + 4 + labelWidth <= chartRight })
  }

  // 4. bands + rows, tasks gathered under their group in first-appearance order
  const order = []
  if (grouped) {
    for (const g of groupsOf(ir)) order.push({ group: g, tasks: ir.tasks.filter((t) => t.group === g) })
  } else {
    order.push({ group: undefined, tasks: ir.tasks })
  }
  const bands = []
  const rows = []
  const bars = []
  const labels = []
  const indexOf = new Map(ir.tasks.map((t, i) => [t.id, i]))
  let y = axisY
  order.forEach((blk, b) => {
    if (blk.group !== undefined) {
      bands.push({ group: blk.group, index: b, x: MARGIN, y, width: width - MARGIN * 2, height: BAND_H, label: { x: MARGIN + 4, y: y + 16, text: blk.group } })
      y += BAND_H
    }
    for (const t of blk.tasks) {
      const index = indexOf.get(t.id)
      const row = { task: t.id, index, group: blk.group, y, height: ROW_H, centerY: y + ROW_H / 2 }
      rows.push(row)
      const t0 = parseTime(t.from, unit, 'ir.tasks.from')
      const t1 = parseTime(t.to, unit, 'ir.tasks.to')
      if (t.milestone) {
        const cx = snap4(xOf(t0) + unitW / 2)
        bars.push({ task: t.id, index, kind: 'milestone', t0, t1, cx, cy: row.centerY, x: cx - MS_HALF, y: row.centerY - MS_HALF, width: MS_HALF * 2, height: MS_HALF * 2, centerY: row.centerY, emphasis: t.emphasis, tone: t.tone })
      } else {
        bars.push({ task: t.id, index, kind: 'bar', t0, t1, x: xOf(t0), y: y + BAR_TOP, width: (t1 - t0 + 1) * unitW, height: BAR_H, centerY: row.centerY, emphasis: t.emphasis, tone: t.tone })
      }
      labels.push({ task: t.id, index, x: MARGIN + indent, y: row.centerY + 4, text: t.label, emphasis: t.emphasis, width: Math.ceil(textWidth(t.label, FONT_SIZE) * (t.emphasis ? BOLD_FACTOR : 1)) })
      y += ROW_H
    }
  })
  const bottom = y
  const height = snapUp4(bottom + MARGIN)

  // 5. dependency arrows: finish → start
  const barOf = new Map(bars.map((b) => [b.task, b]))
  const rowOf = new Map(rows.map((r) => [r.task, r]))
  const deps = ir.deps.map((d, index) => {
    const from = barOf.get(d.from), to = barOf.get(d.to)
    const fromRow = rowOf.get(d.from), toRow = rowOf.get(d.to)
    const down = toRow.y > fromRow.y
    const x2f = from.x + from.width
    const x1t = to.x
    const cyf = from.centerY
    let path
    if (x1t >= x2f) {
      // drop-in: right past the successor's start, then into its top/bottom edge
      const xm = x1t + (to.width < 16 ? 4 : DEP_STUB)
      const yEdge = down ? to.y : to.y + to.height
      path = [{ x: x2f, y: cyf }, { x: xm, y: cyf }, { x: xm, y: yEdge }]
    } else {
      // successor starts before the predecessor ends: around the row edge
      const yEdge = down ? fromRow.y + fromRow.height : fromRow.y
      const xa = x2f + DEP_STUB, xb = x1t - DEP_STUB
      path = [{ x: x2f, y: cyf }, { x: xa, y: cyf }, { x: xa, y: yEdge }, { x: xb, y: yEdge }, { x: xb, y: to.centerY }, { x: x1t, y: to.centerY }]
    }
    return { from: d.from, to: d.to, index, path }
  })

  return {
    width,
    height,
    geo: {
      unit, unitW, range: { t0: r0, t1: r1, units: nUnits },
      labelColumn: { x: MARGIN, width: labelColW },
      axis: { y: axisY, x1: chartLeft, x2: chartRight },
      chartLeft, chartRight, bottom, rowHeight: ROW_H, barHeight: BAR_H,
      ticks, bands, rows, bars, labels, deps,
    },
  }
}

// --- drawing -------------------------------------------------------------

const pathD = (pts) => `M${pts[0].x} ${pts[0].y} ${pts.slice(1).map((p) => `L${p.x} ${p.y}`).join(' ')}`

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []
  parts.push('<defs>')
  parts.push(`<marker id="${uid}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push('</defs>')

  // group bands (under everything)
  for (const b of geo.bands) {
    parts.push(`<rect id="${uid}-band-${b.index}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="var(--wu-rule-soft)"/>`)
    parts.push(`<text id="${uid}-band-${b.index}-label" x="${b.label.x}" y="${b.label.y}" font-size="${EDGE_LABEL_SIZE}" font-weight="700" fill="var(--wu-ink-3)">${esc(b.label.text)}</text>`)
  }

  // tick grid, chart frame, axis
  geo.ticks.forEach((t, i) => {
    parts.push(`<line id="${uid}-tick-${i}" x1="${t.x}" y1="${geo.axis.y}" x2="${t.x}" y2="${geo.bottom}" stroke="var(--wu-rule-soft)" stroke-width="1"/>`)
  })
  parts.push(`<line id="${uid}-frame-l" x1="${geo.chartLeft}" y1="${geo.axis.y}" x2="${geo.chartLeft}" y2="${geo.bottom}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  parts.push(`<line id="${uid}-frame-r" x1="${geo.chartRight}" y1="${geo.axis.y}" x2="${geo.chartRight}" y2="${geo.bottom}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  parts.push(`<line id="${uid}-axis" x1="${geo.axis.x1}" y1="${geo.axis.y}" x2="${geo.axis.x2}" y2="${geo.axis.y}" stroke="var(--wu-rule)" stroke-width="1"/>`)
  geo.ticks.forEach((t, i) => {
    if (!t.showLabel) return
    parts.push(`<text id="${uid}-tick-${i}-label" x="${t.labelX}" y="${t.labelY}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(t.label)}</text>`)
  })

  // dependency arrows before bars (z-order rule)
  for (const d of geo.deps) {
    parts.push(`<path id="${uid}-dep-${d.index}" d="${pathD(d.path)}" fill="none" stroke="currentColor" stroke-width="1" marker-end="url(#${uid}-solid)"/>`)
  }

  // bars and milestones
  for (const b of geo.bars) {
    const cls = b.emphasis ? ' class="wu-focal"' : ''
    const sw = b.emphasis ? 1.5 : 1
    if (b.kind === 'milestone') {
      const side = 12
      parts.push(`<rect id="${uid}-ms-${b.index}"${cls} x="${b.cx - side / 2}" y="${b.cy - side / 2}" width="${side}" height="${side}" transform="rotate(45 ${b.cx} ${b.cy})" fill="currentColor" stroke="currentColor" stroke-width="${sw}"/>`)
    } else {
      parts.push(`<rect id="${uid}-bar-${b.index}"${cls} data-tone="${esc(b.tone)}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="none" stroke="currentColor" stroke-width="${sw}"/>`)
    }
  }

  // task labels
  for (const l of geo.labels) {
    const weight = l.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text id="${uid}-label-${l.index}" x="${l.x}" y="${l.y}" font-size="${FONT_SIZE}"${weight} fill="currentColor">${esc(l.text)}</text>`)
  }

  return parts.join('')
}

// --- verify --------------------------------------------------------------

const inside = (v, lo, hi) => v > lo && v < hi
const overlapsOpen = (a1, a2, b1, b2) => Math.max(a1, b1) < Math.min(a2, b2)

/** Whether the segment p→q passes through the interior of rect r. */
function segmentThroughRect(p, q, r) {
  if (p.y === q.y) {
    return inside(p.y, r.y, r.y + r.height) && overlapsOpen(Math.min(p.x, q.x), Math.max(p.x, q.x), r.x, r.x + r.width)
  }
  if (p.x === q.x) {
    return inside(p.x, r.x, r.x + r.width) && overlapsOpen(Math.min(p.y, q.y), Math.max(p.y, q.y), r.y, r.y + r.height)
  }
  return true // diagonal — never allowed
}

export function verify(layoutResult, ir) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'task-count', 'budget:tasks', `${ir.tasks.length} task(s)`)
  budgetRow(2, 'group-count', 'budget:groups', `${groupsOf(ir).length} group(s)`)
  budgetRow(3, 'label-length', 'budget:label', `every label ≤ ${limits.maxLabelLen} chars`)
  budgetRow(4, 'emphasis-count', 'budget:emphasis', `${ir.tasks.filter((t) => t.emphasis).length} emphasized task(s)`)
  budgetRow(5, 'deps-count', 'budget:deps', 'no dependency arrows')
  budgetRow(6, 'parallel-count', 'budget:parallel', `at most ${peakParallel(ir).count} task(s) in flight at once`)

  // 7. every span runs forward and its bar is as long as its span
  const spanProblems = []
  for (const b of geo.bars) {
    if (b.t1 < b.t0) spanProblems.push(`task "${b.task}" ends (${formatTime(b.t1, geo.unit)}) before it starts (${formatTime(b.t0, geo.unit)})`)
    else if (b.kind === 'bar' && b.width !== (b.t1 - b.t0 + 1) * geo.unitW) spanProblems.push(`task "${b.task}" bar width ${b.width} ≠ ${b.t1 - b.t0 + 1} unit(s) × ${geo.unitW}px`)
  }
  rows.push({ id: 7, name: 'spans-ordered', severity: 'fail', ok: spanProblems.length === 0, detail: spanProblems.length ? spanProblems.slice(0, 4).join('; ') : `${geo.bars.length} span(s) run forward, bar widths match their spans`, hint: spanProblems.length ? 'set every task\'s to ≥ from and derive the bar width from the span, never by hand' : undefined })

  // 8. every bar / milestone sits inside the chart range
  const rangeProblems = []
  for (const b of geo.bars) {
    if (b.kind === 'milestone') {
      if (b.cx < geo.chartLeft || b.cx > geo.chartRight) rangeProblems.push(`milestone "${b.task}" (${formatTime(b.t0, geo.unit)}) lies outside range ${ir.range.from}..${ir.range.to}`)
    } else if (b.x < geo.chartLeft || b.x + b.width > geo.chartRight) {
      rangeProblems.push(`task "${b.task}" (${formatTime(b.t0, geo.unit)}..${formatTime(b.t1, geo.unit)}) lies outside range ${ir.range.from}..${ir.range.to}`)
    }
  }
  rows.push({ id: 8, name: 'bars-in-range', severity: 'fail', ok: rangeProblems.length === 0, detail: rangeProblems.length ? rangeProblems.slice(0, 4).join('; ') : `every bar sits inside ${ir.range.from}..${ir.range.to}`, hint: rangeProblems.length ? 'widen range (or drop it so it is derived from the tasks), or trim the task to the range' : undefined })

  // 9. rows and bands never overlap, every bar stays inside its row
  const rowProblems = []
  const lanes = [...geo.bands.map((b) => ({ name: `band "${b.group}"`, y: b.y, height: b.height })), ...geo.rows.map((r) => ({ name: `row "${r.task}"`, y: r.y, height: r.height }))]
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const a = lanes[i], b = lanes[j]
      if (overlapsOpen(a.y, a.y + a.height, b.y, b.y + b.height)) rowProblems.push(`${a.name} overlaps ${b.name}`)
    }
  }
  const rowOf = new Map(geo.rows.map((r) => [r.task, r]))
  for (const b of geo.bars) {
    const r = rowOf.get(b.task)
    if (!r) { rowProblems.push(`bar "${b.task}" has no row`); continue }
    if (b.y < r.y || b.y + b.height > r.y + r.height) rowProblems.push(`bar "${b.task}" leaves its row (y ${b.y}..${b.y + b.height} vs row ${r.y}..${r.y + r.height})`)
  }
  rows.push({ id: 9, name: 'rows-clear', severity: 'fail', ok: rowProblems.length === 0, detail: rowProblems.length ? rowProblems.slice(0, 4).join('; ') : `${geo.rows.length} row(s) and ${geo.bands.length} band(s) stack without overlap, every bar inside its row`, hint: rowProblems.length ? 'stack bands and rows top → bottom from the axis and place each bar from its row, never on its own' : undefined })

  // 10. dependency arrows: known ends, orthogonal, finish → start, no bar crossed
  const barOf = new Map(geo.bars.map((b) => [b.task, b]))
  const depProblems = []
  for (const d of geo.deps) {
    const from = barOf.get(d.from), to = barOf.get(d.to)
    if (!from) depProblems.push(`deps[${d.index}].from → unknown task "${d.from}"`)
    if (!to) depProblems.push(`deps[${d.index}].to → unknown task "${d.to}"`)
    const p = d.path
    for (let i = 1; i < p.length; i++) {
      if (p[i].x !== p[i - 1].x && p[i].y !== p[i - 1].y) { depProblems.push(`deps[${d.index}] segment ${i} is diagonal`); continue }
      const hit = geo.bars.find((b) => segmentThroughRect(p[i - 1], p[i], b))
      if (hit) depProblems.push(`deps[${d.index}] (${d.from} → ${d.to}) segment ${i} crosses ${hit.kind} "${hit.task}"`)
    }
    if (from && to) {
      const start = p[0], end = p[p.length - 1]
      if (start.x !== from.x + from.width || start.y !== from.centerY) depProblems.push(`deps[${d.index}] does not start at the end of "${d.from}"`)
      const onStart = end.x === to.x && end.y === to.centerY
      const onTopOrBottom = (end.y === to.y || end.y === to.y + to.height) && end.x >= to.x && end.x <= to.x + to.width
      if (!onStart && !onTopOrBottom) depProblems.push(`deps[${d.index}] does not end on the start of "${d.to}"`)
    }
  }
  rows.push({ id: 10, name: 'deps-clear', severity: 'fail', ok: depProblems.length === 0, detail: depProblems.length ? depProblems.slice(0, 4).join('; ') : `${geo.deps.length} dependency arrow(s) run orthogonally from a bar end to the next bar start, none through a bar`, hint: depProblems.length ? 'order dependent tasks next to each other (the arrow drops straight down), or drop the dep and say it in the caption' : undefined })

  return rows
}

export const doc = {
  purpose: 'tasks on a time axis — what runs when, what overlaps, which milestone gates which step',
  whenToUse: 'when *when* and *how long* matter and the reader must see overlap between parallel tracks; not for who-calls-whom (use sequence) or a bare list of dated events (use timeline). Units: day / week / month / ordinal. Budgets: tasks ≤ 12, groups ≤ 4, label ≤ 14 chars, emphasis ≤ 1, ≤ 5 tasks in flight at once per group — guidance, over-budget figures still render with data-warn. Dependency arrows deviate from the survey (which has none): `deps` stays an opt-in but every use warns as budget:deps, and an arrow that would cross another bar fails the figure.',
  irExample: `id: migration-plan
type: gantt
title: 移行計画
caption: 準備 3 週、切替 4 週。仕様凍結の後にデータ移行を始め、検証を終えてから切り替える
unit: week
tasks:
  - id: inventory
    label: 棚卸し
    group: 準備
    from: 2026-W10
    to: 2026-W11
  - id: design
    label: 移行設計
    group: 準備
    from: 2026-W11
    to: 2026-W12
  - id: freeze
    label: 仕様凍結
    group: 準備
    from: 2026-W12
    milestone: true
  - id: migrate
    label: データ移行
    group: 切替
    from: 2026-W13
    to: 2026-W14
    emphasis: true
  - id: verify
    label: 検証
    group: 切替
    from: 2026-W14
    to: 2026-W15
  - id: cutover
    label: 切替
    group: 切替
    from: 2026-W16
    milestone: true
`,
  rows: ['task-count', 'group-count', 'label-length', 'emphasis-count', 'deps-count', 'parallel-count', 'spans-ordered', 'bars-in-range', 'rows-clear', 'deps-clear'],
}
