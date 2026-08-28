import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../bin/lib/yaml-lite.mjs'
import { validateIR, SEQUENCE_LIMITS, formatBudgetWarnings } from '../bin/lib/ir.mjs'
import { layoutSequence, renderSequenceDiagram } from '../bin/lib/sequence.mjs'
import { verifySequence } from '../bin/lib/verify-sequence.mjs'
import { renderFigureHtmlChecked } from '../bin/lib/verify-diagram.mjs'
import { unescapeIrScript } from '../bin/lib/ir-script.mjs'
import { renderSequence as renderSequenceDirective } from '../bin/lib/migrate/directives.mjs'
import { parse as parseYamlLite } from '../bin/lib/yaml-lite.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')

function ir(name) {
  const result = validateIR(parseYaml(fixture(name)))
  return result
}

function validIr(name) {
  const result = ir(name)
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byId = (checks, id) => checks.find((c) => c.id === id)

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// --- ir.mjs: schema + budgets -------------------------------------------

describe('ir.mjs: type: sequence schema', () => {
  test('a minimal valid sequence IR normalizes with rowType-tagged messages', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: [{ from: 'a', to: 'b', kind: 'sync', label: 'hi' }],
    })
    assert.equal(result.ok, true)
    assert.equal(result.ir.type, 'sequence')
    assert.deepEqual(result.ir.messages[0], { rowType: 'message', from: 'a', to: 'b', label: 'hi', kind: 'sync' })
  })

  test('participants must be a non-empty list', () => {
    const result = validateIR({ id: 's', type: 'sequence', title: 't', participants: [], messages: [] })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'schema')
  })

  test('a message requires "kind"', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: [{ from: 'a', to: 'b', label: 'hi' }],
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'schema')
    assert.match(result.message, /kind/)
  })

  test('a self-message defaults kind to sync', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }],
      messages: [{ self: 'a', label: 'x' }],
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.ir.messages[0], { rowType: 'self', participant: 'a', label: 'x', kind: 'sync' })
  })

  test('from and to must differ (use self: for a self-message)', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }],
      messages: [{ from: 'a', to: 'a', kind: 'sync' }],
    })
    assert.equal(result.ok, false)
    assert.match(result.message, /from and to must differ/)
  })

  test('a note infers "over" from the immediately preceding message when omitted', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: [
        { from: 'a', to: 'b', kind: 'sync', label: 'x' },
        { note: 'n' },
      ],
    })
    assert.equal(result.ok, true)
    assert.deepEqual(result.ir.messages[1], { rowType: 'note', text: 'n', over: ['a', 'b'] })
  })

  test('a note with no "over" and no preceding message is a schema error', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }],
      messages: [{ note: 'n' }],
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'schema')
    assert.match(result.message, /no preceding message/)
  })

  test('a note\'s "over" must reference declared participants', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }],
      messages: [{ note: 'n', over: ['ghost'] }],
    })
    assert.equal(result.ok, false)
    assert.match(result.message, /unknown participant/)
  })
})

describe('ir.mjs: sequence normalization is idempotent', () => {
  test('a normalized IR (rowType note/self/message) re-validates to the same rows', () => {
    const first = validateIR(parseYaml(fixture('seq-notes-self.yaml')))
    assert.equal(first.ok, true)
    const again = validateIR(JSON.parse(JSON.stringify(first.ir)))
    assert.equal(again.ok, true, JSON.stringify(again))
    assert.deepEqual(again.ir.messages, first.ir.messages)
  })
})

