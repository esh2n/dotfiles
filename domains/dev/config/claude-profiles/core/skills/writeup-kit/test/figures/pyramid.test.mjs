// `type: pyramid` — schema, budgets, layout (even vs proportional widths,
// inside vs outside labels), verify rows, the registry dispatch and the CLI.
// Fixtures: test/fixtures/pyramid-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR } from '../../bin/lib/ir.mjs'
import * as pyramid from '../../bin/lib/figures/pyramid.mjs'
import { getFigureType, renderFigure, verifyFigure } from '../../bin/lib/figures/index.mjs'
import { renderFigureHtmlChecked } from '../../bin/lib/verify-diagram.mjs'

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

const plugin = getFigureType('pyramid')
const WIDE_W = 416
const OWN_ROWS = ['tier-count', 'label-length', 'emphasis-count', 'tiers-ordered', 'widths-monotonic', 'values-proportional', 'labels-legible']

const minimal = () => ({
  id: 'p', type: 'pyramid', title: 't',
  tiers: [
    { id: 'top', label: 'Top', emphasis: true },
    { id: 'mid', label: 'Mid', note: 'n' },
    { id: 'base', label: 'Base', tone: 'rs' },
  ],
})

const funnelValues = (values, extra = {}) => ({
  id: 'f', type: 'pyramid', variant: 'funnel', title: 't',
  tiers: values.map((value, i) => ({ id: `t${i}`, label: `T${i}`, value })),
  ...extra,
})

// --- schema ----------------------------------------------------------------

describe('figures/pyramid.mjs: schema', () => {
  test('a valid IR normalizes: variant defaults to pyramid, tone/emphasis filled, value/note kept only when given', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true)
    assert.equal(r.ir.type, 'pyramid')
    assert.equal(r.ir.variant, 'pyramid')
    assert.deepEqual(r.ir.tiers[0], { id: 'top', label: 'Top', tone: 'neutral', emphasis: true })
    assert.deepEqual(r.ir.tiers[1], { id: 'mid', label: 'Mid', note: 'n', tone: 'neutral', emphasis: false })
    assert.deepEqual(r.ir.tiers[2], { id: 'base', label: 'Base', tone: 'rs', emphasis: false })
    const f = validateIR(funnelValues([100, 40.5]))
    assert.equal(f.ok, true)
    assert.equal(f.ir.variant, 'funnel')
    assert.deepEqual(f.ir.tiers.map((t) => t.value), [100, 40.5])
  })

  test('normalize is idempotent', () => {
    for (const raw of [minimal(), funnelValues([9, 3, 1])]) {
      const once = pyramid.normalize(raw)
      assert.deepEqual(pyramid.normalize(once), once)
    }
    for (const name of ['pyramid-simple.yaml', 'pyramid-funnel.yaml']) {
      const ir = validIr(name)
      assert.deepEqual(pyramid.normalize(ir), ir)
    }
  })

  test('schema errors carry the offending path', () => {
    const cases = [
      [{ ...minimal(), tiers: [] }, /ir\.tiers must be a non-empty list/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A' }] }, /ir\.tiers needs at least 2 tiers/],
      [{ ...minimal(), variant: 'cone' }, /ir\.variant must be pyramid\|funnel/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }, /duplicate tier id: "a"/],
      [{ ...minimal(), tiers: [{ id: 'a' }, { id: 'b', label: 'B' }] }, /ir\.tiers\[0\]\.label is required/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A', value: '12' }, { id: 'b', label: 'B', value: 3 }] }, /ir\.tiers\[0\]\.value must be a finite number > 0/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A', value: 0 }, { id: 'b', label: 'B', value: 3 }] }, /ir\.tiers\[0\]\.value must be a finite number > 0/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A', value: 5 }, { id: 'b', label: 'B' }] }, /value must be given on every tier or on none \(1 of 2 carry one\)/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A', note: '' }, { id: 'b', label: 'B' }] }, /ir\.tiers\[0\]\.note must be a non-empty string/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A', tone: 'red' }, { id: 'b', label: 'B' }] }, /ir\.tiers\[0\]\.tone must be ts\|rs\|new\|neutral/],
      [{ ...minimal(), tiers: [{ id: 'a', label: 'A', emphasis: 'yes' }, { id: 'b', label: 'B' }] }, /ir\.tiers\[0\]\.emphasis must be a boolean/],
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

