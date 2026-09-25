// The kernel every figure type shares — deliberately a leaf module (it only
// imports diagram.mjs's constants) so a plugin can import it without ever
// pulling ir.mjs or figures/index.mjs into its own import graph. That
// matters: index.mjs discovers plugins with a top-level `await import()`,
// and ir.mjs imports index.mjs, so a plugin that (transitively) imported
// ir.mjs would wait on a module that is itself waiting on the plugin — a
// deadlock, not an error. Files prefixed `_` in this folder are helpers
// like this one (or the `.txt` template) and are never loaded as plugins.
//
// Four things live here:
//   1. IrError + the schema helpers (requireStr/optStr/validateTone/…)
//      ir.mjs and every plugin's normalize() validate with;
//   2. the SVG wrapper (wrapFigureSvg) and the column fit decision
//      (fitToColumn) the dispatcher applies to every plugin's layout;
//   3. an optional legend row a plugin can ask the wrapper to draw;
//   4. the shared verify rows (svg hygiene / a11y / font / stroke / color /
//      4px positions / projected scale) the dispatcher appends after the
//      plugin's own rows.
import { COLUMN, MIN_SCALE, EDGE_LABEL_SIZE, textWidth } from '../diagram.mjs'

// --- 1. schema ---------------------------------------------------------

export class IrError extends Error {
  constructor(message) {
    super(message)
    this.name = 'IrError'
  }
}

export const TONES = new Set(['ts', 'rs', 'new', 'neutral'])
export const KINDS = new Set(['sync', 'async', 'reply'])

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function requireStr(obj, field, ctx) {
  const v = obj[field]
  if (typeof v !== 'string' || v.trim() === '') {
    throw new IrError(`${ctx}.${field} is required and must be a non-empty string`)
  }
  return v
}

export function optStr(obj, field, ctx) {
  const v = obj[field]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new IrError(`${ctx}.${field} must be a string (got: ${JSON.stringify(v)})`)
  return v
}

export function validateTone(tone, ctx) {
  if (tone === undefined || tone === null) return 'neutral'
  if (typeof tone !== 'string' || !TONES.has(tone)) {
    throw new IrError(`${ctx}.tone must be ts|rs|new|neutral (got: ${JSON.stringify(tone)})`)
  }
  return tone
}

export function validateBool(obj, field, ctx) {
  const v = obj[field]
  if (v === undefined || v === null) return false
  if (typeof v !== 'boolean') throw new IrError(`${ctx}.${field} must be a boolean`)
  return v
}

/** `{ id, title, caption }` — the three fields every IR shape carries. */
export function normalizeHeader(raw, ctx) {
  return { id: requireStr(raw, 'id', ctx), title: requireStr(raw, 'title', ctx), caption: optStr(raw, 'caption', ctx) }
}

/** A budget warning record in the shape validateIR()/verify rows/`data-warn`
 * all read (see ir.mjs's formatBudgetWarnings()). */
export function budgetWarning(key, value, limit, detail, hint) {
  return { key, value, limit, detail, hint }
}

// --- 2. svg wrapper + column fit -----------------------------------------

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * The scale/scroll decision every figure kind shares (diagram.mjs's
 * renderDiagram() makes the same one): shrink to `column` as long as the
 * scale stays ≥ MIN_SCALE, otherwise show at native size and let the
 * <figure> scroll sideways.
 */
export function fitToColumn(width, height, column = COLUMN) {
  let scaled = false
  let scroll = false
  let displayWidth = width
  let displayHeight = height
  if (width > column) {
    const scale = column / width
    if (scale >= MIN_SCALE) { scaled = true; displayWidth = column; displayHeight = Math.round(height * scale) }
    else scroll = true
  }
  return { scaled, scroll, displayWidth, displayHeight }
}

