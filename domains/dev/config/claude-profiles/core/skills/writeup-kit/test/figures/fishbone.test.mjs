// `type: fishbone` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/fishbone-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as fishbone from '../../bin/lib/figures/fishbone.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'
import { textWidth } from '../../bin/lib/diagram.mjs'

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

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const plugin = getFigureType('fishbone')
const OWN_ROWS = ['category-count', 'causes-per-category', 'cause-total', 'label-length', 'emphasis-count', 'effect-at-spine-end', 'bones-alternate', 'no-overlap']
const WARN = 'budget:categories=7;budget:causes=6;budget:total=22;budget:label=16;budget:emphasis=3'

const minimal = () => ({
  id: 's', type: 'fishbone', title: 't', effect: 'slow',
  categories: [
    { id: 'a', label: 'A', causes: ['a1', { label: 'a2', emphasis: true }] },
    { id: 'b', label: 'B', causes: ['b1'] },
    { id: 'c', label: 'C', causes: ['c1', 'c2', 'c3'] },
  ],
})

// --- schema ----------------------------------------------------------------

describe('figures/fishbone.mjs: schema', () => {
  test('a valid IR normalizes: bare-string causes become { label, emphasis:false }; an emphasised cause promotes its category', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'fishbone')
    assert.equal(r.ir.effect, 'slow')
    assert.deepEqual(r.ir.categories[0], { id: 'a', label: 'A', emphasis: true, causes: [{ label: 'a1', emphasis: false }, { label: 'a2', emphasis: true }] })
    assert.deepEqual(r.ir.categories[1], { id: 'b', label: 'B', emphasis: false, causes: [{ label: 'b1', emphasis: false }] })
    // emphasis may also sit on the category itself (no cause bolded)
    const cat = validateIR({ ...minimal(), categories: [{ id: 'a', label: 'A', emphasis: true, causes: ['a1'] }, { id: 'b', label: 'B', causes: ['b1'] }] })
    assert.equal(cat.ir.categories[0].emphasis, true)
    assert.equal(cat.ir.categories[0].causes[0].emphasis, false)
    assert.match(validateIR({ ...minimal(), categories: [{ id: 'a', label: 'A', emphasis: 'yes', causes: ['a1'] }] }).message, /categories\[0\]\.emphasis must be a boolean/)
  })

  test('normalize is idempotent', () => {
    const once = fishbone.normalize(minimal())
    const twice = fishbone.normalize(once)
    assert.deepEqual(twice, once)
    for (const name of ['fishbone-simple.yaml', 'fishbone-full.yaml']) {
      const ir = validIr(name)
      assert.deepEqual(fishbone.normalize(ir), ir)
    }
  })

  test('schema errors carry the offending path', () => {
    const cases = [
      [{ ...minimal(), effect: undefined }, /ir\.effect is required/],
      [{ ...minimal(), effect: '  ' }, /ir\.effect is required/],
      [{ ...minimal(), categories: [] }, /ir\.categories must be a non-empty list/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A', causes: ['x'] }, { id: 'a', label: 'B', causes: ['y'] }] }, /duplicate category id: "a"/],
      [{ ...minimal(), categories: [{ id: 'a', causes: ['x'] }] }, /ir\.categories\[0\]\.label is required/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A', causes: [] }] }, /ir\.categories\[0\]\.causes must be a non-empty list/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A' }] }, /ir\.categories\[0\]\.causes must be a non-empty list/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A', causes: [''] }] }, /ir\.categories\[0\]\.causes\[0\] must be a non-empty string/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A', causes: [3] }] }, /ir\.categories\[0\]\.causes\[0\] must be a string or a mapping/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A', causes: [{ emphasis: true }] }] }, /ir\.categories\[0\]\.causes\[0\]\.label is required/],
      [{ ...minimal(), categories: [{ id: 'a', label: 'A', causes: [{ label: 'x', emphasis: 'yes' }] }] }, /ir\.categories\[0\]\.causes\[0\]\.emphasis must be a boolean/],
      [{ ...minimal(), categories: ['a'] }, /ir\.categories\[0\] must be a mapping/],
    ]
    for (const [raw, re] of cases) {
      const r = validateIR(raw)
      assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(raw).slice(0, 80)}`)
      assert.equal(r.reason, 'schema')
      assert.match(r.message, re)
    }
  })
})

// --- budgets ---------------------------------------------------------------

describe('figures/fishbone.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    assert.deepEqual(fishbone.budgetWarnings(validIr('fishbone-simple.yaml')), [])
    assert.deepEqual(fishbone.budgetWarnings(validIr('fishbone-full.yaml')), [])
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('fishbone-over-budget.yaml')
    const warns = fishbone.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), ['budget:categories', 'budget:causes', 'budget:total', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(warns.map((w) => w.value), [7, 6, 22, 16, 3])
    assert.deepEqual(warns.map((w) => w.limit), [6, 3, 18, 14, 1])
    assert.equal(formatBudgetWarnings(warns), WARN)
    assert.match(warns[4].detail, /3 emphasized bone\(s\)/, 'emphasis counts bones: c1 (via a cause), c2 (category), c3 (via a cause)')
    for (const w of warns) assert.ok(w.hint && w.hint !== w.detail, `${w.key} needs a concrete hint`)
    const rendered = await renderFigureHtmlChecked(ir, { rawYaml: fixture('fishbone-over-budget.yaml') })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, new RegExp(`^<figure class="wu-figure" data-checks="pass" data-warn="${WARN}" data-type="fishbone" data-scroll="true">`))
    assert.equal(rendered.scroll, true, '7 categories with a 16-char label fall back to the sideways scroll')
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/fishbone.mjs: layout', () => {
  test('the spine is horizontal and ends at the effect box, which straddles it inside the canvas', async () => {
    const l = await fishbone.layout(validIr('fishbone-simple.yaml'))
    const { spine, effect, spineY } = l.geo
    assert.equal(spine.y1, spineY)
    assert.equal(spine.y2, spineY)
    assert.equal(spine.x2, effect.x)
    assert.equal(effect.y + effect.height / 2, spineY)
    assert.ok(effect.x + effect.width + 16 <= l.width)
    assert.ok(effect.width >= Math.ceil(textWidth(effect.label)) + 32)
    assert.equal(l.width % 4, 0)
    assert.equal(l.height % 4, 0)
  })

  test('bones alternate top/bottom in IR order, pairs share a join, all lean toward the tail at 7:4', async () => {
    const ir = validIr('fishbone-full.yaml')
    const l = await fishbone.layout(ir)
    assert.deepEqual(l.geo.bones.map((b) => b.id), ir.categories.map((c) => c.id))
    assert.deepEqual(l.geo.bones.map((b) => b.side), ['top', 'bottom', 'top', 'bottom', 'top', 'bottom'])
    for (const b of l.geo.bones) {
      assert.equal(b.y2, l.geo.spineY)
      assert.ok(b.side === 'top' ? b.y1 < l.geo.spineY : b.y1 > l.geo.spineY)
      assert.ok(b.x1 < b.x2, 'the tip is left of the join')
      assert.equal((b.x2 - b.x1) * 7, Math.abs(b.y2 - b.y1) * 4)
    }
    assert.equal(l.geo.bones[0].x2, l.geo.bones[1].x2)
    assert.equal(l.geo.bones[2].x2, l.geo.bones[3].x2)
    assert.equal(l.geo.bones[2].x2 - l.geo.bones[0].x2, l.geo.spacing)
    assert.equal(l.geo.bones[4].x2 - l.geo.bones[2].x2, l.geo.spacing)
    // every bone is the same length
    const lengths = new Set(l.geo.bones.map((b) => Math.abs(b.y2 - b.y1)))
    assert.equal(lengths.size, 1)
  })

  test('category boxes sit at the bone tips, outside the bone on the far side of the spine', async () => {
    const l = await fishbone.layout(validIr('fishbone-simple.yaml'))
    for (const b of l.geo.bones) {
      assert.equal(b.box.x + b.box.width / 2, b.x1, `${b.id}: box centered on the tip`)
      if (b.side === 'top') assert.equal(b.box.y + b.box.height, b.y1)
      else assert.equal(b.box.y, b.y1)
      assert.ok(b.box.width >= Math.ceil(textWidth(b.box.label) * 1.08) + 24)
    }
  })

  test('causes hang on the bone as horizontal ticks, evenly spaced, cause order increasing with y, nearest the label', async () => {
    const ir = validIr('fishbone-simple.yaml')
    const l = await fishbone.layout(ir)
    assert.equal(l.geo.slots, 3)
    for (const b of l.geo.bones) {
      const m = b.causes.length
      for (const k of b.causes) {
        assert.equal(k.tick.y1, k.tick.y2)
        assert.equal(k.tick.x2 - k.tick.x1, 32)
        // the tick's inner end lies exactly on the bone (7:4 slope)
        const dy = Math.abs(k.tick.y2 - b.y2)
        assert.equal((b.x2 - k.tick.x2) * 7, dy * 4, `${b.id}/${k.index}: tick off the bone`)
        assert.equal(k.text.x, k.tick.x1 - 4)
        assert.equal(k.text.y, k.tick.y1)
        assert.equal(k.text.anchor, 'end')
      }
      const ys = b.causes.map((k) => k.tick.y1)
      for (let i = 1; i < ys.length; i++) assert.equal(ys[i] - ys[i - 1], 28, `${b.id}: ticks 28px apart`)
      // the causes occupy the slots nearest the tip
      const nearest = b.side === 'top' ? b.causes[0] : b.causes[m - 1]
      assert.equal(Math.abs(nearest.tick.y1 - b.y1), 28)
    }
    const job = l.geo.bones.find((b) => b.id === 'job')
    assert.equal(job.causes.length, 2)
    assert.equal(job.side, 'bottom')
    assert.equal(job.causes[1].tick.y1 - job.causes[0].tick.y1, 28)
  })

  test('join spacing leaves room for the longest cause text plus tick and clearance', async () => {
    const ir = validIr('fishbone-full.yaml')
    const l = await fishbone.layout(ir)
    const longest = Math.max(...l.geo.bones.flatMap((b) => b.causes.map((k) => k.text.width)))
    assert.ok(l.geo.spacing >= longest + 32 + 4 + 12)
    assert.equal(l.geo.spacing % 4, 0)
    for (const b of l.geo.bones) {
      for (const k of b.causes) assert.ok(k.text.x - k.text.width >= 0, `${b.id}/${k.index}: text inside the canvas`)
    }
  })

  test('every position sits on the 4px grid and the layout is deterministic', async () => {
    for (const name of ['fishbone-simple.yaml', 'fishbone-full.yaml', 'fishbone-over-budget.yaml']) {
      const ir = validIr(name)
      const a = await fishbone.layout(ir)
      const b = await fishbone.layout(ir)
      assert.deepEqual(a, b, `${name}: layout differs between runs`)
      const r1 = await renderFigure(plugin, ir)
      const r2 = await renderFigure(plugin, ir)
      assert.equal(r1.svg, r2.svg, `${name}: svg differs between runs`)
      const v = await verifyFigure(plugin, ir, r1)
      assert.equal(byName(v.checks, 'grid-4px').ok, true, `${name}: ${byName(v.checks, 'grid-4px').detail}`)
    }
  })

  test('a single category hangs above the spine and the canvas has no empty lower half', async () => {
    const r = validateIR({ ...minimal(), categories: [{ id: 'only', label: 'Only', causes: ['x', 'y'] }] })
    assert.equal(r.ok, true)
    const l = await fishbone.layout(r.ir)
    assert.equal(l.geo.bones.length, 1)
    assert.equal(l.geo.bones[0].side, 'top')
    assert.ok(l.height - l.geo.spineY < 64)
    const v = await verifyFigure(plugin, r.ir, await renderFigure(plugin, r.ir))
    assert.equal(v.ok, true, JSON.stringify(v.failures))
  })
})

// --- verify rows -----------------------------------------------------------

describe('figures/fishbone.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of ['fishbone-simple.yaml', 'fishbone-full.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.name), plugin.doc.rows)
      assert.deepEqual(v.checks.slice(0, 8).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
      assert.deepEqual(v.checks.slice(5, 8).map((c) => c.severity), ['fail', 'fail', 'fail'])
    }
  })

  test('effect-at-spine-end fails when the spine stops short of the box, tilts, or the box misses the spine', async () => {
    const ir = validIr('fishbone-simple.yaml')
    const l = await fishbone.layout(ir)
    l.geo.spine.x2 -= 16
    let row = byName(fishbone.verify(l, ir), 'effect-at-spine-end')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /spine ends at x=\d+ but the effect box starts at x=\d+/)
    const l2 = await fishbone.layout(ir)
    l2.geo.spine.y2 += 8
    row = byName(fishbone.verify(l2, ir), 'effect-at-spine-end')
    assert.equal(row.ok, false)
    assert.match(row.detail, /not a horizontal/)
    const l3 = await fishbone.layout(ir)
    l3.geo.effect.y = l3.geo.spineY + 40
    assert.equal(byName(fishbone.verify(l3, ir), 'effect-at-spine-end').ok, false)
  })

  test('bones-alternate fails when two neighbours share a side, a bone leaves the spine, or the angle is not 60°', async () => {
    const ir = validIr('fishbone-simple.yaml')
    const l = await fishbone.layout(ir)
    const b = l.geo.bones[1]
    const d = b.y1 - l.geo.spineY
    Object.assign(b, { side: 'top', y1: l.geo.spineY - d })
    let row = byName(fishbone.verify(l, ir), 'bones-alternate')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /job: side top, expected bottom/)
    const l2 = await fishbone.layout(ir)
    l2.geo.bones[0].y2 -= 4
    row = byName(fishbone.verify(l2, ir), 'bones-alternate')
    assert.equal(row.ok, false)
    assert.match(row.detail, /db: does not meet the spine/)
    const l3 = await fishbone.layout(ir)
    l3.geo.bones[2].x1 -= 40
    row = byName(fishbone.verify(l3, ir), 'bones-alternate')
    assert.equal(row.ok, false)
    assert.match(row.detail, /ops: not a 60°/)
    const l4 = await fishbone.layout(ir)
    l4.geo.bones.reverse()
    assert.match(byName(fishbone.verify(l4, ir), 'bones-alternate').detail, /order differs from ir\.categories/)
  })

  test('no-overlap fails when a cause text runs into the neighbouring bone, a label box, or another text', async () => {
    const ir = validIr('fishbone-full.yaml')
    const l = await fishbone.layout(ir)
    // the "設備" bone (index 2) is to the right of "人" (index 0): a text
    // 3× wider than the spacing crosses the "人" bone
    const k = l.geo.bones[2].causes[0]
    k.text.width = l.geo.spacing * 3
    let row = byName(fishbone.verify(l, ir), 'no-overlap')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /cause "ノード数の削減" × bone people/)
    // a category box dragged down onto its own top cause text
    const l2 = await fishbone.layout(ir)
    const box = l2.geo.bones[0].box
    box.y += 40
    row = byName(fishbone.verify(l2, ir), 'no-overlap')
    assert.equal(row.ok, false)
    assert.match(row.detail, /category "人"/)
    // the effect box moved onto the spine's middle so bones cross it
    const l3 = await fishbone.layout(ir)
    l3.geo.effect.x = l3.geo.bones[0].x2 - 40
    l3.geo.spine.x2 = l3.geo.effect.x
    row = byName(fishbone.verify(l3, ir), 'no-overlap')
    assert.equal(row.ok, false)
    assert.match(row.detail, /effect box × bone/)
  })

  test('the five budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('fishbone-over-budget.yaml')
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['category-count', 'budget:categories', 7],
      ['causes-per-category', 'budget:causes', 6],
      ['cause-total', 'budget:total', 22],
      ['label-length', 'budget:label', 16],
      ['emphasis-count', 'budget:emphasis', 3],
    ])
    const cleanIr = validIr('fishbone-simple.yaml')
    const clean = await verifyFigure(plugin, cleanIr, await renderFigure(plugin, cleanIr))
    for (const name of OWN_ROWS.slice(0, 5)) {
      const row = byName(clean.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/fishbone.mjs: draw', () => {
  test('emphasis is the accent bone + focal label box (never a tick), the root cause is bold, the effect box is the focal rect, labels are escaped', async () => {
    const raw = { ...minimal(), effect: 'A & <B>', categories: [{ id: 'a', label: 'x<y', causes: [{ label: 'root & cause', emphasis: true }, 'plain'] }, { id: 'b', label: 'B', causes: ['b1'] }] }
    const r = validateIR(raw)
    assert.equal(r.ok, true, JSON.stringify(r))
    const rendered = await renderFigure(plugin, r.ir)
    assert.equal(rendered.layout.geo.bones[0].emphasis, true)
    assert.match(rendered.svg, /<rect id="wu-d-s-effect" class="wu-focal"[^>]*rx="6"[^>]*stroke-width="1.5"/)
    assert.match(rendered.svg, /<text id="wu-d-s-effect-label"[^>]*font-weight="700"[^>]*>A &amp; &lt;B&gt;<\/text>/)
    assert.match(rendered.svg, /<line id="wu-d-s-bone-a"[^>]*stroke="var\(--wu-accent\)" stroke-width="1.5"/)
    assert.match(rendered.svg, /<rect id="wu-d-s-cat-a" class="wu-focal"[^>]*stroke-width="1.5"/)
    assert.match(rendered.svg, /<text id="wu-d-s-cat-a-label"[^>]*font-weight="700"[^>]*>x&lt;y<\/text>/)
    assert.match(rendered.svg, /<line id="wu-d-s-bone-b"[^>]*stroke="currentColor" stroke-width="1"/)
    assert.match(rendered.svg, /<rect id="wu-d-s-cat-b" x=/)
    assert.match(rendered.svg, /<line id="wu-d-s-tick-a-0"[^>]*stroke="currentColor" stroke-width="1"/)
    assert.match(rendered.svg, /<text id="wu-d-s-cause-a-0"[^>]*font-weight="700" text-anchor="end"[^>]*>root &amp; cause<\/text>/)
    assert.match(rendered.svg, /<line id="wu-d-s-tick-a-1"[^>]*stroke="currentColor" stroke-width="1"/)
    assert.doesNotMatch(rendered.svg, /wu-accent[^>]*stroke-width="1"\/>/, 'no accent on a 1px stroke')
    assert.doesNotMatch(rendered.svg, /<text id="wu-d-s-cause-a-1"[^>]*font-weight/)
    assert.match(rendered.svg, /<line id="wu-d-s-spine"[^>]*marker-end="url\(#wu-d-s-solid\)"/)
    assert.match(rendered.svg, /<line id="wu-d-s-bone-a"[^>]*marker-end="url\(#wu-d-s-solid\)"/)
    assert.doesNotMatch(rendered.svg, /#[0-9a-fA-F]{6}\b/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/fishbone.mjs: registry dispatch and CLI', () => {
  test('fishbone-simple.yaml and fishbone-full.yaml (6 × 3) render as data-checks="pass" data-type="fishbone" figures', async () => {
    for (const name of ['fishbone-simple.yaml', 'fishbone-full.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigureHtmlChecked(ir, { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="fishbone">/)
      assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
    }
    const full = validIr('fishbone-full.yaml')
    assert.equal(full.categories.length, 6)
    assert.ok(full.categories.every((c) => c.causes.length === 3))
    const r = await renderFigure(plugin, full)
    assert.equal(r.scroll, false, 'a 6 × 3 fishbone fits the column by scaling')
  })

  test('the registry lists fishbone with its limits and doc rows', () => {
    assert.equal(plugin.type, 'fishbone')
    assert.deepEqual(plugin.limits, { maxCategories: 6, maxCausesPerCategory: 3, maxCauses: 18, maxLabelLen: 14, maxEmphasis: 1 })
    assert.deepEqual(plugin.doc.rows, OWN_ROWS)
  })

  test('doc.irExample validates with 4 categories × 3 causes and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.categories.length, 4)
    assert.ok(r.ir.categories.every((c) => c.causes.length === 3))
    assert.equal(r.ir.categories.flatMap((c) => c.causes).filter((k) => k.emphasis).length, 1)
    assert.deepEqual(r.ir.categories.filter((c) => c.emphasis).map((c) => c.id), ['code'])
    assert.deepEqual(fishbone.budgetWarnings(r.ir), [])
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="fishbone">/)
  })

  test('--figure prints a verified fishbone figure; --json reports warnings for the over-budget fixture', () => {
    const fig = runCli([join(FIXTURES, 'fishbone-full.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="fishbone">/)
    const json = runCli([join(FIXTURES, 'fishbone-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:categories', 'budget:causes', 'budget:total', 'budget:label', 'budget:emphasis'])
    assert.match(out.figureHtml, new RegExp(`data-warn="${WARN}" data-type="fishbone"`))
    const warnFig = runCli([join(FIXTURES, 'fishbone-over-budget.yaml'), '--figure'])
    assert.equal(warnFig.status, 0)
    assert.match(warnFig.stderr, /warning: budget:categories=7/)
  })
})