describe('ir.mjs: SEQUENCE_LIMITS budgets are advisory warnings', () => {
  test('more than 6 participants validates with a budget:participants warning and a split hint', () => {
    const result = ir('seq-too-many-participants.yaml')
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:participants=7'])
    assert.equal(result.warnings[0].limit, SEQUENCE_LIMITS.maxParticipants)
    assert.match(result.warnings[0].hint, /split/)
  })

  test('more than 16 message rows validates with a budget:messages warning', () => {
    const result = ir('seq-over-messages.yaml')
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:messages=17'])
    assert.match(result.warnings[0].hint, /split after message 16/)
  })

  test('a message label over 16 chars validates with a budget:label warning naming the message', () => {
    const result = ir('seq-label-too-long.yaml')
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:label=20'])
    assert.match(result.warnings[0].detail, /messages\[0\]\.label/)
    assert.match(result.warnings[0].hint, /shorten label of message 1/)
  })

  test('all three overruns warn at once, in stable participants → messages → label order', () => {
    const result = validateIR({
      id: 's', type: 'sequence', title: 't',
      participants: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, label: `P${i}` })),
      messages: Array.from({ length: 20 }, (_, i) => ({ from: 'p0', to: 'p1', kind: 'sync', label: i === 0 ? 'x'.repeat(23) : 'm' })),
    })
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:participants=7;budget:messages=20;budget:label=23')
  })

  test('exactly 6 participants and 16 messages both validate with no warning (at the limit, not over it)', () => {
    const six = ir('seq-six-participants.yaml')
    assert.equal(six.ok, true)
    assert.equal(six.ir.participants.length, 6)
    assert.deepEqual(six.warnings, [])
  })
})

// --- sequence.mjs: layout ------------------------------------------------