/**
 * The one <svg> root every plugin figure gets: role="img", aria-labelledby
 * pointing at a <title> (first child — the a11y row checks this) and a
 * <desc> (caption, falling back to the title), display width/height from
 * fitToColumn(), the native size as viewBox. `inner` is the plugin's
 * draw() output; `legend` (optional, see drawLegend) is appended after it.
 */
export function wrapFigureSvg(ir, { width, height, legend }, inner, { displayWidth, displayHeight }) {
  const uid = `wu-d-${ir.id}`
  const open = `<svg role="img" aria-labelledby="${uid}-title ${uid}-desc" width="${displayWidth}" height="${displayHeight}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  const head = `<title id="${uid}-title">${esc(ir.title)}</title><desc id="${uid}-desc">${esc(ir.caption || ir.title)}</desc>`
  const legendSvg = legend ? drawLegend(uid, legend) : ''
  return `${open}${head}${inner}${legendSvg}</svg>`
}

// --- 3. legend -----------------------------------------------------------
//
// Same metrics as diagram.mjs's legend row (12px side padding, 30px
// swatch, 8px to the label, 22px between items, 11px text) so a plugin
// legend is indistinguishable from a node/edge diagram's. Each item's
// `marker` names a marker id suffix the plugin's own <defs> must define
// (`wu-d-<id>-<marker>`), so the swatch arrowhead matches the figure's.

const LEGEND_PAD = 12
const LEGEND_SWATCH = 30
const LEGEND_SWATCH_GAP = 8
const LEGEND_ITEM_GAP = 22
export const LEGEND_HEIGHT = 20

function legendItems(items) {
  let x = LEGEND_PAD
  return items.map((item) => {
    const labelWidth = Math.ceil(textWidth(item.label, EDGE_LABEL_SIZE))
    const swatchX = x
    const textX = swatchX + LEGEND_SWATCH + LEGEND_SWATCH_GAP
    x = textX + labelWidth + LEGEND_ITEM_GAP
    return { ...item, swatchX, textX, labelWidth, end: textX + labelWidth }
  })
}

/** Canvas width a legend of `items` ([{label, dash?, marker?}]) needs. */
export function legendWidth(items) {
  if (!items.length) return 0
  const laid = legendItems(items)
  return laid[laid.length - 1].end + LEGEND_PAD
}

/** `legend`: `{ y, items: [{ label, dash?: '5 4', marker?: 'solid'|'open'|… }] }`. */
export function drawLegend(uid, legend) {
  const { y, items } = legend
  const out = [`<g id="${uid}-legend" font-size="${EDGE_LABEL_SIZE}" fill="currentColor">`]
  for (const item of legendItems(items)) {
    const dash = item.dash ? ` stroke-dasharray="${item.dash}"` : ''
    const marker = item.marker ? ` marker-end="url(#${uid}-${item.marker})"` : ''
    out.push(`<path d="M${item.swatchX} ${y + 8} L${item.swatchX + LEGEND_SWATCH} ${y + 8}" fill="none" stroke="currentColor" stroke-width="1"${dash}${marker}/>`)
    out.push(`<text x="${item.textX}" y="${y + 12}">${esc(item.label)}</text>`)
  }
  out.push('</g>')
  return out.join('')
}

// --- 4. shared verify rows -----------------------------------------------
//
// Every check takes the same ctx the dispatcher builds — `{ ir, svg,
// renderResult, geo, column }` — and returns `{ ok, detail, hint? }`. They
// are the rows the writeup contract applies to *any* figure regardless of
// its type: what the svg text must look like (§4-2 rows 14, 17–20), that
// positions sit on the 4px grid (row 12, positions only — sizes are the
// plugin's call, since text-fitted boxes may legitimately be unsnapped),
// and the projected-scale floor (row 9).

const ALLOWED_FONT_SIZES = new Set([13, 11])
const ALLOWED_STROKE_WIDTHS = new Set([1, 1.5])
const ALLOWED_RX = new Set([4, 6, 8])
const GRID = 4
const POSITION_KEYS = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'yTop', 'yBottom', 'centerX', 'centerY'])

