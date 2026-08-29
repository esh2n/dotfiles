// `type: sankey` — schema, budgets, layout (proportional ribbons, stacked
// bars, footnotes), every verify row failing on a mutated render, the
// registry dispatch and the CLI. Fixtures: test/fixtures/sankey-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as sankey from '../../bin/lib/figures/sankey.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { COLUMN } from '../../bin/lib/diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')
const FIXTURES = join(ROOT, 'test', 'fixtures')
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8')

function validIr(name) {
  const result = validateIR(parseYaml(fixture(name)))
  assert.ok(result.ok, `fixture ${name} failed to validate: ${JSON.stringify(result)}`)
  return result.ir
}

const byName = (checks, name) => checks.find((c) => c.name === name)
const plugin = () => getFigureType('sankey')

function rawIr(overrides = {}) {
  return {
    id: 's', type: 'sankey', title: 't',
    nodes: [{ id: 'a', label: 'A', stage: 0 }, { id: 'b', label: 'B', stage: 0 }, { id: 'c', label: 'C', stage: 1 }],
    links: [{ from: 'a', to: 'c', value: 10 }, { from: 'b', to: 'c', value: 5 }],
    ...overrides,
  }
}

async function rendered(name) {
  const ir = validIr(name)
  const r = await renderFigure(plugin(), ir)
  return { ir, r }
}

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// --- schema ---------------------------------------------------------------

