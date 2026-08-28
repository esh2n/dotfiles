// ラウンド文書 (round-N.md) を構造化データに変換する。
// 形式の正本は ../../references/round-format.md。
import { parse as parseYaml } from 'yaml'

/** スキーマ違反。どのブロックのどのフィールドかを message に必ず含める。 */
export class SchemaError extends Error {
  constructor(block, message) {
    super(`[${block}] ${message}`)
    this.name = 'SchemaError'
    this.block = block
  }
}

const TREE_STATES = new Set(['decided', 'open', 'asked'])
const TONES = new Set(['ts', 'rs', 'new', 'neutral'])
const EDGE_KINDS = new Set(['sync', 'async', 'reply'])
const DIRECTIONS = new Set(['right', 'down'])
const PREMISE_KEYS = ['task', 'decided', 'why_now', 'unblocks']

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// YAML では `label: 401` が数値になるので、表示用の値は数値も受けて文字列にする。
const asText = (v) => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v)) ? String(v) : null)

function requireString(block, obj, field) {
  const v = asText(obj[field])
  if (v === null || v.trim() === '') {
    throw new SchemaError(block, `必須フィールド "${field}" が無いか文字列ではありません`)
  }
  return v
}

function optionalString(block, obj, field) {
  if (obj[field] === undefined || obj[field] === null) return undefined
  const v = asText(obj[field])
  if (v === null) {
    throw new SchemaError(block, `フィールド "${field}" は文字列でなければなりません`)
  }
  return v
}

function yamlOf(block, text) {
  let doc
  try {
    doc = parseYaml(text)
  } catch (e) {
    throw new SchemaError(block, `YAML として読めません: ${e.message}`)
  }
  return doc
}

// --- 字句解析 -------------------------------------------------------------

const FENCE_OPEN = /^```(\S*)\s*$/
const H2 = /^##\s+(.+?)\s*$/
const H3_Q = /^###\s*(?:❓\s*)?Q(\d+)\s*[:：]\s*(.+?)\s*$/
const ANSWER = /^answer\s*:\s*(.*)$/

/**
 * ラウンド文書を読む。
 * @returns {{frontmatter, premise, tree, questions}}
 */
export function parseRound(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  let i = 0

  // 1. frontmatter
  if (lines[0]?.trim() !== '---') {
    throw new SchemaError('frontmatter', 'ファイル先頭に "---" で始まる frontmatter がありません')
  }
  let end = -1
  for (let k = 1; k < lines.length; k++) {
    if (lines[k].trim() === '---') { end = k; break }
  }
  if (end < 0) throw new SchemaError('frontmatter', '閉じの "---" がありません')
  const frontmatter = validateFrontmatter(yamlOf('frontmatter', lines.slice(1, end).join('\n')))
  i = end + 1

  // 2. 本体を走査
  /** @type {{prose: string[], fence?: object}} */
  let premiseRaw = null
  let treeFence = null
  const questions = []
  let mode = null // 'premise' | 'tree' | 'question'
  let current = null

  while (i < lines.length) {
    const line = lines[i]
    const fence = FENCE_OPEN.exec(line)
    if (fence) {
      const info = fence[1]
      const body = []
      i++
      let closed = false
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i])) { closed = true; i++; break }
        body.push(lines[i]); i++
      }
      if (!closed) throw new SchemaError(info || 'fence', '閉じられていないコードフェンスがあります')
      const raw = body.join('\n')
      if (info === 'premise') {
        if (!premiseRaw) premiseRaw = { prose: [] }
        premiseRaw.fence = raw
      } else if (info === 'tree') {
        treeFence = raw
      } else if (info === 'diagram') {
        if (!current) throw new SchemaError('diagram', '問い (### ❓ Q[n]) の外に diagram フェンスがあります')
        if (current.questionFence) {
          throw new SchemaError('diagram', `Q${current.num}: diagram フェンスは question フェンスより前に置いてください`)
        }
        current.diagramFences.push(raw)
      } else if (info === 'question') {
        if (!current) throw new SchemaError('question', '問い (### ❓ Q[n]) の外に question フェンスがあります')
        if (current.questionFence) throw new SchemaError('question', `Q${current.num}: question フェンスが 2 つあります`)
        current.questionFence = raw
      } else {
        // それ以外 (go / sql / text など) はコードブロックとして散文に残す。mdBlocks が <pre> にする
        const codeLines = ['```' + info, ...body, '```']
        if (mode === 'question' && current && !current.questionFence) current.prose.push(...codeLines)
        else if (mode === 'premise' && premiseRaw) premiseRaw.prose.push(...codeLines)
      }
      continue
    }

    const h3 = H3_Q.exec(line)
    if (h3) {
      current = { num: Number(h3[1]), title: h3[2], prose: [], diagramFences: [], questionFence: null, answer: null }
      questions.push(current)
      mode = 'question'
      i++
      continue
    }

    const h2 = H2.exec(line)
    if (h2) {
      const heading = h2[1]
      if (/前提/.test(heading)) { premiseRaw = premiseRaw || { prose: [] }; mode = 'premise'; current = null }
      else if (/設計ツリー/.test(heading)) { mode = 'tree'; current = null }
      else { mode = null; current = null }
      i++
      continue
    }

    if (mode === 'question' && current) {
      const ans = ANSWER.exec(line)
      if (ans && current.questionFence) { current.answer = ans[1].trim(); i++; continue }
      if (!current.questionFence) current.prose.push(line)
    } else if (mode === 'premise' && premiseRaw && !premiseRaw.fence) {
      premiseRaw.prose.push(line)
    }
    i++
  }

  if (!treeFence) throw new SchemaError('tree', '```tree フェンスがありません')
  const tree = validateTree(yamlOf('tree', treeFence))

  const premise = premiseRaw ? buildPremise(premiseRaw) : null
  const parsed = questions.map((q) => buildQuestion(q))
  if (parsed.length === 0) throw new SchemaError('question', '問い (### ❓ Q[n]) が 1 つもありません')

  const seen = new Set()
  for (const q of parsed) {
    if (seen.has(q.id)) throw new SchemaError(`question ${q.id}`, 'id が重複しています')
    seen.add(q.id)
  }

  return { frontmatter, premise, tree, questions: parsed }
}