export function checkSingleFiniteSvg(ctx) {
  const svgOpenCount = (ctx.svg.match(/<svg[\s>]/g) || []).length
  const hasBadValue = /\b(NaN|Infinity|undefined)\b/.test(ctx.svg)
  const ok = svgOpenCount === 1 && !hasBadValue
  const problems = []
  if (svgOpenCount !== 1) problems.push(`found ${svgOpenCount} <svg> elements, expected 1`)
  if (hasBadValue) problems.push('markup contains NaN/Infinity/undefined')
  return {
    ok,
    detail: ok ? 'exactly one <svg>, no non-finite values in the markup' : problems.join('; '),
    hint: ok ? undefined : svgOpenCount !== 1
      ? 'emit exactly one <svg> root per figure'
      : 'a computed geometry value was NaN/Infinity/undefined — check for a missing box lookup upstream',
  }
}

export function checkA11y(ctx) {
  const svg = ctx.svg
  const idPrefix = `wu-d-${ctx.ir.id}-`
  const problems = []
  if (!/^<svg\b[^>]*\brole="img"/.test(svg)) problems.push('svg root missing role="img"')
  const firstTag = /<svg[^>]*>(<[a-zA-Z]+)/.exec(svg)
  if (!firstTag || firstTag[1] !== '<title') problems.push('first child of <svg> is not <title>')
  const desc = /<desc[^>]*>([^<]*)<\/desc>/.exec(svg)
  if (!desc || !desc[1].trim()) problems.push('<desc> missing or empty')
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
  const badIds = ids.filter((id) => !id.startsWith(idPrefix))
  if (badIds.length) problems.push(`id(s) not prefixed "${idPrefix}": ${badIds.slice(0, 4).join(', ')}`)
  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join('; ') : 'role="img", <title> first child, non-empty <desc>, ids all prefixed correctly',
    hint: problems.length ? `fix svg generation: ${problems.join('; ')}` : undefined,
  }
}

export function checkFontSizes(ctx) {
  const sizes = [...ctx.svg.matchAll(/font-size="([^"]+)"/g)].map((m) => parseFloat(m[1]))
  const bad = [...new Set(sizes.filter((s) => !ALLOWED_FONT_SIZES.has(s)))]
  return {
    ok: bad.length === 0,
    detail: bad.length ? `font-size(s) outside {13,11}: ${bad.join(', ')}` : 'every font-size is 13 or 11',
    hint: bad.length ? 'draw text with FONT_SIZE (13) or EDGE_LABEL_SIZE/SUBLABEL_SIZE (11), not an ad-hoc size' : undefined,
  }
}

export function checkStrokeAndRadius(ctx) {
  const strokeWidths = [...ctx.svg.matchAll(/stroke-width="([^"]+)"/g)].map((m) => parseFloat(m[1]))
  const badSw = [...new Set(strokeWidths.filter((w) => !ALLOWED_STROKE_WIDTHS.has(w)))]
  const rxs = [...ctx.svg.matchAll(/\brx="([^"]+)"/g)].map((m) => parseFloat(m[1]))
  const badRx = [...new Set(rxs.filter((r) => !ALLOWED_RX.has(r)))]
  const problems = []
  if (badSw.length) problems.push(`stroke-width outside {1,1.5}: ${badSw.join(', ')}`)
  if (badRx.length) problems.push(`rx outside {4,6,8}: ${badRx.join(', ')}`)
  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join('; ') : 'stroke widths and corner radii stay within the kit scale',
    hint: problems.length ? `${problems.join('; ')} — use the kit's border-width (1/1.5) and radius (4/6/8) scale` : undefined,
  }
}

