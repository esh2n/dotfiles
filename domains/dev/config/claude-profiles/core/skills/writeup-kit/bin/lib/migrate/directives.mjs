// directives.mjs — convert one parsed explain-pages directive node (from
// directive-tree.mjs) into writeup-kit HTML. Each renderer returns
// {html, warnings, figure?, sequenceAsSteps?} so the caller can accumulate
// per-file report counters without re-inspecting the HTML it produced.

import { escapeHtml, irToYaml } from './util.mjs'
import { renderInline } from './inline.mjs'
import { parseBlocks, renderBlocksHtml } from './blocks.mjs'
import { parseOldDiagram } from './old-diagram.mjs'
import { parseOldSequence } from './old-sequence.mjs'
import { validateIR } from '../ir.mjs'
import { renderFigureHtmlChecked } from '../verify-diagram.mjs'
import { escapeIrScript } from '../ir-script.mjs'

// --- terms ------------------------------------------------------------

const TERM_ITEM_RE = /^\*\*(.+?)\*\*[:：]\s*(.*)$/

export function renderTerms(body) {
  const warnings = []
  const list = parseBlocks(body).find((b) => b.type === 'list')
  const items = list ? list.items : []
  const dts = []
  for (const raw of items) {
    const m = TERM_ITEM_RE.exec(raw)
    if (!m) { warnings.push(`terms: unrecognized item skipped: ${raw}`); continue }
    dts.push(`<dt>${renderInline(m[1])}</dt><dd>${renderInline(m[2])}</dd>`)
  }
  return { html: `<dl class="wu-terms">\n${dts.join('\n')}\n</dl>`, warnings }
}

// --- steps --------------------------------------------------------------

export function renderSteps(body) {
  const list = parseBlocks(body).find((b) => b.type === 'list')
  const items = list ? list.items : []
  const lis = items.map((it) => `<li>${renderInline(it)}</li>`).join('\n')
  return { html: `<ol class="wu-steps">\n${lis}\n</ol>`, warnings: [] }
}

// --- cells / scorebars (both fall back to a plain table) -----------------

function parseCellSuffixes(raw) {
  let text = raw.trim()
  let tone
  let count
  const toneMatch = /@([a-zA-Z]+)/.exec(text)
  if (toneMatch) { tone = toneMatch[1]; text = (text.slice(0, toneMatch.index) + text.slice(toneMatch.index + toneMatch[0].length)).trim() }
  const countMatch = /\*(\d+)/.exec(text)
  if (countMatch) { count = Number(countMatch[1]); text = (text.slice(0, countMatch.index) + text.slice(countMatch.index + countMatch[0].length)).trim() }
  if (text === '_') text = ''
  return { text, tone, count: count && count > 1 ? count : undefined }
}

function cellCaption(cell) {
  const bits = []
  if (cell.tone) bits.push(cell.tone)
  if (cell.count) bits.push(`×${cell.count}`)
  return bits.length ? `${cell.text} (${bits.join(', ')})` : cell.text
}

export function renderCells(body, attrs) {
  const rows = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('row')) {
      const rest = line.slice(3).trim()
      const segs = rest.split('|')
      const label = segs.shift().trim()
      const cells = segs.map((s) => cellCaption(parseCellSuffixes(s))).filter((s) => s !== '')
      rows.push([label || '(no label)', cells.join('; ')])
    } else if (line.startsWith('note')) {
      const rest = line.slice(4).trim()
      const cell = parseCellSuffixes(rest)
      rows.push(['note', cellCaption(cell)])
    }
  }
  const title = attrs.title ? `<p><strong>${renderInline(attrs.title)}</strong></p>\n` : ''
  const body_ = rows.map((r) => `<tr><td>${renderInline(r[0])}</td><td>${renderInline(r[1])}</td></tr>`).join('\n')
  return {
    html: `${title}<table class="wu-table">\n<thead><tr><th>行</th><th>内容</th></tr></thead>\n<tbody>\n${body_}\n</tbody>\n</table>`,
    warnings: [],
  }
}

