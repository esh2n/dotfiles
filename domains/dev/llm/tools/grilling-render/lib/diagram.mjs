// diagram ブロックを elkjs でレイアウトしてインライン SVG にする。
import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()

export const FONT_SIZE = 13
const NODE_H = 42
const NODE_PAD_X = 18
const NODE_MIN_W = 124
const GROUP_HEADER = 36
const BOLD_FACTOR = 1.08
const LEGEND_H = 34

/** 本文の列幅。図はまずここに収める。 */
export const COLUMN = 720
/** 縦向きに倒したときに許す高さ。向きの選択にだけ使う。 */
export const MAX_HEIGHT = 900
/** 縮小の下限。これより小さくしないと収まらない図はスクロールに逃がす。 */
export const MIN_SCALE = 0.78

const CJK_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
  [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
]

const isWide = (cp) => CJK_RANGES.some(([a, b]) => cp >= a && cp <= b)

/**
 * 文字幅の見積り。ASCII は 0.6em、CJK は 1em として数える。
 * ノード幅と間隔の算出、およびテストのはみ出し検査に同じ関数を使う。
 */
export function textWidth(text, fontSize = FONT_SIZE) {
  let em = 0
  for (const ch of String(text)) em += isWide(ch.codePointAt(0)) ? 1 : 0.6
  return em * fontSize
}

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const r2 = (n) => Math.round(n * 100) / 100

const TONE = {
  ts: { stroke: 'var(--ts)', fill: 'var(--ts-soft)', text: 'var(--ts)' },
  rs: { stroke: 'var(--rs)', fill: 'var(--rs-soft)', text: 'var(--rs)' },
  new: { stroke: 'var(--new)', fill: 'var(--new-soft)', text: 'var(--new)' },
  neutral: { stroke: 'currentColor', fill: 'var(--surface)', text: 'currentColor' },
}

const EDGE_KIND_ORDER = ['sync', 'async', 'reply']
const EDGE_KIND_LABEL = {
  sync: '同期の呼び出し',
  async: '非同期・生成',
  reply: '応答・戻り',
}

/** 辺 1 本の線種とマーカー。 */
function edgeStyle(kind, uid) {
  if (kind === 'sync') return { dash: null, marker: `${uid}-solid` }
  if (kind === 'async') return { dash: null, marker: `${uid}-open` }
  return { dash: '5 4', marker: `${uid}-open` }
}

/** ノード 1 つの箱の大きさ。ラベルがはみ出さない幅を返す。 */
export function nodeSize(label, { bold = false, fontSize = FONT_SIZE, minWidth = NODE_MIN_W, height = NODE_H } = {}) {
  const w = textWidth(label, fontSize) * (bold ? BOLD_FACTOR : 1) + NODE_PAD_X * 2
  return { width: Math.max(minWidth, Math.ceil(w)), height }
}

/**
 * diagram ブロックを SVG 文字列にする。
 *
 * 列幅（720px）に収めるため、次の順で試す:
 *   1. 著者の向き（既定 right）でレイアウト
 *   2. 収まらず、かつ向きが明示されていなければ逆向きでもレイアウトし、
 *      max(幅/720, 高さ/900) が小さいほうを採る
 *   3. それでも広ければ 720px まで縮小する。ただし 0.78 倍を下限とし、
 *      それを下回るなら実寸のまま横スクロールに逃がす
 *
 * @param {object} diagram parse.mjs が返す diagram
 * @param {string} uid マーカー id の接頭辞（ページ内で一意にする）
 */
export async function renderDiagram(diagram, uid) {
  const first = await layoutOnce(diagram, diagram.direction, uid)
  let best = first
  let direction = diagram.direction

  if (first.width > COLUMN && !diagram.directionPinned) {
    const other = diagram.direction === 'down' ? 'right' : 'down'
    const alt = await layoutOnce(diagram, other, uid)
    if (fitRatio(alt) < fitRatio(first)) { best = alt; direction = other }
  }

  let displayWidth = best.width
  let scaled = false
  if (best.width > COLUMN) {
    if (COLUMN / best.width >= MIN_SCALE) { displayWidth = COLUMN; scaled = true }
  }

  return { ...draw(diagram, best, uid), width: best.width, displayWidth, scaled, direction }
}

const fitRatio = (l) => Math.max(l.width / COLUMN, l.height / MAX_HEIGHT)

