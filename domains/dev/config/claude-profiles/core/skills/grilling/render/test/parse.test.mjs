import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseRound, SchemaError, treeProgress } from '../lib/parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')

test('round-format.md の記入例をそのまま読める', () => {
  const r = parseRound(fixture('round-example.md'))
  assert.equal(r.frontmatter.slug, 'session-token-storage')
  assert.equal(r.frontmatter.round, 2)
  assert.equal(r.frontmatter.status, 'answered')
  assert.deepEqual(r.questions.map((q) => q.id), ['q3', 'q4'])
  assert.equal(r.questions[0].options.length, 2)
  assert.equal(r.questions[0].recommended, 'A')
  assert.match(r.questions[0].answer, /^A — 15分で。/)
  assert.equal(r.questions[0].sources.length, 2)
  assert.equal(r.premise, null)
  assert.deepEqual(treeProgress(r.tree), { decided: 1, asked: 2, open: 2 })
  assert.match(r.questions[0].rationale, /漏洩の窓を決めているのは期限だけ/)
  assert.deepEqual(r.tree[0].children.map((n) => n.asks), [undefined, 'q3', 'q4'])
})

test('散文から なぜ今 / 抽象 / 具体 を取り出す', () => {
  const r = parseRound(fixture('round-example.md'))
  const q = r.questions[0]
  assert.match(q.why_now, /httpOnly Cookie に決まった/)
  assert.match(q.abstract, /漏洩時の被害時間/)
  assert.match(q.concrete, /src\/auth\/session\.ts:42/)
  // 選択肢と推奨の行は question フェンスが正本なので散文からは落とす
  assert.equal(q.prose.length, 0)
})

test('前提 と diagram と groups を読める', () => {
  const r = parseRound(fixture('round-diagram.md'))
  assert.deepEqual(r.premise.rows.map((x) => x.key), ['task', 'decided', 'why_now', 'unblocks'])
  assert.ok(r.premise.prose.length > 0)
  const d = r.questions[0].diagrams[0]
  assert.equal(d.id, 'd1')
  assert.equal(d.title, '現在地')
  assert.equal(d.direction, 'right')
  assert.equal(d.groups.length, 2)
  assert.equal(d.nodes.length, 5)
  assert.equal(d.edges.length, 5)
  assert.equal(d.nodes.find((n) => n.id === 'future').dashed, true)
  assert.equal(d.nodes.find((n) => n.id === 'sdk').emphasis, true)
  assert.equal(d.nodes.find((n) => n.id === 'idp').tone, 'neutral')
})

// --- スキーマ違反はブロック名つきで報告する -------------------------------

const bad = (src) => {
  try { parseRound(src); return null } catch (e) { return e }
}

const MINIMAL_HEAD = `---
slug: s
round: 1
target: t
status: open
---

## 設計ツリー

\`\`\`tree
- id: root
  label: r
  state: open
\`\`\`
`

const withQuestion = (questionYaml, extra = '') => `${MINIMAL_HEAD}
### ❓ Q1: 何かを決める
**なぜ今この判断か** — いま決める。
${extra}
\`\`\`question
${questionYaml}
\`\`\`
`

test('question フェンスの欠けたフィールドはブロック id つきで報告される', () => {
  const e = bad(withQuestion(`id: q1
options:
  - key: A
    label: a
    gains: g
    loses: l
prioritized_tradeoff: x`))
  assert.ok(e instanceof SchemaError)
  assert.equal(e.block, 'question q1')
  assert.match(e.message, /\[question q1\]/)
  assert.match(e.message, /recommended/)
})

test('recommended が options に無ければ報告される', () => {
  const e = bad(withQuestion(`id: q1
options:
  - key: A
    label: a
    gains: g
    loses: l
recommended: Z
prioritized_tradeoff: x
rationale: なぜなら`))
  assert.match(e.message, /\[question q1\]/)
  assert.match(e.message, /recommended/)
})

test('見出し番号と question の id がずれていれば報告される', () => {
  const e = bad(withQuestion(`id: q7
options:
  - key: A
    label: a
    gains: g
    loses: l
recommended: A
prioritized_tradeoff: x
rationale: なぜなら`))
  assert.match(e.message, /\[question q1\]/)
  assert.match(e.message, /q7/)
})

const GOOD_Q = `id: q1
options:
  - key: A
    label: a
    gains: g
    loses: l
recommended: A
prioritized_tradeoff: x
rationale: なぜなら`

const withDiagram = (diagramYaml) => withQuestion(GOOD_Q, `\n\`\`\`diagram\n${diagramYaml}\n\`\`\`\n`)

test('diagram の未知の tone は diagram id つきで報告される', () => {
  const e = bad(withDiagram(`id: d1
title: 図
nodes:
  - id: a
    label: A
    tone: purple`))
  assert.match(e.message, /\[diagram d1 nodes\[0\]\]/)
  assert.match(e.message, /tone/)
})