describe('sequence.mjs: layoutSequence', () => {
  test('participant boxes, lifelines, and rows are all on the 4px grid', () => {
    const layout = layoutSequence(validIr('seq-notes-self.yaml'))
    for (const p of layout.geo.participants) {
      for (const v of [p.x, p.y, p.width, p.height]) assert.equal(v % 4, 0, `participant ${p.id} off-grid`)
    }
    for (const ll of layout.geo.lifelines) {
      assert.equal(ll.x % 4, 0)
      assert.equal(ll.yTop % 4, 0)
      assert.equal(ll.yBottom % 4, 0)
    }
    assert.equal(layout.width % 4, 0)
    assert.equal(layout.height % 4, 0)
  })

  test('lifelines run the full height and rows are ordered top-to-bottom', () => {
    const layout = layoutSequence(validIr('seq-notes-self.yaml'))
    const ys = layout.geo.rows.map((r) => r.y)
    assert.deepEqual(ys, [...ys].sort((a, b) => a - b))
    for (const ll of layout.geo.lifelines) assert.ok(ll.yBottom > ll.yTop)
  })

  test('a note row spans from the leftmost to the rightmost of its "over" participants', () => {
    const layout = layoutSequence(validIr('seq-notes-self.yaml'))
    const note = layout.geo.rows.find((r) => r.type === 'note' && r.over.length === 2)
    assert.ok(note)
    const [a, b] = note.over.map((id) => layout.geo.lifelines.find((ll) => ll.id === id).x)
    const lo = Math.min(a, b), hi = Math.max(a, b)
    assert.ok(note.x <= lo && note.x + note.width >= hi)
  })

  test('a long message label widens the gap between its two lifelines instead of overlapping them', () => {
    const short = validIr('seq-simple.yaml')
    const long = structuredClone(short)
    long.messages[0].label = 'request(socV2s, entityType, template, filename)'
    const gapOf = (layout, from, to) => {
      const x = (id) => layout.geo.lifelines.find((ll) => ll.id === id).x
      return Math.abs(x(to) - x(from))
    }
    const { from, to } = long.messages[0]
    const before = layoutSequence(short)
    const after = layoutSequence(long)
    assert.ok(gapOf(after, from, to) > gapOf(before, from, to), 'the gap should grow to fit the label')
    const row = after.geo.rows[0]
    const lo = Math.min(row.path[0].x, row.path[1].x), hi = Math.max(row.path[0].x, row.path[1].x)
    assert.ok(row.label.x >= lo + 6, `label starts ${row.label.x}, lifeline at ${lo}`)
    assert.ok(row.label.x + row.label.width <= hi - 6, `label ends ${row.label.x + row.label.width}, lifeline at ${hi}`)
  })

  test('a long label on a→b never reaches the neighbouring lifeline c', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      messages: [{ from: 'a', to: 'b', kind: 'sync', label: 'とても長いメッセージラベルで隣の列まで届きそうな文' }],
    })
    assert.ok(v.ok)
    const layout = layoutSequence(v.ir)
    const c = layout.geo.lifelines.find((ll) => ll.id === 'c').x
    const label = layout.geo.rows[0].label
    assert.ok(label.x + label.width <= c - 6)
    const result = verifySequence(v.ir, renderSequenceDiagram(v.ir))
    assert.equal(byId(result.checks, 13).ok, true, JSON.stringify(byId(result.checks, 13)))
  })

  test('a long self-message label widens the gap to the next column', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: [{ self: 'a', label: '自分自身への長いラベル付き呼び出し' }],
    })
    assert.ok(v.ok)
    const layout = layoutSequence(v.ir)
    const b = layout.geo.lifelines.find((ll) => ll.id === 'b').x
    const label = layout.geo.rows[0].label
    assert.ok(label.x + label.width <= b - 6, `self label ends ${label.x + label.width}, lifeline b at ${b}`)
  })

  test('a wide note over one participant widens both neighbouring gaps and never overhangs the left edge', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      messages: [
        { note: 'とても長い注記がひとつの列の上に置かれて両隣まで届きそう', over: ['b'] },
        { note: '左端の列の上の長い注記', over: ['a'] },
      ],
    })
    assert.ok(v.ok)
    const layout = layoutSequence(v.ir)
    const x = (id) => layout.geo.lifelines.find((ll) => ll.id === id).x
    const [wide, left] = layout.geo.rows
    assert.ok(wide.x >= x('a') + 6 && wide.x + wide.width <= x('c') - 6)
    assert.ok(left.x >= 0, `note x=${left.x} runs off the left edge`)
    const result = verifySequence(v.ir, renderSequenceDiagram(v.ir))
    assert.equal(byId(result.checks, 13).ok, true, JSON.stringify(byId(result.checks, 13)))
  })

  test('a label over a lifeline its arrow crosses is masked with the surface color, not rejected', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      messages: [{ from: 'a', to: 'c', kind: 'sync', label: 'crossing b' }],
    })
    assert.ok(v.ok)
    const rendered = renderSequenceDiagram(v.ir)
    assert.deepEqual(rendered.layout.geo.rows[0].crosses, ['b'])
    assert.match(rendered.svg, /<rect [^>]*fill="var\(--wu-surface\)" stroke="none"\/><text id="wu-d-w-message-0-label"/)
    const result = verifySequence(v.ir, rendered)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
  })

  test('a note over one column followed by a labeled message into that column keeps label clearance (the real CSV-download page)', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'u', label: 'ユーザー' }, { id: 'fe', label: '画面 / Next.js' }, { id: 'job', label: 'CsvDownloadJobService' }],
      messages: [
        { from: 'job', to: 'fe', kind: 'reply', label: '受付' },
        { note: 'ダウンロード履歴画面へ遷移', over: ['fe'] },
        { from: 'u', to: 'fe', kind: 'sync', label: '準備完了後に「ダウンロード」' },
      ],
    })
    assert.ok(v.ok)
    const rendered = renderSequenceDiagram(v.ir)
    const [, note, next] = rendered.layout.geo.rows
    assert.ok(note.y + note.height + 6 <= next.label.y, `note bottom ${note.y + note.height} reaches the next label at ${next.label.y}`)
    const result = verifySequence(v.ir, rendered)
    assert.deepEqual(result.failures, [])
  })

  test('a self row loops out to the right of its own lifeline and back', () => {
    const layout = layoutSequence(validIr('seq-notes-self.yaml'))
    const self = layout.geo.rows.find((r) => r.type === 'self')
    assert.ok(self)
    const ll = layout.geo.lifelines.find((l) => l.id === self.participant)
    assert.equal(self.path[0].x, ll.x)
    assert.ok(self.path[1].x > ll.x)
    assert.equal(self.path[3].x, ll.x)
  })
})

