// `type: journey` — a user journey: the stages of one person's experience
// as columns left → right, a few content rows (行動 / 接点 / 不満 …) as a
// grid under the stage headers, and an emotion curve in a final band that
// runs across the stage centres. The curve is the figure's protagonist —
// the survey row "User journey" (体験の段階ごとの行動と感情) says to fall
// back to `process` / `timeline` when the stages cannot all carry an
// emotion, and to `diagram` when no person is involved.
//
// IR shape: `{ id, type:'journey', title, caption?, persona?, rows, stages }`.
//   - `persona` — one line naming whose journey this is (optional);
//   - `rows`    — row labels, top → bottom (≤ 3 guidance);
//   - `stages`  — `[{ id, label, emphasis?, emotion?, cells: { <row>: string | [string] } }]`,
//     left → right (≤ 6 guidance); `emotion` is one of the five named
//     levels 最悪 / 悪い / 普通 / 良い / 最高 (or worst / bad / neutral /
//     good / best) — the survey's rule is names, not numbers — normalized
//     to the internal integer -2..2 (integers are still accepted); a cell
//     is a list of short items (≤ 16 chars each, guidance).
//   - `emphasis` marks the pain point (≤ 2, guidance) and belongs on a
//     trough of the curve — an emphasized stage that is not a local
//     minimum warns (`budget:trough`). When no stage carries emphasis,
//     normalize() puts it on the trough (the lowest emotion, earliest on
//     ties) so the figure always has its one accent.
//
// Layout is a deterministic grid, no layout engine: column width from the
// widest cell line in that stage (an item wider than WRAP_W is wrapped onto
// two lines), row height from the tallest cell in the row, then the emotion
// band — five levels 16px apart so every curve point sits on the 4px grid,
// a zero line, 良い / 悪い at the band edges. The curve is a monotone cubic
// (Fritsch–Carlson tangents → cubic Béziers) through the stage centres, so
// it never overshoots a point: between two stages it stays inside the
// vertical span of their two values, which `curve-at-stage-centres` proves.
// The curve is the documented exemption from the orthogonal-routing rule
// (survey §6, ADR 0007) — nothing else here is diagonal.
//
// Import rule (references/figure-types.md): _shared.mjs and diagram.mjs
// constants only — never ir.mjs / verify-diagram.mjs / figures/index.mjs.
import { IrError, isObj, requireStr, optStr, validateBool, normalizeHeader, budgetWarning, esc } from './_shared.mjs'
import { snap4, snapUp4, textWidth, FONT_SIZE, EDGE_LABEL_SIZE } from '../diagram.mjs'

export const type = 'journey'

export const limits = { maxStages: 6, maxRows: 3, maxCellTextLen: 16, maxEmphasis: 2 }

// --- layout constants (multiples of 4 unless noted) ------------------------
const MARGIN = 16
const PERSONA_H = 24          // persona line above the header band
const HEADER_H = 32
const HEADER_GAP = 8          // header band → first row
const ROW_COL_MIN_W = 48
const ROW_COL_GAP = 12        // row label column → first stage column
const STAGE_GAP = 8           // gap between two stage columns
const COL_MIN_W = 88
const CELL_PAD_X = 8
const CELL_PAD_Y = 8
const LINE_H = 16             // 11px text line pitch
const ITEM_GAP = 4
const ROW_MIN_H = 32
const WRAP_W = 80             // an item wider than this is wrapped onto 2 lines
const BAND_GAP = 12           // last row → emotion band
const LEVEL_PITCH = 16        // one emotion step = 16px, so ±2 spans 64px
const BAND_PAD = 12           // band edge → outermost level line
const EMOTION_MIN = -2
const EMOTION_MAX = 2
/** The five named sentiment levels (survey #34: names, not numbers). */
const EMOTION_NAMES = { 最悪: -2, 悪い: -1, 普通: 0, 良い: 1, 最高: 2, worst: -2, bad: -1, neutral: 0, good: 1, best: 2 }
const EMOTION_NAME_LIST = '最悪|悪い|普通|良い|最高 (or worst|bad|neutral|good|best)'
const DOT_R = 3
const DOT_R_EMPHASIS = 5
const LABEL_GOOD = '良い'
const LABEL_BAD = '悪い'
const CURVE_SAMPLES = 24      // per segment, for the label-clearance row

// --- schema --------------------------------------------------------------

export function normalize(raw, ctx = 'ir') {
  if (!isObj(raw)) throw new IrError(`${ctx} must be a mapping`)
  const { id, title, caption } = normalizeHeader(raw, ctx)
  const persona = optStr(raw, 'persona', ctx)
  const rows = normalizeRows(raw.rows, ctx)
  const stages = withDefaultFocal(normalizeStages(raw.stages, rows, ctx))
  return { id, type, title, caption, persona, rows, stages }
}

