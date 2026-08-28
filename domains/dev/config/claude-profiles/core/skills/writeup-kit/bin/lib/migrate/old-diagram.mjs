// old-diagram.mjs — a faithful JS port of explain-pages'
// packages/core/src/parseDiagram.ts (docs/authoring.md ":::diagram" DSL),
// used only to read the old format during migration. Unlike the original,
// this is tolerant: an unrecognized line is recorded as a warning and
// skipped instead of throwing, so one malformed line in a 147-file corpus
// does not abort the whole migration.

import { splitLabelAndAttrs, parseAttrString } from './attrs.mjs'

const NODE_PATTERN = /^(\w+)\[([^\]]*)\]$/
const ZONE_PATTERN = /^zone\s+(\w+)\[([^\]]*)\]$/
const EDGE_PATTERN = /^(\w+)\s*(-->|->)\s*(\w+)\s*(?::\s*"([^"]*)")?\s*(?:\{([^}]*)\})?$/

/**
 * @param {string} raw the directive body text
 * @returns {{nodes:object[], zones:object[], edges:object[], warnings:string[]}}
 */
export function parseOldDiagram(raw) {
  const nodes = []
  const zones = []
  const edges = []
  const warnings = []
  let currentZone

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    if (line === 'end') { currentZone = undefined; continue }

    const zoneMatch = ZONE_PATTERN.exec(line)
    if (zoneMatch) {
      const { label, attrs } = splitLabelAndAttrs(zoneMatch[2])
      zones.push({ id: zoneMatch[1], label, tint: attrs.tint ?? 'gray', border: attrs.border === 'dashed' ? 'dashed' : 'solid' })
      currentZone = zoneMatch[1]
      continue
    }

    const edgeMatch = EDGE_PATTERN.exec(line)
    if (edgeMatch) {
      const attrs = edgeMatch[5] ? parseAttrString(edgeMatch[5]) : {}
      edges.push({
        from: edgeMatch[1],
        to: edgeMatch[3],
        label: edgeMatch[4],
        dashed: edgeMatch[2] === '-->',
        style: attrs.style ?? 'default',
        ref: attrs.ref === 'true',
      })
      continue
    }

    const nodeMatch = NODE_PATTERN.exec(line)
    if (nodeMatch) {
      const { label, attrs } = splitLabelAndAttrs(nodeMatch[2])
      nodes.push({
        id: nodeMatch[1],
        label,
        icon: attrs.icon,
        sub: attrs.sub,
        badge: attrs.badge,
        tone: attrs.tone ?? 'default',
        shape: attrs.shape === 'cylinder' ? 'cylinder' : 'box',
        zone: currentZone,
      })
      continue
    }

    warnings.push(`diagram: unrecognized line skipped: ${line}`)
  }

  return { nodes, zones, edges, warnings }
}