/** 1 つの向きで ELK にレイアウトさせる。 */
async function layoutOnce(diagram, direction, uid) {
  const { nodes, groups, edges } = diagram

  const elkNodes = nodes.map((n) => ({ id: n.id, ...nodeSize(n.label, { bold: n.emphasis }) }))
  const elkById = new Map(elkNodes.map((n) => [n.id, n]))

  const children = []
  for (const g of groups) {
    const kids = nodes.filter((n) => n.group === g.id).map((n) => elkById.get(n.id))
    const minW = Math.ceil(textWidth(g.label, FONT_SIZE) * BOLD_FACTOR) + NODE_PAD_X * 2
    children.push({
      id: g.id,
      layoutOptions: {
        'elk.padding': `[top=${GROUP_HEADER},left=16,bottom=16,right=16]`,
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${minW},60)`,
      },
      children: kids,
    })
  }
  for (const n of nodes) if (!n.group) children.push(elkById.get(n.id))

  // 辺ラベルが線より長いと重なるので、レイヤ間隔をラベル幅から決める
  let labelSpace = 0
  const elkEdges = edges.map((e, i) => {
    const labels = []
    if (e.label) {
      const w = Math.ceil(textWidth(e.label, 11)) + 10
      labelSpace = Math.max(labelSpace, w)
      labels.push({ id: `${uid}-el${i}`, text: e.label, width: w, height: 14 })
    }
    // reply は「戻り」なので、レイヤ計算では逆向きに食わせて循環を避け、
    // 描画時に点列を反転して本来の向きに矢尻を付ける
    const flip = e.kind === 'reply'
    return {
      id: `${uid}-e${i}`,
      sources: [flip ? e.to : e.from],
      targets: [flip ? e.from : e.to],
      labels,
      kind: e.kind,
      flip,
      raw: e,
    }
  })
  const layerSpacing = Math.max(64, labelSpace + 36)

  const laid = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.padding': '[top=12,left=12,bottom=12,right=12]',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.nodeNode': '26',
      'elk.spacing.edgeNode': '18',
      'elk.spacing.edgeLabel': '6',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children,
    edges: elkEdges.map(({ id, sources, targets, labels }) => ({ id, sources, targets, labels })),
  })

  const usedKinds = EDGE_KIND_ORDER.filter((k) => edges.some((e) => e.kind === k))
  return {
    laid,
    elkEdges,
    abs: absolutePositions(laid),
    usedKinds,
    width: Math.max(1, Math.ceil(laid.width)),
    height: Math.max(1, Math.ceil(laid.height)) + (usedKinds.length ? LEGEND_H : 0),
  }
}

/** レイアウト結果を SVG 文字列にする。 */
function draw(diagram, layout, uid) {
  const { nodes, groups } = diagram
  const { laid, elkEdges, abs, usedKinds, width, height } = layout
  const parts = []

  parts.push('<defs>')
  parts.push(`<marker id="${esc(uid)}-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`)
  parts.push(`<marker id="${esc(uid)}-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0.5 0.5 L9.5 5 L0.5 9.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>`)
  parts.push('</defs>')

  // 群れ（コンテナ）
  for (const g of groups) {
    const box = abs.get(g.id)
    if (!box) continue
    const t = TONE[g.tone] || TONE.neutral
    parts.push(`<rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.width)}" height="${r2(box.height)}" rx="10" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.5"/>`)
    parts.push(`<text x="${r2(box.x + 16)}" y="${r2(box.y + 23)}" font-size="${FONT_SIZE}" font-weight="700" fill="${t.text}">${esc(g.label)}</text>`)
  }

  // ノード
  for (const n of nodes) {
    const box = abs.get(n.id)
    if (!box) continue
    const t = TONE[n.tone] || TONE.neutral
    const fill = n.dashed ? 'none' : t.fill
    const dash = n.dashed ? ' stroke-dasharray="5 4"' : ''
    const sw = n.emphasis ? 2 : 1
    parts.push(`<rect x="${r2(box.x)}" y="${r2(box.y)}" width="${r2(box.width)}" height="${r2(box.height)}" rx="6" fill="${fill}" stroke="${t.stroke}" stroke-width="${sw}"${dash}/>`)
    const weight = n.emphasis ? ' font-weight="700"' : ''
    parts.push(`<text x="${r2(box.x + box.width / 2)}" y="${r2(box.y + box.height / 2 + FONT_SIZE * 0.35)}" font-size="${FONT_SIZE}" text-anchor="middle" fill="${t.text}"${weight}>${esc(n.label)}</text>`)
  }

  // 辺
  for (const [i, e] of (laid.edges || []).entries()) {
    const meta = elkEdges[i]
    const off = abs.get(e.container || 'root') || { x: 0, y: 0 }
    const base = e.container && e.container !== 'root' ? { x: off.x, y: off.y } : { x: 0, y: 0 }
    const st = edgeStyle(meta.kind, uid)
    for (const sec of e.sections || []) {
      const raw = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
      if (meta.flip) raw.reverse()
      const pts = raw.map((p) => `${r2(p.x + base.x)} ${r2(p.y + base.y)}`)
      const d = `M${pts[0]} ${pts.slice(1).map((p) => `L${p}`).join(' ')}`
      const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
      parts.push(`<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.2"${dash} marker-end="url(#${esc(st.marker)})"/>`)
    }
    for (const lb of e.labels || []) {
      parts.push(`<text x="${r2(lb.x + base.x)}" y="${r2(lb.y + base.y + 11)}" font-size="11" fill="currentColor">${esc(meta.raw.label)}</text>`)
    }
  }

  if (usedKinds.length) parts.push(legendSvg(usedKinds, uid, Math.ceil(laid.height) + 8))

  const aria = diagram.caption || diagram.title
  return {
    svg: `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`,
    height,
    boxes: abs,
    usedKinds,
  }
}

function legendSvg(kinds, uid, y) {
  const out = ['<g font-size="11" fill="var(--ink-3)">']
  let x = 12
  for (const k of kinds) {
    const st = edgeStyle(k, uid)
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : ''
    out.push(`<path d="M${x} ${y + 8} L${x + 30} ${y + 8}" fill="none" stroke="currentColor" stroke-width="1.2"${dash} marker-end="url(#${esc(st.marker)})"/>`)
    const label = EDGE_KIND_LABEL[k]
    out.push(`<text x="${x + 38}" y="${y + 12}">${esc(label)}</text>`)
    x += 38 + Math.ceil(textWidth(label, 11)) + 22
  }
  out.push('</g>')
  return out.join('')
}

/** ELK の入れ子座標を絶対座標に畳む。 */
function absolutePositions(laid) {
  const map = new Map([['root', { x: 0, y: 0, width: laid.width, height: laid.height }]])
  const walk = (node, ox, oy) => {
    for (const c of node.children || []) {
      const x = ox + (c.x || 0)
      const y = oy + (c.y || 0)
      map.set(c.id, { x, y, width: c.width || 0, height: c.height || 0 })
      walk(c, x, y)
    }
  }
  walk(laid, 0, 0)
  return map
}