export function checkNoHexColors(ctx) {
  const svg = ctx.svg
  const withoutRefs = svg.replace(/url\(#[^)]*\)/g, '').replace(/#wu-d-[^"'\s)]*/g, '')
  const hasHex = /#[0-9a-fA-F]{3,8}\b/.test(withoutRefs)
  const hasRgb = /\brgb\(/i.test(svg)
  const ok = !hasHex && !hasRgb
  const found = [hasHex && 'a hex color', hasRgb && 'rgb()'].filter(Boolean).join(' and ')
  return {
    ok,
    detail: ok ? 'no hex color or rgb() in the svg — every color routes through currentColor/var(--wu-*)' : `found ${found} in the svg`,
    hint: ok ? undefined : 'replace the literal color with currentColor or a var(--wu-*) token so all 3 themes stay in sync',
  }
}

/** Walks the plugin's geometry and checks every position-like number
 * (x/y/x1/y1/x2/y2/cx/cy/yTop/yBottom/centerX/centerY) sits on the 4px
 * grid. Sizes are not checked here: a box fitted to text may carry an
 * unsnapped width, and whether that is acceptable is the plugin's rule. */
export function checkGridPositions(ctx) {
  const offenders = []
  const seen = new Set()
  const walk = (v, path) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    if (Array.isArray(v)) { v.forEach((item, i) => walk(item, `${path}[${i}]`)); return }
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'number' && POSITION_KEYS.has(k)) {
        if (!Number.isFinite(val) || val % GRID !== 0) offenders.push(`${path}.${k}=${val}`)
      } else if (val && typeof val === 'object') {
        walk(val, `${path}.${k}`)
      }
    }
  }
  walk(ctx.geo, 'geo')
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? `off-grid: ${offenders.slice(0, 6).join(', ')}${offenders.length > 6 ? ', …' : ''}` : 'every position sits on the 4px grid',
    hint: offenders.length ? 'run every drawn coordinate through snap4()/snapUp4() before writing it to the geometry' : undefined,
  }
}

export function checkProjectedScale(ctx) {
  const { renderResult, column } = ctx
  if (renderResult.scroll) return { ok: true, detail: 'scroll fallback in effect; the 0.78 floor does not apply' }
  const scale = renderResult.width > column ? column / renderResult.width : 1
  const ok = scale >= MIN_SCALE
  return {
    ok,
    detail: `effective scale ${scale.toFixed(3)} at a ${column}px column`,
    hint: ok ? undefined : `the figure needs to shrink below ${MIN_SCALE} to fit — reduce the element count or shorten labels, or accept the scroll fallback`,
  }
}

/** [name, fn, severity] — the rows the dispatcher appends after a plugin's
 * own verify() rows, in this order. Every one is `fail` severity. */
export const SHARED_CHECK_DEFS = [
  ['single-finite-svg', checkSingleFiniteSvg, 'fail'],
  ['a11y', checkA11y, 'fail'],
  ['font-size', checkFontSizes, 'fail'],
  ['stroke-radius', checkStrokeAndRadius, 'fail'],
  ['dark-3-state', checkNoHexColors, 'fail'],
  ['grid-4px', checkGridPositions, 'fail'],
  ['projected-scale', checkProjectedScale, 'fail'],
]

export const SHARED_ROW_NAMES = SHARED_CHECK_DEFS.map(([name]) => name)

/** Run one check, turning a thrown error into a failing row instead of
 * aborting the whole verification. */
export function runCheck(fn, ctx) {
  try {
    return fn(ctx)
  } catch (e) {
    return { ok: false, detail: `check threw: ${e.message}`, hint: 'internal verifier error — check the renderResult/ir shape passed in' }
  }
}

/** The `{ ok, checks, failures, warnings }` summary every verifier returns:
 * `ok` is true when no `fail` row fails; `warn` rows only populate
 * `warnings` (carrying the budget `key`/`value` the row reported). */
export function summarizeChecks(checks) {
  const failures = checks.filter((c) => c.severity === 'fail' && !c.ok)
  const warnings = checks
    .filter((c) => c.severity === 'warn' && !c.ok)
    .map(({ id, name, key, value, detail, hint }) => ({ id, name, key, value, detail, hint }))
  return { ok: failures.length === 0, checks, failures, warnings }
}