/** Index of the trough: the lowest emotion among stages that carry one,
 * earliest on ties; -1 when no stage has an emotion. */
function troughIndex(stages) {
  let best = -1
  stages.forEach((s, i) => {
    if (s.emotion === null) return
    if (best === -1 || s.emotion < stages[best].emotion) best = i
  })
  return best
}

/** The focal default: no `emphasis` anywhere → the trough gets it. */
function withDefaultFocal(stages) {
  if (stages.some((s) => s.emphasis)) return stages
  const t = troughIndex(stages)
  if (t === -1) return stages
  return stages.map((s, i) => (i === t ? { ...s, emphasis: true } : s))
}

function normalizeRows(raw, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.rows must be a non-empty list of row labels`)
  const seen = new Set()
  return raw.map((r, i) => {
    if (typeof r !== 'string' || r.trim() === '') throw new IrError(`${ctx}.rows[${i}] must be a non-empty string`)
    if (seen.has(r)) throw new IrError(`${ctx}.rows: duplicate row "${r}"`)
    seen.add(r)
    return r
  })
}

function normalizeStages(raw, rows, ctx) {
  if (!Array.isArray(raw) || raw.length === 0) throw new IrError(`${ctx}.stages must be a non-empty list`)
  const seen = new Set()
  return raw.map((s, i) => {
    const sctx = `${ctx}.stages[${i}]`
    if (!isObj(s)) throw new IrError(`${sctx} must be a mapping`)
    const id = requireStr(s, 'id', sctx)
    if (seen.has(id)) throw new IrError(`${ctx}.stages: duplicate stage id "${id}"`)
    seen.add(id)
    const label = requireStr(s, 'label', sctx)
    const emphasis = validateBool(s, 'emphasis', sctx)
    const emotion = normalizeEmotion(s.emotion, sctx)
    const cells = normalizeCells(s.cells, rows, sctx)
    return { id, label, emphasis, emotion, cells }
  })
}

/** `emotion` is a named level (最悪 … 最高 / worst … best) or, for
 * backward compatibility, an integer -2..2; absent → `null`. Stored as the
 * integer, so the normalized stage re-normalizes unchanged. */
function normalizeEmotion(v, sctx) {
  if (v === undefined || v === null) return null
  if (typeof v === 'string' && Object.hasOwn(EMOTION_NAMES, v)) return EMOTION_NAMES[v]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < EMOTION_MIN || v > EMOTION_MAX) {
    throw new IrError(`${sctx}.emotion must be one of ${EMOTION_NAME_LIST} or an integer from ${EMOTION_MIN} to ${EMOTION_MAX} (got: ${JSON.stringify(v)})`)
  }
  return v
}

/** `{ <row>: string | [string] }` → `{ <row>: [string] }` in row order,
 * empty rows dropped. */
function normalizeCells(raw, rows, sctx) {
  if (raw === undefined || raw === null) return {}
  if (!isObj(raw)) throw new IrError(`${sctx}.cells must be a mapping of row → item(s)`)
  const rowSet = new Set(rows)
  for (const key of Object.keys(raw)) {
    if (!rowSet.has(key)) throw new IrError(`${sctx}.cells references unknown row "${key}" (declared: ${rows.join(', ')})`)
  }
  const cells = {}
  for (const row of rows) {
    if (!(row in raw)) continue
    const v = raw[row]
    const items = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
    const cctx = `${sctx}.cells[${JSON.stringify(row)}]`
    const out = items.map((item, j) => {
      if (typeof item !== 'string' || item.trim() === '') throw new IrError(`${cctx}[${j}] must be a non-empty string`)
      return item
    })
    if (out.length) cells[row] = out
  }
  return cells
}

// --- budgets -------------------------------------------------------------

const cellEntries = (ir) => ir.stages.flatMap((s) => ir.rows.filter((row) => s.cells[row]).map((row) => ({ stage: s, row, items: s.cells[row] })))

export function budgetWarnings(ir) {
  const out = []
  const n = ir.stages.length
  if (n > limits.maxStages) {
    out.push(budgetWarning('budget:stages', n, limits.maxStages,
      `${n} stage(s) (guidance ≤ ${limits.maxStages})`,
      `split the journey after stage ${limits.maxStages} ("${ir.stages[limits.maxStages - 1].label}") into a second figure, or merge neighbouring stages`))
  }
  if (ir.rows.length > limits.maxRows) {
    out.push(budgetWarning('budget:rows', ir.rows.length, limits.maxRows,
      `${ir.rows.length} row(s) (guidance ≤ ${limits.maxRows})`,
      `merge or drop rows past "${ir.rows[limits.maxRows - 1]}" — a 5th row buries the emotion curve under a table`))
  }
  const long = []
  for (const c of cellEntries(ir)) {
    c.items.forEach((item) => {
      const len = [...item].length
      if (len > limits.maxCellTextLen) long.push({ c, item, len })
    })
  }
  if (long.length) {
    const longest = long.reduce((a, b) => (b.len > a.len ? b : a))
    out.push(budgetWarning('budget:cell-text', longest.len, limits.maxCellTextLen,
      long.map((e) => `stage "${e.c.stage.id}" / ${e.c.row} "${e.item}" is ${e.len} chars (guidance ≤ ${limits.maxCellTextLen})`).join('; '),
      long.map((e) => `shorten "${e.item}" in stage "${e.c.stage.id}" (${e.len} > ${limits.maxCellTextLen})`).join('; ') + ', or move the wording into the caption'))
  }
  const emphasized = ir.stages.filter((s) => s.emphasis)
  if (emphasized.length > limits.maxEmphasis) {
    out.push(budgetWarning('budget:emphasis', emphasized.length, limits.maxEmphasis,
      `${emphasized.length} emphasized stage(s) (guidance ≤ ${limits.maxEmphasis})`,
      `keep emphasis on at most ${limits.maxEmphasis} stages — the lowest point of the curve is the natural one (${emphasized.map((s) => `"${s.id}"`).join(', ')} are all emphasized)`))
  }
  const offTrough = emphasized.filter((s) => !isTrough(ir.stages, s))
  if (offTrough.length) {
    out.push(budgetWarning('budget:trough', offTrough.length, 0,
      offTrough.map((s) => `stage "${s.id}" is emphasized but ${s.emotion === null ? 'has no emotion' : 'is not a low point of the curve'}`).join('; '),
      `move the emphasis to a trough — a pain point is where the curve dips (${offTrough.map((s) => `"${s.id}"`).join(', ')})`))
  }
  return out
}

/** A stage is a trough when it carries an emotion no higher than its
 * neighbours' (the nearest stages with an emotion on either side). */
function isTrough(stages, stage) {
  if (stage.emotion === null) return false
  const withEmotion = stages.filter((s) => s.emotion !== null)
  const i = withEmotion.indexOf(stage)
  const prev = withEmotion[i - 1], next = withEmotion[i + 1]
  return (!prev || prev.emotion >= stage.emotion) && (!next || next.emotion >= stage.emotion)
}

// --- text wrapping ---------------------------------------------------------

/** Split `text` onto at most two lines when wider than `maxW` at `fontSize`
 * (balanced cut, a space wins within SPACE_SLACK, no line starts with a
 * character Japanese typesetting keeps on the previous line). */
const NO_LINE_START = /^[ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ、。，．,.)）」』】〕〉》!?！？:：;；]/
const SPACE_SLACK = 12
function wrapTwo(text, maxW, fontSize) {
  if (textWidth(text, fontSize) <= maxW) return [text]
  const chars = [...text]
  if (chars.length < 2) return [text]
  let best = null
  let bestSpace = null
  for (let i = 1; i < chars.length; i++) {
    const atSpace = chars[i] === ' ' || chars[i - 1] === ' '
    const head = chars.slice(0, i).join('').trimEnd()
    const tail = chars.slice(i).join('').trimStart()
    if (!head || !tail || NO_LINE_START.test(tail)) continue
    const cost = Math.max(textWidth(head, fontSize), textWidth(tail, fontSize))
    if (!best || cost < best.cost) best = { cost, head, tail }
    if (atSpace && (!bestSpace || cost < bestSpace.cost)) bestSpace = { cost, head, tail }
  }
  const pick = bestSpace && bestSpace.cost <= best.cost + SPACE_SLACK ? bestSpace : best
  return pick ? [pick.head, pick.tail] : [text]
}

// --- monotone cubic ----------------------------------------------------------

/** Fritsch–Carlson tangents for points sorted by x: the interpolant is
 * monotone on every interval, so it never overshoots a data point. */
function monotoneTangents(pts) {
  const n = pts.length
  if (n < 2) return pts.map(() => 0)
  const d = []
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x))
  const m = new Array(n).fill(0)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i] }
  }
  return m
}

/** Cubic Bézier segments (`c1`/`c2` control points in 0.1px, `from`/`to`
 * are the point indices) from the Hermite form. */
function bezierSegments(pts) {
  const m = monotoneTangents(pts)
  const segs = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1]
    const h = (q.x - p.x) / 3
    segs.push({
      from: i, to: i + 1,
      c1: { px: round1(p.x + h), py: round1(p.y + m[i] * h) },
      c2: { px: round1(q.x - h), py: round1(q.y - m[i + 1] * h) },
    })
  }
  return segs
}

const round1 = (v) => Math.round(v * 10) / 10

/** Point on the cubic at parameter t. */
function bezierAt(p, s, q, t) {
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return { x: a * p.x + b * s.c1.px + c * s.c2.px + d * q.x, y: a * p.y + b * s.c1.py + c * s.c2.py + d * q.y }
}

/** Samples along every segment, for the geometry rows. */
function sampleCurve(points, segments) {
  const out = []
  for (const s of segments) {
    const p = points[s.from], q = points[s.to]
    for (let k = 0; k <= CURVE_SAMPLES; k++) out.push({ seg: s.from, ...bezierAt(p, s, q, k / CURVE_SAMPLES) })
  }
  return out
}

// --- layout --------------------------------------------------------------

export async function layout(ir) {
  const { rows: rowLabels, stages } = ir
  const nStages = stages.length

  // 1. wrap every item, measure the widest line per stage
  const wrapped = stages.map((s) => {
    const cells = {}
    for (const row of rowLabels) {
      if (!s.cells[row]) continue
      cells[row] = s.cells[row].map((item) => wrapTwo(item, WRAP_W, EDGE_LABEL_SIZE))
    }
    return cells
  })
  const colWidths = stages.map((s, i) => {
    let widest = textWidth(s.label, FONT_SIZE) * (s.emphasis ? 1.08 : 1) + 8
    for (const lines of Object.values(wrapped[i])) {
      for (const item of lines) for (const line of item) widest = Math.max(widest, textWidth(line, EDGE_LABEL_SIZE))
    }
    return snapUp4(Math.max(COL_MIN_W, Math.ceil(widest) + CELL_PAD_X * 2))
  })

  // 2. row heights from the tallest cell in each row
  const rowHeights = rowLabels.map((row) => {
    let tallest = ROW_MIN_H
    wrapped.forEach((cells) => {
      const items = cells[row]
      if (!items) return
      const lines = items.reduce((n, it) => n + it.length, 0)
      tallest = Math.max(tallest, lines * LINE_H + (items.length - 1) * ITEM_GAP + CELL_PAD_Y * 2)
    })
    return snapUp4(tallest)
  })

  // 3. columns
  const sideLabels = [...rowLabels, LABEL_GOOD, LABEL_BAD]
  const rowColW = snapUp4(Math.max(ROW_COL_MIN_W, Math.ceil(Math.max(...sideLabels.map((s) => textWidth(s, EDGE_LABEL_SIZE)))) + 8))
  const gridLeft = MARGIN + rowColW + ROW_COL_GAP
  const headerY = MARGIN + (ir.persona ? PERSONA_H : 0)
  const stageGeo = []
  let x = gridLeft
  stages.forEach((s, i) => {
    const width = colWidths[i]
    stageGeo.push({ id: s.id, label: s.label, emphasis: s.emphasis, emotion: s.emotion, index: i, x, width, centerX: snap4(x + width / 2), header: { x, y: headerY, width, height: HEADER_H } })
    x += width + (i < nStages - 1 ? STAGE_GAP : 0)
  })
  const gridRight = x

  // 4. rows + cells
  const rows = []
  let y = headerY + HEADER_H + HEADER_GAP
  rowLabels.forEach((row, r) => {
    const height = rowHeights[r]
    rows.push({ row, index: r, y, height, centerY: snap4(y + height / 2) })
    y += height
  })
  const gridBottom = y
  const cells = []
  stages.forEach((s, i) => {
    rows.forEach((row) => {
      const items = wrapped[i][row.row]
      if (!items) return
      const col = stageGeo[i]
      const lines = []
      const contentH = items.reduce((n, it) => n + it.length, 0) * LINE_H + (items.length - 1) * ITEM_GAP
      let ly = row.y + CELL_PAD_Y + snap4((row.height - CELL_PAD_Y * 2 - contentH) / 2)
      items.forEach((itemLines, j) => {
        itemLines.forEach((text) => {
          lines.push({ text, item: j, x: col.x + CELL_PAD_X, y: ly + 12, width: Math.ceil(textWidth(text, EDGE_LABEL_SIZE)) })
          ly += LINE_H
        })
        ly += ITEM_GAP
      })
      cells.push({ stage: s.id, row: row.row, x: col.x, y: row.y, width: col.width, height: row.height, items: s.cells[row.row], lines })
    })
  })
  const rowLabelX = MARGIN + rowColW
  const rowLabelGeo = rows.map((row) => ({ row: row.row, x: rowLabelX, y: row.centerY + 4, width: Math.ceil(textWidth(row.row, EDGE_LABEL_SIZE)) }))

  // 5. emotion band — present when at least one stage carries an emotion
  const withEmotion = stageGeo.filter((s) => s.emotion !== null)
  let band = null
  let bottom = gridBottom
  if (withEmotion.length) {
    const top = gridBottom + BAND_GAP
    const zeroY = top + BAND_PAD + EMOTION_MAX * LEVEL_PITCH
    const height = BAND_PAD * 2 + (EMOTION_MAX - EMOTION_MIN) * LEVEL_PITCH
    const levels = []
    for (let v = EMOTION_MAX; v >= EMOTION_MIN; v--) levels.push({ value: v, y: zeroY - v * LEVEL_PITCH })
    const points = withEmotion.map((s) => ({ stage: s.id, emotion: s.emotion, emphasis: s.emphasis, x: s.centerX, y: zeroY - s.emotion * LEVEL_PITCH }))
    const segments = bezierSegments(points)
    const edgeLabels = [
      { text: LABEL_GOOD, x: rowLabelX, y: top + BAND_PAD + 4, width: Math.ceil(textWidth(LABEL_GOOD, EDGE_LABEL_SIZE)) },
      { text: LABEL_BAD, x: rowLabelX, y: top + height - BAND_PAD + 4, width: Math.ceil(textWidth(LABEL_BAD, EDGE_LABEL_SIZE)) },
    ]
    band = { x: gridLeft, y: top, width: gridRight - gridLeft, height, zeroY, levelPitch: LEVEL_PITCH, levels, points, segments, edgeLabels }
    bottom = top + height
  }

  const persona = ir.persona ? { text: ir.persona, x: MARGIN, y: MARGIN + 12, width: Math.ceil(textWidth(ir.persona, EDGE_LABEL_SIZE)) } : null
  const height = snapUp4(bottom + MARGIN)
  const width = snapUp4(gridRight + MARGIN)

  return {
    width,
    height,
    geo: { persona, header: { y: headerY, height: HEADER_H }, rowColumn: { x: MARGIN, width: rowColW }, stages: stageGeo, rows, cells, rowLabels: rowLabelGeo, band, gridLeft, gridRight, gridBottom },
  }
}

// --- drawing -------------------------------------------------------------

function curvePath(band) {
  const { points, segments } = band
  if (!points.length) return ''
  let d = `M${points[0].x} ${points[0].y}`
  for (const s of segments) {
    const q = points[s.to]
    d += ` C${s.c1.px} ${s.c1.py} ${s.c2.px} ${s.c2.py} ${q.x} ${q.y}`
  }
  return d
}

export function draw(layoutResult, ir) {
  const { geo } = layoutResult
  const uid = `wu-d-${ir.id}`
  const parts = []

  if (geo.persona) {
    parts.push(`<text id="${uid}-persona" x="${geo.persona.x}" y="${geo.persona.y}" font-size="${EDGE_LABEL_SIZE}" fill="var(--wu-ink-3)">${esc(geo.persona.text)}</text>`)
  }

  // row rules across the grid (under everything)
  geo.rows.forEach((row, r) => {
    if (r === 0) return
    parts.push(`<line id="${uid}-rule-${r}" x1="${geo.rowColumn.x}" y1="${row.y}" x2="${geo.gridRight}" y2="${row.y}" stroke="var(--wu-rule-soft)" stroke-width="1"/>`)
  })

  // row labels
  for (const l of geo.rowLabels) {
    parts.push(`<text id="${uid}-row-${slugify(l.row)}" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="end" fill="var(--wu-ink-2)">${esc(l.row)}</text>`)
  }

  // stage headers
  for (const s of geo.stages) {
    const h = s.header
    const cls = s.emphasis ? ' class="wu-focal"' : ''
    const sw = s.emphasis ? 1.5 : 1
    const weight = s.emphasis ? ' font-weight="700"' : ''
    parts.push(`<rect id="${uid}-stage-${s.id}" data-tone="neutral"${cls} x="${h.x}" y="${h.y}" width="${h.width}" height="${h.height}" rx="4" fill="none" stroke="currentColor" stroke-width="${sw}"/>`)
    parts.push(`<text id="${uid}-stage-${s.id}-label" x="${s.centerX}" y="${h.y + h.height / 2 + 4}" font-size="${FONT_SIZE}"${weight} text-anchor="middle" fill="currentColor">${esc(s.label)}</text>`)
  }

  // cells
  geo.cells.forEach((c, i) => {
    parts.push(`<rect id="${uid}-cell-${i}" x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="var(--wu-surface)" stroke="var(--wu-rule)" stroke-width="1"/>`)
    c.lines.forEach((l, j) => {
      parts.push(`<text id="${uid}-cell-${i}-l${j}" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">${esc(l.text)}</text>`)
    })
  })

  // emotion band: frame, level lines (zero line stronger), edge labels,
  // stage guides, then the curve and its points on top
  const b = geo.band
  if (b) {
    parts.push(`<rect id="${uid}-band" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="var(--wu-rule-soft)" stroke="none"/>`)
    parts.push(`<g id="${uid}-levels" stroke-width="1">`)
    for (const l of b.levels) {
      const strong = l.value === 0
      parts.push(`<line x1="${b.x}" y1="${l.y}" x2="${b.x + b.width}" y2="${l.y}" stroke="${strong ? 'var(--wu-ink-3)' : 'var(--wu-rule)'}"${strong ? '' : ' stroke-dasharray="2 4"'}/>`)
    }
    parts.push('</g>')
    b.edgeLabels.forEach((l, i) => {
      parts.push(`<text id="${uid}-band-edge-${i}" x="${l.x}" y="${l.y}" font-size="${EDGE_LABEL_SIZE}" text-anchor="end" fill="var(--wu-ink-3)">${esc(l.text)}</text>`)
    })
    parts.push(`<path id="${uid}-curve" d="${curvePath(b)}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`)
    parts.push(`<g id="${uid}-points">`)
    b.points.forEach((p) => {
      if (p.emphasis) {
        parts.push(`<circle id="${uid}-point-${p.stage}" cx="${p.x}" cy="${p.y}" r="${DOT_R_EMPHASIS}" fill="var(--wu-surface)" stroke="var(--wu-accent)" stroke-width="1.5" data-value="${p.emotion}"/>`)
      } else {
        parts.push(`<circle id="${uid}-point-${p.stage}" cx="${p.x}" cy="${p.y}" r="${DOT_R}" fill="currentColor" data-value="${p.emotion}"/>`)
      }
    })
    parts.push('</g>')
  }

  return parts.join('')
}

