// body.mjs — turn an explain-pages Markdown body (frontmatter already
// stripped) into writeup-kit `.wu-section` HTML, dispatching each directive
// to directives.mjs and grouping plain Markdown by its h2 headings (spec:
// "headings→h2/h3/h4 inside .wu-section").

import { parseDirectiveTree } from './directive-tree.mjs'
import { parseBlocks, renderBlocksHtml } from './blocks.mjs'
import { renderInline } from './inline.mjs'
import {
  renderTerms, renderSteps, renderCells, renderScorebars, renderDiff,
  renderCallout, renderCompare, renderDiagram, renderSequence,
} from './directives.mjs'

const CALLOUT_NAMES = new Set(['info', 'warning', 'danger', 'success'])

/**
 * @param {string} bodyMarkdown
 * @param {{column?: number}} [opts]
 * @returns {Promise<{sectionsHtml:string, warnings:string[], directiveCounts:Record<string,number>, figures:{ok:number,fallback:number}, sequenceAsSteps:number}>}
 */
export async function renderBody(bodyMarkdown, opts = {}) {
  const nodes = parseDirectiveTree(bodyMarkdown)
  const warnings = []
  const directiveCounts = {}
  const figures = { ok: 0, fallback: 0 }
  let sequenceAsSteps = 0
  let sectionTitle = ''
  let diagramCounter = 0
  const nextDiagramId = () => `d${++diagramCounter}`

  const sections = []
  let current = { heading: null, parts: [] }
  const pushSection = () => { if (current.parts.length) sections.push(current) }

  const countDirective = (name) => { directiveCounts[name] = (directiveCounts[name] ?? 0) + 1 }

  for (const node of nodes) {
    if (node.type === 'md') {
      for (const b of parseBlocks(node.text)) {
        if (b.type === 'heading' && b.level === 2) {
          pushSection()
          current = { heading: b.text, parts: [] }
          sectionTitle = b.text
          continue
        }
        current.parts.push(renderBlocksHtml([b]))
      }
      continue
    }

    countDirective(node.name)
    const attrs = node.attrs
    let result

    if (node.name === 'terms') result = renderTerms(node.body)
    else if (node.name === 'steps') result = renderSteps(node.body)
    else if (node.name === 'cells') result = renderCells(node.body, attrs)
    else if (node.name === 'scorebars') result = renderScorebars(node.body, attrs)
    else if (node.name === 'diff') result = renderDiff(node.body, attrs)
    else if (CALLOUT_NAMES.has(node.name)) result = renderCallout(node.name, node.body, attrs)
    else if (node.name === 'compare') result = renderCompare(node)
    else if (node.name === 'diagram') {
      result = await renderDiagram(node, { nextDiagramId, sectionTitle, column: opts.column })
      figures[result.figureOk ? 'ok' : 'fallback']++
    } else if (node.name === 'sequence') {
      result = await renderSequence(node, { nextDiagramId, sectionTitle, column: opts.column })
      figures[result.figureOk ? 'ok' : 'fallback']++
      if (!result.figureOk) sequenceAsSteps++
    } else {
      result = { html: '', warnings: [`directive not converted (unsupported outside legacy set): ${node.name}`] }
    }

    warnings.push(...result.warnings)
    if (result.html) current.parts.push(result.html)
  }
  pushSection()

  const sectionsHtml = sections
    .map((s) => {
      const h2 = s.heading ? `<h2>${renderInline(s.heading)}</h2>\n` : ''
      return `<section class="wu-section">\n${h2}${s.parts.join('\n')}\n</section>`
    })
    .join('\n\n')

  return { sectionsHtml, warnings, directiveCounts, figures, sequenceAsSteps }
}

export const LEGACY_DIRECTIVE_RE = /:::+(aggregate|board|dddboard|html|pr)\b/

/** True if the raw file text contains a directive the IR cannot represent
 * (spec: aggregate/board/dddboard/html/pr -> whole file is legacy). */
export function isLegacyFile(rawText) {
  return LEGACY_DIRECTIVE_RE.test(rawText)
}

/** Which of the legacy-triggering directive names are present (for the
 * report / stub reason text). */
export function legacyReasons(rawText) {
  const names = new Set()
  const re = /:::+(aggregate|board|dddboard|html|pr)\b/g
  let m
  while ((m = re.exec(rawText))) names.add(m[1])
  return [...names]
}