describe('sequence.mjs: renderSequenceDiagram', () => {
  test('6 participants with short labels scale down to fit the column, never scroll', () => {
    // Spec: "width fits 720px when ≤4 participants; otherwise scale down to
    // ≥0.78 or mark scroll" — 6 short-labeled participants is exactly the
    // "otherwise" case: the natural width exceeds 720, but not badly enough
    // to need the scroll fallback.
    const rendered = renderSequenceDiagram(validIr('seq-six-participants.yaml'))
    assert.ok(rendered.width > 720, `expected a 6-participant diagram to exceed 720px natively, got ${rendered.width}`)
    assert.equal(rendered.scroll, false)
    assert.equal(rendered.scaled, true)
  })

  test('scales down (or scrolls) once participant labels push the natural width past the column', () => {
    const wide = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, label: `参加者番号ラベルとても長い${i}` })),
      messages: [{ from: 'p0', to: 'p1', kind: 'sync' }],
    })
    assert.ok(wide.ok)
    const rendered = renderSequenceDiagram(wide.ir)
    assert.ok(rendered.scaled || rendered.scroll, 'a wide sequence should scale down or fall back to scroll')
  })

  test('every id in the svg is prefixed wu-d-<id>-', () => {
    const rendered = renderSequenceDiagram(validIr('seq-notes-self.yaml'))
    const ids = [...rendered.svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
    assert.ok(ids.length > 0)
    for (const id of ids) assert.ok(id.startsWith('wu-d-s3-'), `id ${id} not prefixed`)
  })
})

// --- verify-sequence.mjs ---------------------------------------------------