/** An id-safe suffix for a row label (CJK kept, everything else that is
 * not [\p{L}\p{N}_-] replaced). */
function slugify(s) {
  return String(s).replace(/[^\p{L}\p{N}_-]/gu, '-')
}

// --- verify --------------------------------------------------------------

const overlapsOpen = (a1, a2, b1, b2) => Math.max(a1, b1) < Math.min(a2, b2)

/** Every text box on the canvas as `{ what, left, top, right, bottom }`
 * (ascent ≈ 0.8em above the baseline, descent ≈ 0.25em below). */
function labelBoxes(geo) {
  const boxes = []
  const box = (what, x, y, width, size, anchor = 'start') => {
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x
    boxes.push({ what, left, top: y - size * 0.8, right: left + width, bottom: y + size * 0.25 })
  }
  if (geo.persona) box('persona', geo.persona.x, geo.persona.y, geo.persona.width, EDGE_LABEL_SIZE)
  for (const l of geo.rowLabels) box(`row label "${l.row}"`, l.x, l.y, l.width, EDGE_LABEL_SIZE, 'end')
  for (const s of geo.stages) box(`stage label "${s.label}"`, s.centerX, s.header.y + s.header.height / 2 + 4, Math.ceil(textWidth(s.label, FONT_SIZE) * (s.emphasis ? 1.08 : 1)), FONT_SIZE, 'middle')
  geo.cells.forEach((c, i) => c.lines.forEach((l, j) => box(`cells[${i}] line ${j} "${l.text}"`, l.x, l.y, l.width, EDGE_LABEL_SIZE)))
  if (geo.band) for (const l of geo.band.edgeLabels) box(`band label "${l.text}"`, l.x, l.y, l.width, EDGE_LABEL_SIZE, 'end')
  return boxes
}