export function renderScorebars(body, attrs) {
  const rows = []
  const axesOrder = []
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const label = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()
    const values = {}
    for (const pair of rest.split(',')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const axis = pair.slice(0, eq).trim()
      const val = pair.slice(eq + 1).trim()
      values[axis] = val
      if (!axesOrder.includes(axis)) axesOrder.push(axis)
    }
    rows.push({ label, values })
  }
  const max = attrs.max ?? '5'
  const header = `<thead><tr><th>案</th>${axesOrder.map((a) => `<th>${renderInline(a)}</th>`).join('')}</tr></thead>`
  const body_ = rows.map((r) => `<tr><td>${renderInline(r.label)}</td>${axesOrder.map((a) => `<td>${escapeHtml(r.values[a] ?? '')}</td>`).join('')}</tr>`).join('\n')
  return {
    html: `<p><strong>採点 (満点 ${escapeHtml(max)})</strong></p>\n<table class="wu-table">\n${header}\n<tbody>\n${body_}\n</tbody>\n</table>`,
    warnings: [],
  }
}

// --- diff ----------------------------------------------------------------

export function renderDiff(body, attrs) {
  const warnings = []
  if (attrs.mode === 'split') warnings.push('diff: mode=split is not supported, rendered as unified')
  const text = body.replace(/^\n+/, '').replace(/\n+$/, '')
  return { html: `<pre class="wu-diff" data-lang="diff"><code>${escapeHtml(text)}</code></pre>`, warnings }
}

// --- callout (info/warning/danger/success) --------------------------------

const CALLOUT_TONE = { info: 'note', success: 'note', warning: 'warn', danger: 'warn' }

export function renderCallout(name, body, attrs) {
  const tone = CALLOUT_TONE[name] ?? 'note'
  const titleHtml = attrs.title ? `<p><strong>${renderInline(attrs.title)}</strong></p>\n` : ''
  const inner = renderBlocksHtml(parseBlocks(body))
  return { html: `<div class="wu-callout" data-tone="${tone}">\n${titleHtml}${inner}\n</div>`, warnings: [] }
}

// --- compare ---------------------------------------------------------------

export function renderCompare(node) {
  const warnings = []
  const cols = node.children.filter((c) => c.name === 'col')
  if (cols.length === 0) { warnings.push('compare: no :::col children found'); return { html: '', warnings } }
  const heads = cols.map((c) => `<th>${renderInline(c.attrs.title ?? '')}</th>`).join('')
  const cells = cols.map((c) => {
    const toneLine = c.attrs.tone && c.attrs.tone !== 'neutral' ? `<p class="wu-meta">tone: ${escapeHtml(c.attrs.tone)}</p>` : ''
    return `<td>${toneLine}${renderBlocksHtml(parseBlocks(c.body))}</td>`
  }).join('')
  return {
    html: `<table class="wu-compare">\n<thead><tr>${heads}</tr></thead>\n<tbody><tr>${cells}</tr></tbody>\n</table>`,
    warnings,
  }
}

// --- diagram ---------------------------------------------------------------

function buildCandidateIR(parsed, attrs, { id, title, caption }) {
  const groups = parsed.zones.map((z) => ({ id: z.id, label: z.label, tone: 'neutral' }))
  const nodes = parsed.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    group: n.zone,
    tone: n.badge ? 'new' : 'neutral',
    dashed: false,
    emphasis: false,
  }))
  const edges = parsed.edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.ref ? 'reply' : e.dashed ? 'async' : 'sync',
    label: e.label,
  }))
  const direction = attrs.direction === 'horizontal' ? 'right' : undefined
  return { id, title, caption, direction, groups, nodes, edges }
}

