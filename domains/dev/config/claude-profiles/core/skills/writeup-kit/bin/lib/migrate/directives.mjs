// directives.mjs — convert one parsed explain-pages directive node (from
// directive-tree.mjs) into writeup-kit HTML. Each renderer returns
// {html, warnings, figure?, sequenceAsSteps?} so the caller can accumulate
// per-file report counters without re-inspecting the HTML it produced.

import { escapeHtml, irToYaml } from './util.mjs'
import { renderInline } from './inline.mjs'
import { parseCells, cellsHtml } from '../cells.mjs'
import { parseBlocks, renderBlocksHtml } from './blocks.mjs'
import { parseOldDiagram } from './old-diagram.mjs'
import { parseOldSequence, toSequenceIR, sequenceIrToYaml } from './old-sequence.mjs'
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

// --- cells (the `.wu-cells` component) / scorebars (a plain table) --------

/**
 * `:::cells` → the kit's `.wu-cells` component: one thing split into
 * labelled parts, drawn as adjacent boxes in a strip. The grammar, the
 * old-tone → kit-tone map, the accent budget and the markup all live in
 * bin/lib/cells.mjs so the component and this migration cannot drift.
 *
 * Scoring bars (`:::scorebars`) deliberately stay a table — see
 * renderScorebars() below.
 */
export function renderCells(body, attrs) {
  const parsed = parseCells(body)
  const warnings = [...parsed.warnings]
  for (const key of Object.keys(attrs)) {
    if (key !== 'title') warnings.push(`cells: unsupported attribute ignored: ${key}`)
  }
  return {
    html: cellsHtml(parsed, { title: attrs.title, inline: renderInline }),
    warnings,
  }
}

/**
 * `:::scorebars` → a plain table, on purpose. Every one of the 11 real uses
 * is "2–8 options scored 1–5 against a handful of criteria", which the
 * figure survey puts squarely in the table lane ("3 列の表で伝わるなら表"),
 * and which the decision-record research found in none of the design
 * documents we measured. The table is the honest rendering; do not replace
 * it with a bar figure.
 */
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
  // Budget overruns are guidance, not a gate: the figure is still drawn
  // (verified geometry decides) and carries data-warn; note it for the
  // migration log so the author can consider splitting it later.
  for (const w of validated.warnings ?? []) {
    warnings.push(`diagram: budget warning — ${w.key}=${w.value} (${w.detail})`)
  }

  let rendered
  try {
    rendered = await renderFigureHtmlChecked(validated.ir, { column: ctx.column, rawYaml: JSON.stringify(validated.ir) })
  } catch (e) {
    warnings.push(`diagram: render threw: ${e.message}`)
    return { html: fallbackFigureHtml(candidateIR, 'render-error', e.message), warnings, figureOk: false }
  }
  if (!rendered.checksOk) {
    const failingChecks = rendered.failures ?? rendered.checks.filter((c) => !c.ok)
    const failing = failingChecks.map((c) => c.name).join(', ')
    warnings.push(`diagram: verification failed (${failing})`)
    const hint = failingChecks.map((c) => c.hint).filter(Boolean).join('; ')
    const detail = hint ? `${failing} — ${hint}` : failing
    return { html: fallbackFigureHtml(candidateIR, 'verification', detail), warnings, figureOk: false }
  }
  return { html: rendered.html, warnings, figureOk: true }
}

// --- sequence (rendered as a wu-figure sequence diagram whenever its
// geometry verifies — the participant/message/label budgets are guidance,
// logged as warnings and stamped as data-warn, never a reason to fall
// back; falls back to the old steps-list rendering, with the candidate IR
// kept in the fallback figure's script, on a schema error or a geometry
// failure) --------------------------------------------------------------

/** The pre-M2 rendering: one step per line, "A → B: label" / "注 (A): text".
 * Used both as the final output when the candidate IR never even validates
 * (nothing renderable to fall back from) and as the content of the wrapped
 * fallback figure when it validates but fails verification. */
function sequenceStepsHtml(parsed) {
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
  return `<ol class="wu-steps">\n${lines.map((l) => `<li>${l}</li>`).join('\n')}\n</ol>`
}

/** The steps list wrapped in a `<figure class="wu-figure">` carrying the
 * candidate IR's script — never `data-checks="pass"` (that's reserved for a
 * figure that actually rendered/verified as a sequence diagram), but
 * discoverable by bin/rerender-figures.mjs's `<figure class="...wu-figure...">`
 * scan the same way a fallen-back diagram already is (see
 * fallbackFigureHtml() above), so a later kit/renderer fix — or a manual
 * split into a smaller sequence — can pick the IR back up and re-render it
 * without reconstructing it from the steps list by hand. */
function sequenceFallbackHtml(parsed, candidateIR, reason, detail) {
  const yaml = sequenceIrToYaml(candidateIR)
  const detailText = detail ? `: ${escapeHtml(detail)}` : ''
  return [
    '<figure class="wu-figure" data-type="sequence">',
    sequenceStepsHtml(parsed),
    `<figcaption>${renderInline(candidateIR.caption)}</figcaption>`,
    `<script type="text/x-writeup-diagram">\n${escapeIrScript(yaml)}\n</script>`,
    '</figure>',
    `<div class="wu-callout" data-tone="warn"><p>シーケンス図は変換時に合格せず、手順リストで代替 (${escapeHtml(reason)}${detailText})</p></div>`,
  ].join('\n')
}

/**
 * @param {object} node directive-tree node (name === 'sequence')
 * @param {{nextDiagramId: () => string, sectionTitle: string, column?: number}} ctx
 */
export async function renderSequence(node, ctx) {
  const parsed = parseOldSequence(node.body)
  const warnings = [...parsed.warnings]
  const id = ctx.nextDiagramId()
  const title = ctx.sectionTitle || `シーケンス ${id}`
  const caption = ctx.sectionTitle ? `${ctx.sectionTitle}のシーケンス` : `${id} の内容`
  const candidateIR = toSequenceIR(parsed, { id, title, caption })

  const validated = validateIR(candidateIR)
  if (!validated.ok) {
    warnings.push(`sequence: ${validated.reason} violation — ${validated.message}`)
    return { html: sequenceFallbackHtml(parsed, candidateIR, validated.reason, validated.message), warnings, figureOk: false }
  }
  // Budget overruns are guidance, not a gate (same as renderDiagram()
  // above): the figure is still drawn and carries data-warn; note it in
  // the migration report so the author can consider splitting it later.
  for (const w of validated.warnings ?? []) {
    warnings.push(`sequence: budget warning — ${w.key}=${w.value} (${w.detail})`)
  }

  let rendered
  try {
    rendered = await renderFigureHtmlChecked(validated.ir, { column: ctx.column, rawYaml: JSON.stringify(validated.ir) })
  } catch (e) {
    warnings.push(`sequence: render threw: ${e.message}`)
    return { html: sequenceFallbackHtml(parsed, candidateIR, 'render-error', e.message), warnings, figureOk: false }
  }
  if (!rendered.checksOk) {
    const failingChecks = rendered.failures ?? rendered.checks.filter((c) => !c.ok)
    const failing = failingChecks.map((c) => c.name).join(', ')
    warnings.push(`sequence: verification failed (${failing})`)
    const hint = failingChecks.map((c) => c.hint).filter(Boolean).join('; ')
    const detail = hint ? `${failing} — ${hint}` : failing
    return { html: sequenceFallbackHtml(parsed, candidateIR, 'verification', detail), warnings, figureOk: false }
  }
  return { html: rendered.html, warnings, figureOk: true }
}