export function verify(layoutResult, ir) {
  const geo = layoutResult.geo
  const rows = []
  const budget = budgetWarnings(ir)
  const budgetRow = (id, name, key, okDetail) => {
    const w = budget.find((b) => b.key === key)
    rows.push({ id, name, severity: 'warn', ok: !w, detail: w ? w.detail : okDetail, hint: w?.hint, key: w?.key, value: w?.value })
  }
  budgetRow(1, 'stage-count', 'budget:stages', `${ir.stages.length} stage(s)`)
  budgetRow(2, 'row-count', 'budget:rows', `${ir.rows.length} row(s)`)
  budgetRow(3, 'cell-text-length', 'budget:cell-text', `every cell item is ≤ ${limits.maxCellTextLen} chars`)
  budgetRow(4, 'emphasis-count', 'budget:emphasis', `${ir.stages.filter((s) => s.emphasis).length} emphasized stage(s)`)
  budgetRow(5, 'emphasis-at-trough', 'budget:trough', 'every emphasized stage sits on a low point of the curve')

  // 6. references: every cell sits in a declared stage and row, every
  //    curve point belongs to a declared stage that carries an emotion
  const stageOf = new Map(geo.stages.map((s) => [s.id, s]))
  const rowOf = new Map(geo.rows.map((r) => [r.row, r]))
  const badRefs = []
  geo.cells.forEach((c, i) => {
    if (!stageOf.has(c.stage)) badRefs.push(`cells[${i}] → unknown stage "${c.stage}"`)
    if (!rowOf.has(c.row)) badRefs.push(`cells[${i}] → unknown row "${c.row}"`)
  })
  const points = geo.band ? geo.band.points : []
  points.forEach((p, i) => {
    const s = stageOf.get(p.stage)
    if (!s) badRefs.push(`band.points[${i}] → unknown stage "${p.stage}"`)
    else if (s.emotion === null || s.emotion === undefined) badRefs.push(`band.points[${i}] → stage "${p.stage}" has no emotion`)
  })
  rows.push({ id: 6, name: 'references-exist', severity: 'fail', ok: badRefs.length === 0, detail: badRefs.length ? badRefs.join('; ') : 'every cell and curve point references a declared stage/row', hint: badRefs.length ? 'declare the stage/row before referencing it' : undefined })

  // 7. grid: every cell matches its column × row, no two cells overlap,
  //    every text line sits inside its cell with padding
  const gridProblems = []
  geo.cells.forEach((c, i) => {
    const s = stageOf.get(c.stage), r = rowOf.get(c.row)
    if (s && (c.x !== s.x || c.width !== s.width)) gridProblems.push(`cells[${i}] (${c.stage}/${c.row}) x/width ${c.x}/${c.width} ≠ column ${s.x}/${s.width}`)
    if (r && (c.y !== r.y || c.height !== r.height)) gridProblems.push(`cells[${i}] (${c.stage}/${c.row}) y/height ${c.y}/${c.height} ≠ row ${r.y}/${r.height}`)
    c.lines.forEach((l, j) => {
      const w = Math.ceil(textWidth(l.text, EDGE_LABEL_SIZE))
      const top = l.y - 12
      if (l.x < c.x + CELL_PAD_X || l.x + w > c.x + c.width - CELL_PAD_X + 1) gridProblems.push(`cells[${i}] line ${j} "${l.text}" overflows horizontally`)
      if (top < c.y + CELL_PAD_Y || l.y > c.y + c.height - CELL_PAD_Y + 4) gridProblems.push(`cells[${i}] line ${j} "${l.text}" overflows vertically`)
    })
  })
  for (let i = 0; i < geo.cells.length; i++) {
    for (let j = i + 1; j < geo.cells.length; j++) {
      const a = geo.cells[i], b = geo.cells[j]
      if (overlapsOpen(a.x, a.x + a.width, b.x, b.x + b.width) && overlapsOpen(a.y, a.y + a.height, b.y, b.y + b.height)) {
        gridProblems.push(`cells[${i}] (${a.stage}/${a.row}) overlaps cells[${j}] (${b.stage}/${b.row})`)
      }
    }
  }
  rows.push({ id: 7, name: 'cells-inside-grid', severity: 'fail', ok: gridProblems.length === 0, detail: gridProblems.length ? gridProblems.slice(0, 4).join('; ') : `${geo.cells.length} cell(s) aligned to ${geo.stages.length} column(s) × ${geo.rows.length} row(s), text inside with ${CELL_PAD_X}/${CELL_PAD_Y}px padding`, hint: gridProblems.length ? 'derive every cell rect from its stage column and row, and size the column from the widest wrapped line' : undefined })

  // 8. curve: every point at its stage centre, at the y its emotion maps to,
  //    inside the band; points strictly left → right; the interpolant stays
  //    within the band and between neighbouring values (no overshoot)
  const curveProblems = []
  const b = geo.band
  if (b) {
    const top = b.y, bottom = b.y + b.height
    points.forEach((p, i) => {
      const s = stageOf.get(p.stage)
      if (s && p.x !== s.centerX) curveProblems.push(`points[${i}] ("${p.stage}") x=${p.x} is not the stage centre ${s.centerX}`)
      const expected = b.zeroY - p.emotion * b.levelPitch
      if (p.y !== expected) curveProblems.push(`points[${i}] ("${p.stage}") y=${p.y} ≠ ${expected} for emotion ${p.emotion}`)
      if (p.y < top || p.y > bottom) curveProblems.push(`points[${i}] ("${p.stage}") y=${p.y} is outside the band ${top}..${bottom}`)
      if (i > 0 && p.x <= points[i - 1].x) curveProblems.push(`points[${i}] ("${p.stage}") does not sit right of points[${i - 1}]`)
    })
    if (b.segments.length !== Math.max(0, points.length - 1)) curveProblems.push(`${b.segments.length} segment(s) for ${points.length} point(s)`)
    if (!curveProblems.length) {
      for (const sm of sampleCurve(points, b.segments)) {
        const p = points[sm.seg], q = points[sm.seg + 1]
        const lo = Math.min(p.y, q.y) - 0.5, hi = Math.max(p.y, q.y) + 0.5
        if (sm.y < lo || sm.y > hi) { curveProblems.push(`segment ${sm.seg} overshoots the span ${lo + 0.5}..${hi - 0.5} at x=${sm.x.toFixed(1)} (y=${sm.y.toFixed(1)})`); break }
        if (sm.y < top || sm.y > bottom) { curveProblems.push(`segment ${sm.seg} leaves the band at x=${sm.x.toFixed(1)}`); break }
      }
    }
  }
  rows.push({ id: 8, name: 'curve-at-stage-centres', severity: 'fail', ok: curveProblems.length === 0, detail: curveProblems.length ? curveProblems.slice(0, 4).join('; ') : b ? `${points.length} point(s) at their stage centres, ${b.segments.length} monotone segment(s) inside the band` : 'no emotion given — no band drawn', hint: curveProblems.length ? 'place every point at (stage.centerX, zeroY − emotion × pitch) and build the curve with monotone tangents' : undefined })

  // 9. no label crosses the curve
  const crossProblems = []
  if (b && points.length) {
    const samples = sampleCurve(points, b.segments)
    for (const box of labelBoxes(geo)) {
      const hit = samples.find((sm) => sm.x > box.left && sm.x < box.right && sm.y > box.top && sm.y < box.bottom)
      if (hit) crossProblems.push(`${box.what} crosses the curve near x=${hit.x.toFixed(0)}`)
    }
  }
  rows.push({ id: 9, name: 'labels-clear-of-curve', severity: 'fail', ok: crossProblems.length === 0, detail: crossProblems.length ? crossProblems.slice(0, 4).join('; ') : b ? `no label box touches the curve (${labelBoxes(geo).length} label(s) checked)` : 'no curve drawn', hint: crossProblems.length ? 'keep the band free of text — labels belong in the row column or above the grid' : undefined })

  return rows
}