test('diagram の辺が存在しないノードを指したら報告される', () => {
  const e = bad(withDiagram(`id: d1
title: 図
nodes:
  - id: a
    label: A
edges:
  - from: a
    to: zzz
    kind: sync`))
  assert.match(e.message, /\[diagram d1 edges\[0\]\]/)
  assert.match(e.message, /"to"/)
})

test('diagram の title 欠けは必須フィールドとして報告される', () => {
  const e = bad(withDiagram(`id: d1
nodes:
  - id: a
    label: A`))
  assert.match(e.message, /\[diagram d1\]/)
  assert.match(e.message, /title/)
})

test('diagram の未知の edge kind は報告される', () => {
  const e = bad(withDiagram(`id: d1
title: 図
nodes:
  - id: a
    label: A
  - id: b
    label: B
edges:
  - from: a
    to: b
    kind: broadcast`))
  assert.match(e.message, /\[diagram d1 edges\[0\]\]/)
  assert.match(e.message, /kind/)
})

test('premise の未知フィールドは報告される', () => {
  const src = `---
slug: s
round: 1
target: t
status: open
---

## 前提

前置き。

\`\`\`premise
task: x
owner: だれか
\`\`\`

## 設計ツリー

\`\`\`tree
- id: root
  label: r
  state: open
\`\`\`

### ❓ Q1: 何か
**なぜ今この判断か** — いま。

\`\`\`question
${GOOD_Q}
\`\`\`
`
  const e = bad(src)
  assert.equal(e.block, 'premise')
  assert.match(e.message, /owner/)
})

test('frontmatter の status が不正なら報告される', () => {
  const e = bad(withQuestion(GOOD_Q).replace('status: open', 'status: draft'))
  assert.equal(e.block, 'frontmatter')
  assert.match(e.message, /status/)
})

test('tree の未知の state は node id つきで報告される', () => {
  const e = bad(withQuestion(GOOD_Q).replace('  state: open', '  state: pending'))
  assert.match(e.message, /\[tree root\]/)
  assert.match(e.message, /state/)
})

test('diagram フェンスが question より後ろにあれば報告される', () => {
  const src = `${MINIMAL_HEAD}
### ❓ Q1: 何か
**なぜ今この判断か** — いま。

\`\`\`question
${GOOD_Q}
\`\`\`

\`\`\`diagram
id: d1
title: 図
nodes:
  - id: a
    label: A
\`\`\`
`
  const e = bad(src)
  assert.equal(e.block, 'diagram')
  assert.match(e.message, /question フェンスより前/)
})

test('round-format.md に載っている記入例が実際に読める（ドキュメントとの乖離検知）', () => {
  const doc = readFileSync(join(HERE, '..', '..', 'references', 'round-format.md'), 'utf8')
  const m = /^````markdown\n([\s\S]*?)\n````$/m.exec(doc)
  assert.ok(m, 'round-format.md に ````markdown の記入例が無い')
  const r = parseRound(m[1])
  assert.equal(r.frontmatter.slug, 'session-token-storage')
  assert.ok(r.premise, '記入例に 前提 が無い')
  assert.equal(r.questions.length, 2)
  assert.equal(r.questions[0].diagrams.length, 1)
  assert.deepEqual(
    [...new Set(r.questions[0].diagrams[0].edges.map((e) => e.kind))].sort(),
    ['async', 'reply', 'sync'],
  )
})

test('rationale が無ければ question ブロックとして報告される', () => {
  const e = bad(withQuestion(`id: q1
options:
  - key: A
    label: a
    gains: g
    loses: l
recommended: A
prioritized_tradeoff: x`))
  assert.ok(e instanceof SchemaError)
  assert.equal(e.block, 'question q1')
  assert.match(e.message, /rationale/)
})

test('rationale は複数行の散文として保持される', () => {
  const r = parseRound(fixture('round-diagram.md'))
  const lines = r.questions[0].rationale.trim().split('\n')
  assert.ok(lines.length >= 3, `2〜4文を期待したが ${lines.length} 行`)
})

test('tree の asks は問いの id でなければならない', () => {
  const e = bad(withQuestion(GOOD_Q).replace('  state: open', '  state: asked\n  asks: いろいろ'))
  assert.match(e.message, /\[tree root\]/)
  assert.match(e.message, /asks/)
})

test('tree の asks は省略できる', () => {
  const r = parseRound(withQuestion(GOOD_Q))
  assert.equal(r.tree[0].asks, undefined)
})

test('direction を書いたかどうかを保持する', () => {
  const pinned = parseRound(withQuestion(GOOD_Q, `
\`\`\`diagram
id: d1
title: 図
direction: down
nodes:
  - id: a
    label: A
\`\`\`
`))
  assert.equal(pinned.questions[0].diagrams[0].directionPinned, true)
  assert.equal(pinned.questions[0].diagrams[0].direction, 'down')

  const auto = parseRound(fixture('round-diagram.md'))
  assert.equal(auto.questions[0].diagrams[0].directionPinned, false)
  assert.equal(auto.questions[0].diagrams[0].direction, 'right')
})