function fallbackFigureHtml(candidateIR, reason, detail) {
  const rows = []
  for (const n of candidateIR.nodes) {
    rows.push(`<tr><td>node</td><td>${escapeHtml(n.id)}: ${renderInline(n.label)}${n.group ? ` (${escapeHtml(n.group)})` : ''}</td></tr>`)
  }
  for (const e of candidateIR.edges) {
    rows.push(`<tr><td>edge</td><td>${escapeHtml(e.from)} → ${escapeHtml(e.to)} (${e.kind})${e.label ? `: ${renderInline(e.label)}` : ''}</td></tr>`)
  }
  // Embed the candidate IR as YAML in the same place a rendered figure
  // would carry its IR (script right after figcaption, before </figure>),
  // so bin/rerender-figures.mjs can pick it back up and try again later
  // (e.g. after a renderer fix or a budget-driven manual split) without
  // anyone having to reconstruct the diagram from the table by hand.
  const yaml = irToYaml(candidateIR)
  const detailText = detail ? `: ${escapeHtml(detail)}` : ''
  const html = [
    '<figure class="wu-figure">',
    '<table class="wu-table">',
    '<thead><tr><th>種別</th><th>詳細</th></tr></thead>',
    `<tbody>\n${rows.join('\n')}\n</tbody>`,
    '</table>',
    `<figcaption>${renderInline(candidateIR.caption)}</figcaption>`,
    `<script type="text/x-writeup-diagram">\n${escapeIrScript(yaml)}\n</script>`,
    '</figure>',
    `<div class="wu-callout" data-tone="warn"><p>図は変換時に合格せず、表で代替 (${escapeHtml(reason)}${detailText})</p></div>`,
  ].join('\n')
  return html
}

/**
 * @param {object} node directive-tree node (name === 'diagram')
 * @param {{nextDiagramId: () => string, sectionTitle: string, column?: number}} ctx
 */
export async function renderDiagram(node, ctx) {
  const parsed = parseOldDiagram(node.body)
  const warnings = [...parsed.warnings]
  const id = ctx.nextDiagramId()
  const title = ctx.sectionTitle || `図 ${id}`
  const caption = ctx.sectionTitle ? `${ctx.sectionTitle}の図` : `${id} の内容`
  const candidateIR = buildCandidateIR(parsed, node.attrs, { id, title, caption })

  const validated = validateIR(candidateIR)
  if (!validated.ok) {
    warnings.push(`diagram: ${validated.reason} violation — ${validated.message}`)
    return { html: fallbackFigureHtml(candidateIR, validated.reason, validated.message), warnings, figureOk: false }
  }

  let rendered
  try {
    rendered = await renderFigureHtmlChecked(validated.ir, { column: ctx.column, rawYaml: JSON.stringify(validated.ir) })
  } catch (e) {
    warnings.push(`diagram: render threw: ${e.message}`)
    return { html: fallbackFigureHtml(candidateIR, 'render-error', e.message), warnings, figureOk: false }
  }
  if (!rendered.checksOk) {
    const failingChecks = rendered.checks.filter((c) => !c.ok)
    const failing = failingChecks.map((c) => c.name).join(', ')
    warnings.push(`diagram: verification failed (${failing})`)
    const hint = failingChecks.map((c) => c.hint).filter(Boolean).join('; ')
    const detail = hint ? `${failing} — ${hint}` : failing
    return { html: fallbackFigureHtml(candidateIR, 'verification', detail), warnings, figureOk: false }
  }
  return { html: rendered.html, warnings, figureOk: true }
}

// --- sequence (converted to a steps list, no figure) ------------------------

export function renderSequence(node) {
  const parsed = parseOldSequence(node.body)
  const warnings = [...parsed.warnings]
  const labelOf = (id) => parsed.participants.find((p) => p.id === id)?.label ?? id
  const lines = []
  for (const ev of parsed.events) {
    if (ev.kind === 'note') {
      lines.push(`注 (${renderInline(labelOf(ev.over))}): ${renderInline(ev.text)}`)
    } else {
      const suffix = ev.dashed ? ' (応答)' : ''
      lines.push(`${renderInline(labelOf(ev.from))} → ${renderInline(labelOf(ev.to))}${suffix}: ${renderInline(ev.label)}`)
    }
  }
  const html = `<ol class="wu-steps">\n${lines.map((l) => `<li>${l}</li>`).join('\n')}\n</ol>`
  return { html, warnings }
}