export const doc = {
  purpose: 'a user journey — one person\'s stages left → right, what they do / touch / suffer in each, and an emotion curve across the stages',
  whenToUse: 'when the reader must see *how the experience feels* at each step, not just what happens; give every stage an emotion named 最悪 / 悪い / 普通 / 良い / 最高 or use process / timeline instead, and use diagram when no person is involved. Budgets: stages ≤ 6, rows ≤ 3, cell item ≤ 16 chars, emphasis ≤ 2 and only on a trough of the curve (with no emphasis given, the lowest point gets it) — guidance, over-budget figures still render with data-warn. The curve is the one documented exemption from the orthogonal-routing rule.',
  irExample: `id: onboarding-journey
type: journey
title: 初回利用の体験
caption: 招待から定着までの 5 段階。設定でつまずき、初回成功で持ち直す
persona: 新しく参加したメンバー
rows: [行動, 接点, 不満]
stages:
  - id: invite
    label: 招待
    emotion: 良い
    cells:
      行動: 招待メールを開く
      接点: メール
  - id: signup
    label: 登録
    emotion: 普通
    cells:
      行動: [アカウント作成, 認証]
      接点: 登録画面
      不満: 入力項目が多い
  - id: setup
    label: 初期設定
    emphasis: true
    emotion: 最悪
    cells:
      行動: 連携先を選ぶ
      接点: 設定画面
      不満: [用語が分からない, 手順が長い]
  - id: first-use
    label: 初回利用
    emotion: 良い
    cells:
      行動: 最初の画面を作る
      接点: エディタ
  - id: habit
    label: 定着
    emotion: 最高
    cells:
      行動: 毎朝開く
      接点: 通知
`,
  rows: ['stage-count', 'row-count', 'cell-text-length', 'emphasis-count', 'emphasis-at-trough', 'references-exist', 'cells-inside-grid', 'curve-at-stage-centres', 'labels-clear-of-curve'],
}