// --- 各ブロックの検証 -----------------------------------------------------

function validateFrontmatter(fm) {
  if (!isPlainObject(fm)) throw new SchemaError('frontmatter', 'マッピングではありません')
  const slug = requireString('frontmatter', fm, 'slug')
  const target = requireString('frontmatter', fm, 'target')
  if (!Number.isInteger(fm.round) || fm.round < 1) {
    throw new SchemaError('frontmatter', 'フィールド "round" は 1 以上の整数でなければなりません')
  }
  const status = requireString('frontmatter', fm, 'status')
  if (status !== 'open' && status !== 'answered') {
    throw new SchemaError('frontmatter', `フィールド "status" は open | answered のいずれかです (実際: ${status})`)
  }
  return { slug, round: fm.round, target, status }
}

function validateTree(tree) {
  if (!Array.isArray(tree) || tree.length === 0) {
    throw new SchemaError('tree', 'ノードの配列でなければなりません')
  }
  const ids = new Set()
  const walk = (nodes, depth) => nodes.map((n) => {
    if (!isPlainObject(n)) throw new SchemaError('tree', 'ノードはマッピングでなければなりません')
    const id = requireString('tree', n, 'id')
    if (ids.has(id)) throw new SchemaError(`tree ${id}`, 'ノード id が重複しています')
    ids.add(id)
    const label = requireString(`tree ${id}`, n, 'label')
    const state = requireString(`tree ${id}`, n, 'state')
    if (!TREE_STATES.has(state)) {
      throw new SchemaError(`tree ${id}`, `フィールド "state" は decided | open | asked のいずれかです (実際: ${state})`)
    }
    const decision = optionalString(`tree ${id}`, n, 'decision')
    const asks = optionalString(`tree ${id}`, n, 'asks')
    if (asks !== undefined && !/^q\d+$/.test(asks)) {
      throw new SchemaError(`tree ${id}`, `フィールド "asks" は問いの id（q1 など）でなければなりません (実際: ${asks})`)
    }
    let children = []
    if (n.children !== undefined) {
      if (!Array.isArray(n.children)) throw new SchemaError(`tree ${id}`, 'フィールド "children" は配列でなければなりません')
      children = walk(n.children, depth + 1)
    }
    return { id, label, state, decision, asks, depth, children }
  })
  return walk(tree, 0)
}

function buildPremise(raw) {
  const prose = trimBlank(raw.prose)
  let rows = []
  if (raw.fence !== undefined) {
    const doc = yamlOf('premise', raw.fence)
    if (!isPlainObject(doc)) throw new SchemaError('premise', 'マッピングではありません')
    for (const key of Object.keys(doc)) {
      if (!PREMISE_KEYS.includes(key)) {
        throw new SchemaError('premise', `未知のフィールド "${key}" (使えるのは ${PREMISE_KEYS.join(' / ')})`)
      }
    }
    rows = PREMISE_KEYS
      .filter((k) => doc[k] !== undefined && doc[k] !== null)
      .map((k) => {
        if (typeof doc[k] !== 'string') throw new SchemaError('premise', `フィールド "${k}" は文字列でなければなりません`)
        return { key: k, value: doc[k] }
      })
  }
  return { prose, rows }
}