describe('figures/sankey.mjs: schema', () => {
  test('a minimal IR normalizes: emphasis defaults to false, unit/caption/label stay absent, no warnings', () => {
    const result = validateIR(rawIr())
    assert.equal(result.ok, true, result.message)
    assert.equal(result.ir.type, 'sankey')
    assert.deepEqual(result.ir.nodes[0], { id: 'a', label: 'A', stage: 0, emphasis: false })
    assert.deepEqual(result.ir.links[0], { from: 'a', to: 'c', value: 10 })
    assert.equal('unit' in result.ir, false)
    assert.deepEqual(result.warnings, [])
    const full = validateIR(rawIr({ unit: '件', links: [{ from: 'a', to: 'c', value: 1.5, label: 'x' }] }))
    assert.equal(full.ir.unit, '件')
    assert.deepEqual(full.ir.links[0], { from: 'a', to: 'c', value: 1.5, label: 'x' })
  })

  test('normalize is idempotent on every fixture', () => {
    for (const name of ['sankey-simple.yaml', 'sankey-full.yaml', 'sankey-over-budget.yaml']) {
      const once = sankey.normalize(parseYaml(fixture(name)))
      assert.deepEqual(sankey.normalize(once), once, name)
    }
  })

  test('unknown node refs, backward links, non-positive values, bad stages, one stage and duplicate ids are schema errors', () => {
    const bad = (overrides) => { const r = validateIR(rawIr(overrides)); assert.equal(r.ok, false); assert.equal(r.reason, 'schema'); return r.message }
    assert.match(bad({ links: [{ from: 'a', to: 'zz', value: 1 }] }), /links\[0\]\.to references unknown node "zz"/)
    assert.match(bad({ links: [{ from: 'c', to: 'a', value: 1 }] }), /"c" \(stage 1\) must flow to a later stage than "a" \(stage 0\)/)
    assert.match(bad({ links: [{ from: 'a', to: 'b', value: 1 }] }), /must flow to a later stage/)
    assert.match(bad({ links: [{ from: 'a', to: 'c', value: 0 }] }), /links\[0\]\.value must be a positive finite number/)
    assert.match(bad({ links: [{ from: 'a', to: 'c', value: 'many' }] }), /links\[0\]\.value must be a positive finite number/)
    assert.match(bad({ nodes: [{ id: 'a', label: 'A', stage: -1 }, { id: 'c', label: 'C', stage: 1 }] }), /nodes\[0\]\.stage must be a non-negative integer/)
    assert.match(bad({ nodes: [{ id: 'a', label: 'A', stage: 0.5 }, { id: 'c', label: 'C', stage: 1 }] }), /nodes\[0\]\.stage must be a non-negative integer/)
    assert.match(bad({ nodes: [{ id: 'a', label: 'A', stage: 0 }, { id: 'c', label: 'C', stage: 0 }] }), /at least 2 distinct stages/)
    assert.match(bad({ nodes: [{ id: 'a', label: 'A', stage: 0 }, { id: 'a', label: 'A2', stage: 1 }] }), /duplicate node id: "a"/)
    assert.match(bad({ links: [] }), /links must be a non-empty list/)
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/sankey.mjs: budgets', () => {
  test('the over-budget fixture reports nodes, links, label and emphasis in a stable order', () => {
    const result = validateIR(parseYaml(fixture('sankey-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => [w.key, w.value, w.limit]), [
      ['budget:nodes', 13, 12], ['budget:links', 17, 16], ['budget:label', 13, 12], ['budget:emphasis', 3, 2],
    ])
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:nodes=13;budget:links=17;budget:label=13;budget:emphasis=3')
    assert.ok(result.warnings.every((w) => w.hint && w.hint !== w.detail))
    assert.deepEqual(sankey.budgetWarnings(validIr('sankey-full.yaml')), [])
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/sankey.mjs: layout', () => {
  test('layout is deterministic: two renders of the same IR are byte-identical', async () => {
    const a = await rendered('sankey-full.yaml')
    const b = await rendered('sankey-full.yaml')
    assert.equal(a.r.svg, b.r.svg)
    assert.deepEqual(a.r.layout, b.r.layout)
  })

  test('ribbon thickness and bar height are value × one shared scale; the tallest column reaches ~400px', async () => {
    const { ir, r } = await rendered('sankey-simple.yaml')
    const g = r.layout.geo
    for (const rb of g.ribbons) assert.ok(Math.abs(rb.thickness - rb.value * g.scale) <= 1, `${rb.from}→${rb.to}`)
    for (const nd of g.nodes) assert.ok(Math.abs(nd.height - nd.basis * g.scale) <= 1, nd.id)
    const colH = (c) => { const col = g.nodes.filter((n) => n.col === c); return Math.max(...col.map((n) => n.y + n.height)) - Math.min(...col.map((n) => n.y)) }
    const tallest = Math.max(colH(0), colH(1))
    assert.ok(tallest <= 400 && tallest >= 380, `tallest column ${tallest}`)
    assert.equal(ir.links.length, g.ribbons.length)
    assert.ok(r.width <= COLUMN, `width ${r.width}`)
    assert.equal(r.scaled, false)
  })

  test('bars stack in IR order with ≥ 12px gaps; ribbon slices tile each bar without overlapping', async () => {
    const { r } = await rendered('sankey-full.yaml')
    const g = r.layout.geo
    for (const c of g.stages.keys()) {
      const col = g.nodes.filter((n) => n.col === c)
      for (let j = 1; j < col.length; j++) {
        assert.ok(col[j].index > col[j - 1].index)
        assert.ok(col[j].y - (col[j - 1].y + col[j - 1].height) >= 12, `${col[j - 1].id}/${col[j].id}`)
      }
    }
    for (const nd of g.nodes) {
      const outs = g.ribbons.filter((rb) => rb.from === nd.id).sort((a, b) => a.fromTop - b.fromTop)
      let cursor = nd.y
      for (const rb of outs) { assert.ok(Math.abs(rb.fromTop - cursor) < 0.02, `${rb.from}→${rb.to} out slice`); cursor += rb.thickness }
      assert.ok(cursor <= nd.y + nd.height + 0.02, `${nd.id} out slices overflow the bar`)
      const ins = g.ribbons.filter((rb) => rb.to === nd.id).sort((a, b) => a.toTop - b.toTop)
      cursor = nd.y
      for (const rb of ins) { assert.ok(Math.abs(rb.toTop - cursor) < 0.02, `${rb.from}→${rb.to} in slice`); cursor += rb.thickness }
      assert.ok(cursor <= nd.y + nd.height + 0.02, `${nd.id} in slices overflow the bar`)
    }
  })

  test('thin or crowded ribbons list their value in a 細い流れ footnote; in ≠ out nodes in a 差分 footnote; the svg carries data-value and emphasis', async () => {
    const { r } = await rendered('sankey-full.yaml')
    const g = r.layout.geo
    const cdn = g.ribbons.find((rb) => rb.from === 'network' && rb.to === 'prod-b')
    assert.ok(cdn.thickness < 14)
    assert.equal(cdn.valueLabel, undefined)
    assert.equal(g.footnotes[0].text, '細い流れ: ネットワーク→プロダクト B CDN 2万円、共有基盤→未配賦 4万円')
    assert.equal(g.footnotes[1].text, '差分: 共有基盤 入 138万円 / 出 134万円')
    const labelled = g.ribbons.filter((rb) => rb.valueLabel)
    assert.ok(labelled.every((rb) => rb.thickness >= 14))
    assert.ok(labelled.some((rb) => rb.valueLabel.text === '利用量比 80万円'))
    assert.match(r.svg, /<path id="wu-d-sk2-r-0" data-value="90"/)
    assert.match(r.svg, /<rect id="wu-d-sk2-n-prod-a" class="wu-focal"[^>]*stroke="var\(--wu-accent\)"/)
    assert.match(r.svg, /<path id="wu-d-sk2-r-6"[^>]*fill-opacity="0.24" stroke="var\(--wu-accent\)"/)
    assert.match(r.svg, /<path id="wu-d-sk2-r-0"[^>]*fill-opacity="0.12" stroke="none"/)
    assert.match(r.svg, /<text id="wu-d-sk2-foot-1"[^>]*>差分: /)
    assert.doesNotMatch(r.svg, /marker-end/)
  })

  test('a balanced simple flow has no footnote and every ribbon carries its value on the ribbon', async () => {
    const { r } = await rendered('sankey-simple.yaml')
    assert.deepEqual(r.layout.geo.footnotes, [])
    assert.ok(r.layout.geo.ribbons.every((rb) => rb.valueLabel))
    assert.doesNotMatch(r.svg, /foot-/)
  })
})

// --- verify rows ----------------------------------------------------------

describe('figures/sankey.mjs: verify rows fail on a mutated render', () => {
  test('a clean render passes every row, own rows numbered 1..9 before the shared rows', async () => {
    const { ir, r } = await rendered('sankey-full.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.checks.slice(0, 9).map((c) => c.name), sankey.doc.rows)
    assert.deepEqual(result.checks.slice(0, 9).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.deepEqual(result.warnings, [])
  })

  test('#1–#4 budget rows warn (never fail) with key/value on the over-budget fixture', async () => {
    const { ir, r } = await rendered('sankey-over-budget.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.warnings.map((w) => [w.name, w.key, w.value]), [
      ['node-count', 'budget:nodes', 13], ['link-count', 'budget:links', 17], ['label-length', 'budget:label', 13], ['emphasis-count', 'budget:emphasis', 3],
    ])
  })

  test('#5 links-forward fails when a ribbon points at a missing node or runs right → left', async () => {
    const { ir, r } = await rendered('sankey-simple.yaml')
    const unknown = structuredClone(r)
    unknown.layout.geo.ribbons[0].to = 'ghost'
    const a = await verifyFigure(plugin(), ir, unknown)
    assert.equal(byName(a.checks, 'links-forward').ok, false)
    assert.match(byName(a.checks, 'links-forward').detail, /mail→ghost references an unknown node/)
    const backward = structuredClone(r)
    const rb = backward.layout.geo.ribbons[1]
    ;[rb.x1, rb.x2] = [rb.x2, rb.x1]
    const b = await verifyFigure(plugin(), ir, backward)
    assert.match(byName(b.checks, 'links-forward').detail, /mail→visit is drawn right → left/)
  })

  test('#6 ribbons-proportional fails when a ribbon or bar no longer matches value × scale, in geometry and in the svg', async () => {
    const { ir, r } = await rendered('sankey-simple.yaml')
    const geoOff = structuredClone(r)
    geoOff.layout.geo.ribbons[0].thickness += 3
    const a = await verifyFigure(plugin(), ir, geoOff)
    assert.equal(byName(a.checks, 'ribbons-proportional').ok, false)
    assert.match(byName(a.checks, 'ribbons-proportional').detail, /ribbon mail→chat: .* ≠ 60 × /)
    const barOff = structuredClone(r)
    barOff.layout.geo.nodes[0].height -= 5
    assert.match(byName((await verifyFigure(plugin(), ir, barOff)).checks, 'ribbons-proportional').detail, /node mail: /)
    const svgOff = structuredClone(r)
    svgOff.svg = svgOff.svg.replace(/(<path id="wu-d-sk1-r-0" data-value=")60"/, '$199"')
    const c = await verifyFigure(plugin(), ir, svgOff)
    assert.match(byName(c.checks, 'ribbons-proportional').detail, /svg wu-d-sk1-r-0: .* for value 99/)
    const dropped = structuredClone(r)
    dropped.svg = dropped.svg.replace(/<path id="wu-d-sk1-r-3"[^>]*\/>/, '')
    assert.match(byName((await verifyFigure(plugin(), ir, dropped)).checks, 'ribbons-proportional').detail, /3 data-value ribbon\(s\) in the svg, expected 4/)
  })

  test('#7 flow-conserved fails when an in ≠ out node loses its 差分 footnote, or the footnote is spurious', async () => {
    const { ir, r } = await rendered('sankey-full.yaml')
    const noFoot = structuredClone(r)
    noFoot.layout.geo.footnotes = noFoot.layout.geo.footnotes.filter((f) => !f.text.startsWith('差分'))
    noFoot.svg = noFoot.svg.replace(/<text id="wu-d-sk2-foot-1"[^>]*>[^<]*<\/text>/, '')
    const a = await verifyFigure(plugin(), ir, noFoot)
    assert.equal(byName(a.checks, 'flow-conserved').ok, false)
    assert.match(byName(a.checks, 'flow-conserved').detail, /shared \(in 138, out 134\) not listed in the footnote/)
    assert.match(byName(a.checks, 'flow-conserved').detail, /差分 footnote missing from the svg/)
    const wrong = structuredClone(r)
    wrong.layout.geo.footnotes[1].text = '差分: 共有基盤 入 138万円 / 出 138万円'
    assert.match(byName((await verifyFigure(plugin(), ir, wrong)).checks, 'flow-conserved').detail, /shared .* not listed/)
    const s = await rendered('sankey-simple.yaml')
    const spurious = structuredClone(s.r)
    spurious.layout.geo.footnotes.push({ text: '差分: なし', x: 16, y: 440 })
    assert.match(byName((await verifyFigure(plugin(), s.ir, spurious)).checks, 'flow-conserved').detail, /差分 footnote present although every node balances/)
  })

  test('#8 nodes-stacked fails when two bars of a column come closer than 12px or a bar has no height', async () => {
    const { ir, r } = await rendered('sankey-simple.yaml')
    const tight = structuredClone(r)
    const phone = tight.layout.geo.nodes.find((n) => n.id === 'phone')
    const mail = tight.layout.geo.nodes.find((n) => n.id === 'mail')
    phone.y = mail.y + mail.height + 4
    const a = await verifyFigure(plugin(), ir, tight)
    assert.equal(byName(a.checks, 'nodes-stacked').ok, false)
    assert.match(byName(a.checks, 'nodes-stacked').detail, /mail\/phone: 4px apart/)
    const flat = structuredClone(r)
    flat.layout.geo.nodes.find((n) => n.id === 'chat').height = 0
    assert.match(byName((await verifyFigure(plugin(), ir, flat)).checks, 'nodes-stacked').detail, /chat has no height/)
  })

  test('#9 labels-clear fails when two labels overlap or a label leaves the canvas', async () => {
    const { ir, r } = await rendered('sankey-simple.yaml')
    const clash = structuredClone(r)
    const labels = clash.layout.geo.labels
    const a = labels.find((l) => l.id === 'node-mail')
    const b = labels.find((l) => l.id === 'node-phone')
    b.box = { ...a.box }
    const res = await verifyFigure(plugin(), ir, clash)
    assert.equal(byName(res.checks, 'labels-clear').ok, false)
    assert.match(byName(res.checks, 'labels-clear').detail, /node-mail overlaps node-phone/)
    const off = structuredClone(r)
    const v = off.layout.geo.labels.find((l) => l.id === 'value-0')
    v.box = { ...v.box, left: v.box.left + 2000, right: v.box.right + 2000 }
    assert.match(byName((await verifyFigure(plugin(), ir, off)).checks, 'labels-clear').detail, /off-canvas: value-0/)
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/sankey.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('simple and full render as data-checks="pass" data-type="sankey" figures with data-value ribbons and no literal colors', async () => {
    for (const name of ['sankey-simple.yaml', 'sankey-full.yaml']) {
      const out = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(out.checksOk, true, `${name}: ${JSON.stringify(out.failures)}`)
      assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="sankey">/)
      assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
      assert.match(out.html, /data-value="/)
      assert.doesNotMatch(out.html, /#[0-9a-fA-F]{3,6}\b|rgb\(/)
    }
  })

  test('the over-budget fixture still passes, carrying data-warn with every geometry row green', async () => {
    const out = await renderFigureHtmlChecked(validIr('sankey-over-budget.yaml'), { rawYaml: fixture('sankey-over-budget.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.equal(out.warn, 'budget:nodes=13;budget:links=17;budget:label=13;budget:emphasis=3')
    assert.ok(out.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=13;budget:links=17;budget:label=13;budget:emphasis=3" data-type="sankey">'))
  })

  test('CLI: --figure exits 0 with the figure, --json reports ok + checks, --doc sankey is 3 stages / 7 nodes / 8 links and renders clean', () => {
    const fig = runCli([join(FIXTURES, 'sankey-full.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-type="sankey"/)
    const json = runCli([join(FIXTURES, 'sankey-simple.yaml'), '--json'])
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.checks.some((c) => c.name === 'ribbons-proportional' && c.ok))
    assert.ok(parsed.checks.some((c) => c.name === 'flow-conserved' && c.ok))
    const doc = runCli(['--doc', 'sankey'])
    assert.equal(doc.status, 0)
    const example = validateIR(parseYaml(doc.stdout))
    assert.ok(example.ok, example.message)
    assert.equal(new Set(example.ir.nodes.map((n) => n.stage)).size, 3)
    assert.equal(example.ir.nodes.length, 7)
    assert.equal(example.ir.links.length, 8)
    assert.deepEqual(example.warnings, [])
  })
})