describe('figures/pyramid.mjs: budgets', () => {
  test('within budget → no warnings', () => {
    assert.deepEqual(pyramid.budgetWarnings(validIr('pyramid-simple.yaml')), [])
    assert.deepEqual(pyramid.budgetWarnings(validIr('pyramid-funnel.yaml')), [])
  })

  test('every budget key fires, in a stable order, and reaches data-warn', async () => {
    const ir = validIr('pyramid-over-budget.yaml')
    const warns = pyramid.budgetWarnings(ir)
    assert.deepEqual(warns.map((w) => w.key), ['budget:tiers', 'budget:label', 'budget:emphasis'])
    assert.deepEqual(warns.map((w) => [w.value, w.limit]), [[8, 7], [16, 14], [3, 2]])
    for (const w of warns) assert.ok(w.hint && w.detail)
    const rendered = await renderFigureHtmlChecked(ir)
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /data-warn="budget:tiers=8;budget:label=16;budget:emphasis=3" data-type="pyramid"/)
  })
})

// --- layout ----------------------------------------------------------------

describe('figures/pyramid.mjs: layout', () => {
  test('without values the widths step evenly from the narrow to the wide end and tiers touch', async () => {
    const l = await pyramid.layout(validIr('pyramid-simple.yaml'), { column: 720 })
    const edges = [l.geo.tiers[0].wTop, ...l.geo.tiers.map((t) => t.wBottom)]
    assert.equal(edges[0], 64)
    assert.equal(edges[edges.length - 1], WIDE_W)
    const steps = edges.slice(1).map((w, i) => w - edges[i])
    assert.ok(steps.every((s) => s >= 80 && s <= 96), `uneven steps: ${steps}`)
    for (let i = 1; i < l.geo.tiers.length; i++) {
      assert.equal(l.geo.tiers[i].yTop, l.geo.tiers[i - 1].yBottom)
      assert.equal(l.geo.tiers[i].wTop, l.geo.tiers[i - 1].wBottom)
    }
    assert.equal(l.geo.tierH, 56, 'a note widens the tier to 56px')
    assert.equal(l.width, 720)
    assert.equal(l.geo.values, undefined)
    const funnel = await pyramid.layout(validateIR({ ...minimal(), variant: 'funnel' }).ir, { column: 720 })
    assert.equal(funnel.geo.tiers[0].wTop, WIDE_W)
    assert.equal(funnel.geo.tiers[funnel.geo.tiers.length - 1].wBottom, 64)
    assert.equal(funnel.geo.tierH, 56)
  })

  test('with values each tier\'s reference edge is value/max × the wide end, the value text is formatted with separators', async () => {
    const ir = validIr('pyramid-funnel.yaml')
    const l = await pyramid.layout(ir, { column: 720 })
    const max = 8400
    ir.tiers.forEach((t, i) => {
      const g = l.geo.tiers[i]
      assert.equal(g.wRef, g.wTop, 'a funnel tier is referenced by its top edge')
      assert.ok(Math.abs(g.wRef - t.value / max * WIDE_W) <= 1, `${t.id}: ${g.wRef} vs ${t.value / max * WIDE_W}`)
      assert.equal(g.value, t.value)
    })
    assert.deepEqual(l.geo.values.items.map((v) => v.text), ['8,400', '3,100', '1,250', '190', '42'])
    assert.ok(l.geo.values.x > l.geo.stackRight)
    // pyramid variant: reference edge is the base, top of the apex tier is half its base
    const p = await pyramid.layout(validateIR({ ...funnelValues([1, 2, 4]), variant: 'pyramid' }).ir, { column: 720 })
    assert.equal(p.geo.tiers[2].wBottom, WIDE_W)
    assert.equal(p.geo.tiers[0].wBottom, 104)
    assert.equal(p.geo.tiers[0].wTop, 52)
    assert.deepEqual(p.geo.values.items.map((v) => v.text), ['1', '2', '4'])
  })

  test('labels sit inside when they clear the slanted edges, otherwise outside with a level leader', async () => {
    const l = await pyramid.layout(validIr('pyramid-funnel.yaml'), { column: 720 })
    const byTier = Object.fromEntries(l.geo.labels.map((x) => [x.tier, x]))
    assert.equal(byTier.invited.inside, true)
    assert.equal(byTier.invited.x, l.geo.tiers[0].cx)
    assert.equal(byTier.invited.leader, undefined)
    for (const id of ['login', 'active', 'paid', 'expanded']) {
      const lab = byTier[id]
      assert.equal(lab.inside, false, `${id} should be outside`)
      assert.ok(lab.leader, `${id} needs a leader`)
      assert.equal(lab.leader.y1, lab.leader.y2)
      assert.ok(lab.leader.x2 - lab.leader.x1 >= 4)
      assert.ok(lab.x > lab.leader.x2)
    }
    assert.equal(byTier.login.note.text, '7 日以内')
    // outside labels keep clear of the value column
    const outsideRight = Math.max(...l.geo.labels.filter((x) => !x.inside).map((x) => x.x + Math.max(x.width, x.note?.width ?? 0)))
    assert.ok(outsideRight + 4 <= l.geo.values.x - l.geo.values.width)
    // a long label on a wide-enough tier stays inside
    const simple = await pyramid.layout(validIr('pyramid-simple.yaml'), { column: 720 })
    assert.ok(simple.geo.labels.every((x) => x.inside), 'every simple label fits inside')
  })

  test('every position sits on the 4px grid and the layout is deterministic', async () => {
    for (const name of ['pyramid-simple.yaml', 'pyramid-funnel.yaml', 'pyramid-over-budget.yaml']) {
      const ir = validIr(name)
      const a = await pyramid.layout(ir, { column: 720 })
      const b = await pyramid.layout(ir, { column: 720 })
      assert.deepEqual(a, b, `${name}: layout differs between runs`)
      assert.equal(a.width % 4, 0)
      assert.equal(a.height % 4, 0)
      const r1 = await renderFigure(plugin, ir)
      const r2 = await renderFigure(plugin, ir)
      assert.equal(r1.svg, r2.svg, `${name}: svg differs between runs`)
      const v = await verifyFigure(plugin, ir, r1)
      assert.equal(byName(v.checks, 'grid-4px').ok, true, `${name}: ${byName(v.checks, 'grid-4px').detail}`)
    }
  })
})