describe('verify-sequence.mjs', () => {
  const goodIr = () => validIr('seq-notes-self.yaml')
  const goodRender = () => renderSequenceDiagram(goodIr())

  test('a real render of every fixture that validates passes every check', () => {
    for (const name of ['seq-simple.yaml', 'seq-six-participants.yaml', 'seq-notes-self.yaml']) {
      const validated = validIr(name)
      const rendered = renderSequenceDiagram(validated)
      const result = verifySequence(validated, rendered)
      const failing = result.checks.filter((c) => !c.ok)
      assert.deepEqual(failing, [], `${name}: unexpected failures ${JSON.stringify(failing)}`)
      assert.equal(result.ok, true)
    }
  })

  test('every row carries a severity: #1–#3 are warn, everything else fail', () => {
    const result = verifySequence(goodIr(), goodRender())
    for (const c of result.checks) assert.equal(c.severity, c.id <= 3 ? 'warn' : 'fail', `#${c.id} ${c.name}`)
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.warnings, [])
  })

  test('#1 participant-count warns (ok stays true) when the ir carries more than 6', () => {
    const bigIr = { ...goodIr(), participants: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, tone: 'neutral' })) }
    const result = verifySequence(bigIr, goodRender())
    const c = byId(result.checks, 1)
    assert.equal(c.ok, false)
    assert.equal(c.severity, 'warn')
    assert.equal(c.key, 'budget:participants')
    assert.equal(c.value, 7)
    assert.equal(result.warnings.length, 1)
    assert.equal(result.warnings[0].key, 'budget:participants')
    assert.ok(!result.failures.some((f) => f.id === 1))
  })

  test('#2 message-count warns when the ir carries more than 16 rows', () => {
    const manyIr = { ...goodIr(), messages: Array.from({ length: 17 }, () => ({ rowType: 'message', from: 'sched', to: 'api', label: '', kind: 'sync' })) }
    const result = verifySequence(manyIr, goodRender())
    assert.equal(byId(result.checks, 2).ok, false)
    assert.equal(byId(result.checks, 2).severity, 'warn')
    assert.match(byId(result.checks, 2).hint, /split after message 16/)
  })

  test('#3 label-length warns on a message label over 16 chars, with a "shorten label of message N" hint', () => {
    const longIr = structuredClone(goodIr())
    longIr.messages[0].label = 'この文はとても長くて十六文字を超えます'
    const result = verifySequence(longIr, goodRender())
    const c = byId(result.checks, 3)
    assert.equal(c.ok, false)
    assert.equal(c.severity, 'warn')
    assert.match(c.hint, /shorten label of message 1/)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:label=19'])
  })

  test('#4 references-exist fails when a message references an unknown participant', () => {
    const badIr = structuredClone(goodIr())
    badIr.messages[0].to = 'ghost'
    const result = verifySequence(badIr, goodRender())
    assert.equal(byId(result.checks, 4).ok, false)
  })

  test('#5 arrows-horizontal fails when a message path is diagonal', () => {
    const bad = structuredClone(goodRender())
    const msgRow = bad.layout.geo.rows.find((r) => r.type === 'message')
    msgRow.path[1] = { x: msgRow.path[1].x, y: msgRow.path[1].y + 8 }
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 5).ok, false)
  })

  test('#5 arrows-horizontal passes a self-message loop (vertical middle leg is expected)', () => {
    const result = verifySequence(goodIr(), goodRender())
    assert.equal(byId(result.checks, 5).ok, true)
  })

  test('#6 rows-grid fails when a coordinate is off the 4px grid', () => {
    const bad = structuredClone(goodRender())
    bad.layout.geo.participants[0].x += 1
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 6).ok, false)
  })

  test('#7 label-clearance fails when two labels are moved on top of each other', () => {
    const bad = structuredClone(goodRender())
    const labeled = bad.layout.geo.rows.filter((r) => r.label)
    assert.ok(labeled.length >= 2, 'fixture needs at least 2 labeled rows for this test')
    labeled[1].label.x = labeled[0].label.x
    labeled[1].label.y = labeled[0].label.y
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 7).ok, false)
  })

  test('#7 label-clearance is about labels only: a label pushed onto a lifeline is #13, not #7', () => {
    const bad = structuredClone(goodRender())
    const msg = bad.layout.geo.rows.find((r) => r.type === 'message' && r.label)
    const other = bad.layout.geo.lifelines.find((ll) => ll.id !== msg.from && ll.id !== msg.to)
      ?? bad.layout.geo.lifelines.find((ll) => ll.id === msg.to)
    msg.label.x = other.x - 4
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 7).ok, true)
    assert.equal(byId(result.checks, 13).ok, false)
    assert.match(byId(result.checks, 13).detail, new RegExp(`lifeline "${other.id}"`))
  })

  test('#13 lifeline-clearance catches a message label widened over the neighbouring lifeline', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
      messages: [{ from: 'a', to: 'b', kind: 'sync', label: 'ok' }],
    })
    const bad = structuredClone(renderSequenceDiagram(v.ir))
    const c = bad.layout.geo.lifelines.find((ll) => ll.id === 'c').x
    bad.layout.geo.rows[0].label.width = c - bad.layout.geo.rows[0].label.x + 4
    const result = verifySequence(v.ir, bad)
    assert.equal(byId(result.checks, 13).ok, false)
    assert.equal(result.ok, false)
    assert.ok(result.failures.some((f) => f.name === 'lifeline-clearance'))
  })

  test('#13 lifeline-clearance catches a note box that reaches a lifeline outside its "over" span', () => {
    const v = validateIR({
      id: 'w', type: 'sequence', title: 't',
      participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      messages: [{ note: 'n', over: ['a'] }],
    })
    const bad = structuredClone(renderSequenceDiagram(v.ir))
    const note = bad.layout.geo.rows[0]
    const b = bad.layout.geo.lifelines.find((ll) => ll.id === 'b')
    note.width = b.x + 4 - note.x
    const result = verifySequence(v.ir, bad)
    assert.equal(byId(result.checks, 13).ok, false)
    assert.match(byId(result.checks, 13).detail, /note\[0\] is 0\.0px from lifeline "b"/)
  })

  test('#14 projected-scale fails when a hand-built result is too wide for the column without the scroll fallback', () => {
    const bad = structuredClone(goodRender())
    bad.width = 2000
    bad.scroll = false
    const result = verifySequence(goodIr(), bad, { column: 720 })
    assert.equal(byId(result.checks, 14).ok, false)
    bad.scroll = true
    assert.equal(byId(verifySequence(goodIr(), bad, { column: 720 }).checks, 14).ok, true)
  })

  test('#8 font-size fails on an ad-hoc font-size in the svg', () => {
    const bad = structuredClone(goodRender())
    bad.svg = bad.svg.replace('font-size="13"', 'font-size="12"')
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 8).ok, false)
  })

  test('#9 stroke-width fails on an ad-hoc stroke-width in the svg', () => {
    const bad = structuredClone(goodRender())
    bad.svg = bad.svg.replace('stroke-width="1"', 'stroke-width="2"')
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 9).ok, false)
  })

  test('#10 no-hex-colors fails on a literal hex color in the svg', () => {
    const bad = structuredClone(goodRender())
    bad.svg = bad.svg.replace('fill="currentColor"', 'fill="#112233"')
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 10).ok, false)
  })

  test('#11 single-finite-svg fails when the markup contains NaN', () => {
    const bad = structuredClone(goodRender())
    bad.svg = bad.svg.replace('viewBox', 'data-x="NaN" viewBox')
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 11).ok, false)
  })

  test('#12 a11y fails when an id is not prefixed wu-d-<id>-', () => {
    const bad = structuredClone(goodRender())
    bad.svg = bad.svg.replace(/id="wu-d-s3-p-sched"/, 'id="rogue-id"')
    const result = verifySequence(goodIr(), bad)
    assert.equal(byId(result.checks, 12).ok, false)
  })
})

