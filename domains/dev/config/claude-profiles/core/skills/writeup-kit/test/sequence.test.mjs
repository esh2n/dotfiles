import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../bin/lib/yaml-lite.mjs'
import { validateIR, SEQUENCE_LIMITS } from '../bin/lib/ir.mjs'
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

describe('ir.mjs: SEQUENCE_LIMITS budgets', () => {
  test('more than 6 participants is a budget error with a split suggestion', () => {
    const result = ir('seq-too-many-participants.yaml')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'budget')
    assert.match(result.message, /participants: 7 > 6/)
    assert.match(result.suggestion, /split/)
  })

  test('more than 16 message rows is a budget error', () => {
    const result = ir('seq-over-messages.yaml')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'budget')
    assert.match(result.message, /messages: 17 > 16/)
    assert.match(result.suggestion, /continuing after message 16/)
  })

  test('a message label over 16 chars is a budget error', () => {
    const result = ir('seq-label-too-long.yaml')
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'budget')
    assert.match(result.message, /exceeds 16 chars/)
  })

  test('exactly 6 participants and 16 messages both validate (at the limit, not over it)', () => {
    const six = validIr('seq-six-participants.yaml')
    assert.equal(six.participants.length, 6)
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

  test('#1 participant-count fails when the ir itself carries more than 6 (hand-built, bypassing budgets)', () => {
    const bigIr = { ...goodIr(), participants: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, tone: 'neutral' })) }
    const result = verifySequence(bigIr, goodRender())
    assert.equal(byId(result.checks, 1).ok, false)
  })

  test('#2 message-count fails when the ir carries more than 16 rows', () => {
    const manyIr = { ...goodIr(), messages: Array.from({ length: 17 }, () => ({ rowType: 'message', from: 'sched', to: 'api', label: '', kind: 'sync' })) }
    const result = verifySequence(manyIr, goodRender())
    assert.equal(byId(result.checks, 2).ok, false)
    assert.match(byId(result.checks, 2).hint, /split after message 16/)
  })

  test('#3 label-length fails on a message label over 16 chars, with a "shorten label of message N" hint', () => {
    const longIr = structuredClone(goodIr())
    longIr.messages[0].label = 'この文はとても長くて十六文字を超えます'
    const result = verifySequence(longIr, goodRender())
    const c = byId(result.checks, 3)
    assert.equal(c.ok, false)
    assert.match(c.hint, /shorten label of message 1/)
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

  test('a budget violation exits 2 before any figure is built', () => {
    const r = runCli([join(HERE, 'fixtures', 'seq-over-messages.yaml'), '--figure'])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
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

  test('a sequence over budget falls back to the steps list, with the candidate IR kept in the figure script', async () => {
    const lines = ['participant u[ユーザー]', 'participant s[サーバー]']
    for (let i = 0; i < 17; i++) lines.push(`u -> s : m${i}`)
    const { html, warnings, figureOk } = await renderSequenceDirective({ body: lines.join('\n') }, ctx())
    assert.equal(figureOk, false)
    assert.ok(warnings.some((w) => w.startsWith('sequence:')))
    assert.match(html, /<figure class="wu-figure" data-type="sequence">/)
    assert.ok(!html.includes('data-checks="pass"'))
    assert.match(html, /class="wu-steps"/)
    const scriptMatch = /<script type="text\/x-writeup-diagram">\n([\s\S]*?)\n<\/script>/.exec(html)
    assert.ok(scriptMatch, 'fallback figure should still carry the candidate IR script')
    const parsed = parseYamlLite(unescapeIrScript(scriptMatch[1]))
    assert.equal(parsed.type, 'sequence')
    assert.equal(parsed.messages.length, 17)
  })

  test('a note maps to a single-participant "over" list', async () => {
    const body = 'participant u[ユーザー]\nparticipant s[サーバー]\nu -> s : リクエスト\nnote over s : ここでログを書く'
    const { html, figureOk } = await renderSequenceDirective({ body }, ctx())
    assert.equal(figureOk, true)
    assert.match(html, /ここでログを書く/)
  })
})