// --- verify rows -----------------------------------------------------------

describe('figures/pyramid.mjs: verify rows', () => {
  test('a clean fixture passes every own row and every shared row', async () => {
    for (const name of ['pyramid-simple.yaml', 'pyramid-funnel.yaml']) {
      const ir = validIr(name)
      const rendered = await renderFigure(plugin, ir)
      const v = await verifyFigure(plugin, ir, rendered)
      assert.equal(v.ok, true, `${name}: ${JSON.stringify(v.failures)}`)
      assert.deepEqual(v.warnings, [])
      assert.deepEqual(v.checks.slice(0, 7).map((c) => c.name), plugin.doc.rows)
      assert.deepEqual(v.checks.slice(0, 7).map((c) => c.id), [1, 2, 3, 4, 5, 6, 7])
    }
  })

  test('tiers-ordered fails on a gap between tiers, a width mismatch at the shared edge, or a reordered stack', async () => {
    const ir = validIr('pyramid-simple.yaml')
    const l = await pyramid.layout(ir)
    l.geo.tiers[2].yTop += 4
    let row = byName(pyramid.verify(l, ir), 'tiers-ordered')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /not touching edge to edge: growth\/reliability/)
    const l2 = await pyramid.layout(ir)
    l2.geo.tiers[1].wBottom += 8
    assert.match(byName(pyramid.verify(l2, ir), 'tiers-ordered').detail, /growth\/reliability/)
    const l3 = await pyramid.layout(ir)
    l3.geo.tiers.reverse()
    assert.match(byName(pyramid.verify(l3, ir), 'tiers-ordered').detail, /tier order differs/)
  })

  test('widths-monotonic fails end to end when funnel values grow from one tier to the next', async () => {
    const r = validateIR(funnelValues([1000, 300, 500, 100]))
    assert.equal(r.ok, true)
    const rendered = await renderFigure(plugin, r.ir)
    const v = await verifyFigure(plugin, r.ir, rendered)
    assert.equal(v.ok, false)
    const row = byName(v.checks, 'widths-monotonic')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /not non-increasing/)
    assert.match(row.hint, /variant: pyramid/)
    const html = await renderFigureHtmlChecked(r.ir)
    assert.equal(html.checksOk, false)
    assert.ok(!html.html.includes('data-checks="pass"'))
    // the same values read as a pyramid are equally wrong the other way
    const p = validateIR({ ...funnelValues([100, 300, 200]), variant: 'pyramid' })
    const pv = await verifyFigure(plugin, p.ir, await renderFigure(plugin, p.ir))
    assert.match(byName(pv.checks, 'widths-monotonic').detail, /not non-decreasing/)
    // hand-mutated even widths fail too
    const ir = validIr('pyramid-simple.yaml')
    const l = await pyramid.layout(ir)
    l.geo.tiers[1].wBottom = l.geo.tiers[1].wTop - 8
    l.geo.tiers[2].wTop = l.geo.tiers[1].wBottom
    assert.equal(byName(pyramid.verify(l, ir), 'widths-monotonic').ok, false)
  })

  test('values-proportional fails when a width drifts more than 1px from value/max, or the value is not drawn', async () => {
    const ir = validIr('pyramid-funnel.yaml')
    const rendered = await renderFigure(plugin, ir)
    const l = rendered.layout
    const tier = l.geo.tiers[1]
    tier.wTop += 2
    tier.wRef += 2
    l.geo.tiers[0].wBottom += 2
    const row = byName(pyramid.verify(l, ir, { svg: rendered.svg }), 'values-proportional')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /login \(\d+px vs [\d.]+px\)/)
    const fresh = await renderFigure(plugin, ir)
    const svgNoValue = fresh.svg.replace(/<text id="wu-d-trial-funnel-t-paid-value"[^>]*>[^<]*<\/text>/, '')
    const row2 = byName(pyramid.verify(fresh.layout, ir, { svg: svgNoValue }), 'values-proportional')
    assert.equal(row2.ok, false)
    assert.match(row2.detail, /paid \(value 190 not drawn\)/)
    const svgNoData = fresh.svg.replace(' data-value="42"', '')
    assert.match(byName(pyramid.verify(fresh.layout, ir, { svg: svgNoData }), 'values-proportional').detail, /expanded \(missing data-value\)/)
    // no values → the row passes and says so
    const simple = validIr('pyramid-simple.yaml')
    const sr = byName(pyramid.verify(await pyramid.layout(simple), simple), 'values-proportional')
    assert.equal(sr.ok, true)
    assert.match(sr.detail, /no values/)
  })

  test('labels-legible fails on an inside label wider than its tier, or an outside label without a leader or past the canvas', async () => {
    const ir = validIr('pyramid-simple.yaml')
    const l = await pyramid.layout(ir)
    l.geo.labels[0].width = 400
    let row = byName(pyramid.verify(l, ir), 'labels-legible')
    assert.equal(row.severity, 'fail')
    assert.equal(row.ok, false)
    assert.match(row.detail, /brand \(needs 416px, tier offers \d+px\)/)
    const f = validIr('pyramid-funnel.yaml')
    const fl = await pyramid.layout(f)
    const login = fl.geo.labels.find((x) => x.tier === 'login')
    delete login.leader
    assert.match(byName(pyramid.verify(fl, f), 'labels-legible').detail, /login \(leader missing/)
    const fl2 = await pyramid.layout(f)
    const paid = fl2.geo.labels.find((x) => x.tier === 'paid')
    paid.x += 400
    paid.leader.x2 += 400
    assert.match(byName(pyramid.verify(fl2, f), 'labels-legible').detail, /paid \(outside label runs past the value column\)/)
  })

  test('the three budget rows are warn rows carrying key/value only when they fail', async () => {
    const ir = validIr('pyramid-over-budget.yaml')
    const v = await verifyFigure(plugin, ir, await renderFigure(plugin, ir))
    assert.equal(v.ok, true)
    assert.deepEqual(v.warnings.map((w) => [w.name, w.key, w.value]), [
      ['tier-count', 'budget:tiers', 8],
      ['label-length', 'budget:label', 16],
      ['emphasis-count', 'budget:emphasis', 3],
    ])
    const clean = validIr('pyramid-simple.yaml')
    const cv = await verifyFigure(plugin, clean, await renderFigure(plugin, clean))
    for (const name of ['tier-count', 'label-length', 'emphasis-count']) {
      const row = byName(cv.checks, name)
      assert.equal(row.severity, 'warn')
      assert.equal(row.ok, true)
      assert.equal('key' in row, false)
    }
  })
})