// --- verify-diagram.mjs dispatch (renderFigureHtmlChecked) -----------------

describe('verify-diagram.mjs: renderFigureHtmlChecked dispatches type: sequence', () => {
  test('a sequence IR renders a data-checks="pass" data-type="sequence" figure', async () => {
    const rendered = await renderFigureHtmlChecked(validIr('seq-simple.yaml'), { rawYaml: fixture('seq-simple.yaml') })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="sequence">/)
    assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
  })

  test('the three over-budget fixtures render as passing figures carrying data-warn, with every geometry row green', async () => {
    const expected = {
      'seq-over-messages.yaml': 'budget:messages=17',
      'seq-label-too-long.yaml': 'budget:label=20',
      'seq-too-many-participants.yaml': 'budget:participants=7',
    }
    for (const [name, warn] of Object.entries(expected)) {
      const rendered = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.deepEqual(rendered.failures, [], name)
      assert.equal(rendered.warn, warn, name)
      assert.ok(rendered.html.startsWith(`<figure class="wu-figure" data-checks="pass" data-warn="${warn}" data-type="sequence">`), `${name}: ${rendered.html.slice(0, 120)}`)
      const geometry = rendered.checks.filter((c) => c.severity === 'fail')
      assert.ok(geometry.every((c) => c.ok), `${name}: ${JSON.stringify(geometry.filter((c) => !c.ok))}`)
    }
  })

  test('the 7-participant fixture goes through the same scale/scroll decision as a node diagram', async () => {
    const rendered = await renderFigureHtmlChecked(validIr('seq-too-many-participants.yaml'))
    assert.ok(rendered.width > 720)
    assert.ok(rendered.scaled || rendered.scroll)
    if (rendered.scroll) assert.match(rendered.html, /data-scroll="true"/)
    assert.equal(rendered.checks.find((c) => c.name === 'projected-scale').ok, true)
  })

  test('the embedded script round-trips back to the same IR', async () => {
    const raw = fixture('seq-simple.yaml')
    const validated = validateIR(parseYaml(raw))
    const rendered = await renderFigureHtmlChecked(validated.ir, { rawYaml: raw })
    const scriptMatch = /<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>/.exec(rendered.html)
    assert.ok(scriptMatch)
    const roundTripped = validateIR(parseYamlLite(unescapeIrScript(scriptMatch[1])))
    assert.ok(roundTripped.ok)
    assert.equal(roundTripped.ir.id, validated.ir.id)
    assert.equal(roundTripped.ir.type, 'sequence')
  })

  test('a diagram IR (type omitted) is unaffected by the sequence dispatch', async () => {
    const raw = fixture('simple.yaml')
    const validated = validateIR(parseYaml(raw))
    const rendered = await renderFigureHtmlChecked(validated.ir, { rawYaml: raw })
    assert.equal(rendered.checksOk, true)
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass">/)
    assert.ok(!rendered.html.startsWith('<figure class="wu-figure" data-checks="pass" data-type='))
  })
})

// --- render-diagram.mjs CLI --------------------------------------------