function buildQuestion(q) {
  const block = `question q${q.num}`
  if (!q.questionFence) throw new SchemaError(block, '```question フェンスがありません')
  const doc = yamlOf(block, q.questionFence)
  if (!isPlainObject(doc)) throw new SchemaError(block, 'マッピングではありません')
  const id = requireString(block, doc, 'id')
  if (id !== `q${q.num}`) {
    throw new SchemaError(block, `フィールド "id" が見出しと一致しません (見出し: Q${q.num} / フェンス: ${id})`)
  }
  if (!Array.isArray(doc.options) || doc.options.length === 0) {
    throw new SchemaError(block, '必須フィールド "options" が無いか空です')
  }
  const keys = new Set()
  const options = doc.options.map((o, idx) => {
    const ob = `${block} options[${idx}]`
    if (!isPlainObject(o)) throw new SchemaError(ob, 'マッピングではありません')
    const key = requireString(ob, o, 'key')
    if (keys.has(key)) throw new SchemaError(ob, `key "${key}" が重複しています`)
    keys.add(key)
    return {
      key,
      label: requireString(ob, o, 'label'),
      gains: requireString(ob, o, 'gains'),
      loses: requireString(ob, o, 'loses'),
    }
  })
  const recommended = requireString(block, doc, 'recommended')
  if (!keys.has(recommended)) {
    throw new SchemaError(block, `フィールド "recommended" が options の key にありません (実際: ${recommended})`)
  }
  const prioritized = requireString(block, doc, 'prioritized_tradeoff')
  const rationale = requireString(block, doc, 'rationale')
  const sources = validateSources(block, doc.sources)
  const diagrams = q.diagramFences.map((raw, idx) => validateDiagram(`q${q.num}`, idx, yamlOf(`diagram q${q.num}[${idx}]`, raw)))
  const dids = new Set()
  for (const d of diagrams) {
    if (dids.has(d.id)) throw new SchemaError(`diagram ${d.id}`, `Q${q.num} 内で diagram id が重複しています`)
    dids.add(d.id)
  }

  return {
    id,
    num: q.num,
    title: q.title,
    ...extractProse(q.prose),
    diagrams,
    options,
    recommended,
    prioritized_tradeoff: prioritized,
    rationale,
    sources,
    answer: q.answer,
  }
}

function validateSources(block, sources) {
  if (sources === undefined || sources === null) return []
  if (!Array.isArray(sources)) throw new SchemaError(block, 'フィールド "sources" は配列でなければなりません')
  return sources.map((s, idx) => {
    const sb = `${block} sources[${idx}]`
    if (!isPlainObject(s)) throw new SchemaError(sb, 'マッピングではありません')
    const kind = requireString(sb, s, 'kind')
    if (kind !== 'url' && kind !== 'path') {
      throw new SchemaError(sb, `フィールド "kind" は url | path のいずれかです (実際: ${kind})`)
    }
    return { kind, ref: requireString(sb, s, 'ref'), note: optionalString(sb, s, 'note') }
  })
}