// --- draw ------------------------------------------------------------------

describe('figures/pyramid.mjs: draw', () => {
  test('tiers are trapezoid polygons with stepped neutral fills; emphasis = accent stroke + bold; tone = token fill; labels escaped; data-value set', async () => {
    const raw = {
      id: 'd', type: 'pyramid', variant: 'funnel', title: 't',
      tiers: [
        { id: 'a', label: 'A & <B>', value: 100, emphasis: true, tone: 'ts' },
        { id: 'b', label: 'B', value: 50, note: 'x<y' },
        { id: 'c', label: 'C', value: 10 },
      ],
    }
    const r = validateIR(raw)
    assert.equal(r.ok, true, JSON.stringify(r))
    const { svg } = await renderFigure(plugin, r.ir)
    assert.match(svg, /<polygon id="wu-d-d-t-a" data-tone="ts" data-value="100" points="[^"]+" fill="var\(--wu-fig-tone-ts\)" class="wu-focal" stroke="var\(--wu-accent\)" stroke-width="1.5"/)
    assert.match(svg, /<polygon id="wu-d-d-t-b" data-tone="neutral" data-value="50" points="[^"]+" fill="currentColor" fill-opacity="0\.17" stroke="currentColor" stroke-width="1"/)
    assert.match(svg, /<polygon id="wu-d-d-t-c"[^>]*fill-opacity="0\.3"/)
    assert.match(svg, /<text id="wu-d-d-t-a-label"[^>]*font-weight="700"[^>]*>A &amp; &lt;B&gt;<\/text>/)
    assert.match(svg, /<text id="wu-d-d-t-b-note"[^>]*font-size="11"[^>]*>x&lt;y<\/text>/)
    assert.match(svg, /<text id="wu-d-d-t-c-value"[^>]*text-anchor="end"[^>]*>10<\/text>/)
    const points = /<polygon id="wu-d-d-t-a"[^>]*points="([^"]+)"/.exec(svg)[1].split(' ')
    assert.equal(points.length, 4, 'a tier is a 4-corner trapezoid')
    const polygons = [...svg.matchAll(/<polygon id="wu-d-d-t-(\w+)"/g)].map((m) => m[1])
    assert.deepEqual(polygons, ['b', 'c', 'a'], 'the emphasized tier is drawn last so its stroke stays on top')
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{6}\b/)
  })
})