describe('render-diagram.mjs CLI: type sequence', () => {
  test('--figure prints a verified sequence figure', () => {
    const r = runCli([join(HERE, 'fixtures', 'seq-simple.yaml'), '--figure'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="sequence">/)
    assert.match(r.stdout, /<svg /)
  })

  test('a budget overrun still exits 0 with a data-warn figure, and echoes the warning on stderr', () => {
    const r = runCli([join(HERE, 'fixtures', 'seq-over-messages.yaml'), '--figure'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:messages=17" data-type="sequence">/)
    assert.match(r.stderr, /warning: budget:messages=17 \(#2 message-count\)/)
  })

  test('--json on an over-budget sequence reports ok:true plus warnings and the data-warn string', () => {
    const r = runCli([join(HERE, 'fixtures', 'seq-too-many-participants.yaml'), '--json'])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.equal(out.warn, 'budget:participants=7')
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:participants'])
    assert.match(out.figureHtml, /data-warn="budget:participants=7" data-type="sequence"/)
  })

  test('--json figureHtml is the verified sequence figure', () => {
    const r = runCli([join(HERE, 'fixtures', 'seq-simple.yaml'), '--json'])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.match(out.figureHtml, /data-type="sequence"/)
  })
})

// --- migration: old-sequence.mjs DSL -> type: sequence figure -------------

describe('directives.mjs: renderSequence migration', () => {
  const ctx = () => ({ nextDiagramId: () => 'd1', sectionTitle: 'テストセクション', column: 720 })

  test('a sequence within budget renders a wu-figure sequence diagram, not a steps list', async () => {
    const body = 'participant u[ユーザー]\nparticipant s[サーバー]\nu -> s : リクエスト送信\ns --> u : レスポンス返却'
    const { html, warnings, figureOk } = await renderSequenceDirective({ body }, ctx())
    assert.equal(figureOk, true)
    assert.equal(warnings.length, 0)
    assert.match(html, /^<figure class="wu-figure" data-checks="pass" data-type="sequence">/)
    assert.ok(!html.includes('class="wu-steps"'))
  })

  test('a sequence over budget still renders as a figure with data-warn, the warning recorded for the report', async () => {
    const lines = ['participant u[ユーザー]', 'participant s[サーバー]']
    for (let i = 0; i < 17; i++) lines.push(`u -> s : m${i}`)
    const { html, warnings, figureOk } = await renderSequenceDirective({ body: lines.join('\n') }, ctx())
    assert.equal(figureOk, true)
    assert.deepEqual(warnings, ['sequence: budget warning — budget:messages=17 (17 row(s) (guidance ≤ 16))'])
    assert.match(html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:messages=17" data-type="sequence">/)
    assert.ok(!html.includes('class="wu-steps"'))
    const scriptMatch = /<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>/.exec(html)
    assert.ok(scriptMatch)
    const parsed = parseYamlLite(unescapeIrScript(scriptMatch[1]))
    assert.equal(parsed.type, 'sequence')
    assert.equal(parsed.messages.length, 17)
  })

  test('a long old-DSL label (the real CSV-download page) renders with budget:label and a widened gap', async () => {
    const body = [
      'participant u[ユーザー]', 'participant fe[画面 / Next.js]', 'participant job[CsvDownloadJobService]',
      'u -> fe : 組織を絞って「ダウンロード」',
      'fe -> job : request(socV2s, entityType, template, filename)',
      'job --> fe : 受付 {tone=success}',
      'note over fe : ダウンロード履歴画面へ遷移',
    ].join('\n')
    const { html, warnings, figureOk } = await renderSequenceDirective({ body }, ctx())
    assert.equal(figureOk, true)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /budget:label=47/)
    assert.match(html, /^<figure class="wu-figure" data-checks="pass" data-warn="budget:label=47" data-type="sequence">/)
  })

  test('a note maps to a single-participant "over" list', async () => {
    const body = 'participant u[ユーザー]\nparticipant s[サーバー]\nu -> s : リクエスト\nnote over s : ここでログを書く'
    const { html, figureOk } = await renderSequenceDirective({ body }, ctx())
    assert.equal(figureOk, true)
    assert.match(html, /ここでログを書く/)
  })
})