function validateDiagram(qid, idx, doc) {
  if (!isPlainObject(doc)) throw new SchemaError(`diagram ${qid}[${idx}]`, 'マッピングではありません')
  const id = requireString(`diagram ${qid}[${idx}]`, doc, 'id')
  const block = `diagram ${id}`
  const title = requireString(block, doc, 'title')
  const caption = optionalString(block, doc, 'caption')

  const groups = []
  if (doc.groups !== undefined && doc.groups !== null) {
    if (!Array.isArray(doc.groups)) throw new SchemaError(block, 'フィールド "groups" は配列でなければなりません')
    for (const [gi, g] of doc.groups.entries()) {
      const gb = `${block} groups[${gi}]`
      if (!isPlainObject(g)) throw new SchemaError(gb, 'マッピングではありません')
      groups.push({
        id: requireString(gb, g, 'id'),
        label: requireString(gb, g, 'label'),
        tone: validateTone(gb, g.tone),
      })
    }
  }
  const groupIds = new Set(groups.map((g) => g.id))
  if (groupIds.size !== groups.length) throw new SchemaError(block, 'group id が重複しています')

  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) {
    throw new SchemaError(block, '必須フィールド "nodes" が無いか空です')
  }
  const nodes = doc.nodes.map((n, ni) => {
    const nb = `${block} nodes[${ni}]`
    if (!isPlainObject(n)) throw new SchemaError(nb, 'マッピングではありません')
    const nid = requireString(nb, n, 'id')
    if (groupIds.has(nid)) throw new SchemaError(nb, `node id "${nid}" が group id と衝突しています`)
    const group = optionalString(nb, n, 'group')
    if (group !== undefined && !groupIds.has(group)) {
      throw new SchemaError(nb, `フィールド "group" が groups に存在しません (実際: ${group})`)
    }
    return {
      id: nid,
      label: requireString(nb, n, 'label'),
      group,
      tone: validateTone(nb, n.tone),
      dashed: validateBool(nb, n, 'dashed'),
      emphasis: validateBool(nb, n, 'emphasis'),
    }
  })
  const nodeIds = new Set(nodes.map((n) => n.id))
  if (nodeIds.size !== nodes.length) throw new SchemaError(block, 'node id が重複しています')

  const edges = []
  if (doc.edges !== undefined && doc.edges !== null) {
    if (!Array.isArray(doc.edges)) throw new SchemaError(block, 'フィールド "edges" は配列でなければなりません')
    for (const [ei, e] of doc.edges.entries()) {
      const eb = `${block} edges[${ei}]`
      if (!isPlainObject(e)) throw new SchemaError(eb, 'マッピングではありません')
      const from = requireString(eb, e, 'from')
      const to = requireString(eb, e, 'to')
      if (!nodeIds.has(from)) throw new SchemaError(eb, `フィールド "from" が nodes に存在しません (実際: ${from})`)
      if (!nodeIds.has(to)) throw new SchemaError(eb, `フィールド "to" が nodes に存在しません (実際: ${to})`)
      const kind = requireString(eb, e, 'kind')
      if (!EDGE_KINDS.has(kind)) {
        throw new SchemaError(eb, `フィールド "kind" は sync | async | reply のいずれかです (実際: ${kind})`)
      }
      edges.push({ from, to, label: optionalString(eb, e, 'label'), kind })
    }
  }

  // direction を書かなかった図は、列幅に収まる向きをレンダラーが選ぶ。
  // 明示した図（directionPinned）はその向きのまま描く。
  let direction = 'right'
  const directionPinned = doc.direction !== undefined && doc.direction !== null
  if (directionPinned) {
    direction = requireString(block, doc, 'direction')
    if (!DIRECTIONS.has(direction)) {
      throw new SchemaError(block, `フィールド "direction" は right | down のいずれかです (実際: ${direction})`)
    }
  }

  return { id, title, caption, groups, nodes, edges, direction, directionPinned }
}

function validateTone(block, tone) {
  if (tone === undefined || tone === null) return 'neutral'
  if (typeof tone !== 'string' || !TONES.has(tone)) {
    throw new SchemaError(block, `フィールド "tone" は ts | rs | new | neutral のいずれかです (実際: ${tone})`)
  }
  return tone
}

function validateBool(block, obj, field) {
  if (obj[field] === undefined || obj[field] === null) return false
  if (typeof obj[field] !== 'boolean') throw new SchemaError(block, `フィールド "${field}" は真偽値でなければなりません`)
  return obj[field]
}

// --- 散文からの抽出 -------------------------------------------------------

const WHY = /^\*\*なぜ今この判断か\*\*\s*[—-]\s*(.+)$/
const ABSTRACT = /^\*\*抽象\*\*\s*[—-]\s*(.+)$/

function extractProse(proseLines) {
  const lines = trimBlank(proseLines)
  let why_now = null
  let abstract = null
  let concrete = null
  const rest = []
  for (const line of lines) {
    const w = WHY.exec(line.trim())
    if (w) { why_now = w[1].trim(); continue }
    const a = ABSTRACT.exec(line.trim())
    if (a) {
      // 「抽象 — … ／ **具体** — …」の 1 行を 2 つに割る
      const m = /^(.*?)\s*[／/]\s*\*\*具体\*\*\s*[—-]\s*(.+)$/.exec(a[1])
      if (m) { abstract = m[1].trim(); concrete = m[2].trim() } else { abstract = a[1].trim() }
      continue
    }
    // 選択肢と推奨の行は question フェンス側が正本なので散文からは落とす
    if (/^\s*[-*]\s+\*\*/.test(line)) continue
    if (/^\*\*推奨\s*[:：]/.test(line.trim())) continue
    rest.push(line)
  }
  return { why_now, abstract, concrete, prose: trimBlank(rest) }
}

function trimBlank(lines) {
  const out = [...lines]
  while (out.length && out[0].trim() === '') out.shift()
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  return out
}

/** 設計ツリーから進捗を数える。 */
export function treeProgress(tree) {
  const count = { decided: 0, asked: 0, open: 0 }
  const walk = (nodes) => {
    for (const n of nodes) { count[n.state] += 1; walk(n.children) }
  }
  walk(tree)
  return count
}