// --- registry + CLI --------------------------------------------------------

describe('figures/pyramid.mjs: registry dispatch and CLI', () => {
  test('pyramid-simple.yaml and pyramid-funnel.yaml render as data-checks="pass" data-type="pyramid" figures', async () => {
    for (const name of ['pyramid-simple.yaml', 'pyramid-funnel.yaml']) {
      const rendered = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(rendered.checksOk, true, `${name}: ${JSON.stringify(rendered.failures)}`)
      assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="pyramid">/)
      assert.match(rendered.html, /<script type="text\/x-writeup-diagram">/)
    }
  })

  test('the registry lists pyramid with its limits and doc rows', () => {
    assert.equal(plugin.type, 'pyramid')
    assert.deepEqual(plugin.limits, { maxTiers: 7, maxLabelLen: 14, maxEmphasis: 2 })
    assert.deepEqual(plugin.doc.rows, OWN_ROWS)
  })

  test('doc.irExample is a 4-tier funnel with values and renders clean', async () => {
    const r = validateIR(parseYaml(plugin.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.variant, 'funnel')
    assert.equal(r.ir.tiers.length, 4)
    assert.ok(r.ir.tiers.every((t) => typeof t.value === 'number'))
    assert.equal(r.ir.tiers.filter((t) => t.emphasis).length, 1)
    const rendered = await renderFigureHtmlChecked(r.ir, { rawYaml: plugin.doc.irExample })
    assert.equal(rendered.checksOk, true, JSON.stringify(rendered.failures))
    assert.match(rendered.html, /^<figure class="wu-figure" data-checks="pass" data-type="pyramid">/)
    assert.match(rendered.html, /data-value="12000"/)
  })

  test('--figure prints a verified pyramid figure; --json reports warnings for the over-budget fixture', () => {
    const fig = runCli([join(FIXTURES, 'pyramid-funnel.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="pyramid">/)
    const json = runCli([join(FIXTURES, 'pyramid-over-budget.yaml'), '--json'])
    assert.equal(json.status, 0, json.stderr)
    const out = JSON.parse(json.stdout)
    assert.equal(out.ok, true)
    assert.deepEqual(out.warnings.map((w) => w.key), ['budget:tiers', 'budget:label', 'budget:emphasis'])
    assert.match(out.figureHtml, /data-warn="budget:tiers=8;budget:label=16;budget:emphasis=3" data-type="pyramid"/)
    const warnFig = runCli([join(FIXTURES, 'pyramid-over-budget.yaml'), '--figure'])
    assert.equal(warnFig.status, 0)
    assert.match(warnFig.stderr, /warning: budget:tiers=8/)
    const doc = runCli(['--doc', 'pyramid'])
    assert.equal(doc.status, 0)
    assert.match(doc.stdout, /^id: signup-funnel\ntype: pyramid\nvariant: funnel\n/)
  })
})
