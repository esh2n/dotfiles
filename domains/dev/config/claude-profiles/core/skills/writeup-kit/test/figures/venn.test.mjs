// `type: venn` — schema, budgets, layout, verify rows, the registry
// dispatch and the CLI. Fixtures: test/fixtures/venn-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as venn from '../../bin/lib/figures/venn.mjs'
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
const plugin = () => getFigureType('venn')

function rawIr(overrides = {}) {
  return {
    id: 'v', type: 'venn', title: 't',
    sets: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    regions: [{ of: ['a', 'b'], label: 'both' }],
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

const insideCircle = (c, x, y) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r * c.r
const corners = (b) => [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]

// --- schema ---------------------------------------------------------------

describe('figures/venn.mjs: schema', () => {
  test('a minimal valid venn IR normalizes: emphasis defaults to false, `of` is ordered by set order', () => {
    const result = validateIR(rawIr({ regions: [{ of: ['b', 'a'], label: 'both' }] }))
    assert.equal(result.ok, true)
    assert.equal(result.ir.type, 'venn')
    assert.deepEqual(result.ir.regions[0], { of: ['a', 'b'], label: 'both', emphasis: false })
    assert.deepEqual(result.warnings, [])
  })

  test('one set or four sets is a schema error (2 or 3 only)', () => {
    const one = validateIR(rawIr({ sets: [{ id: 'a', label: 'A' }], regions: [{ of: ['a'], label: 'x' }] }))
    assert.equal(one.ok, false)
    assert.equal(one.reason, 'schema')
    assert.match(one.message, /needs 2 or 3 sets \(got: 1\)/)
    const four = validateIR(rawIr({ sets: ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id })) }))
    assert.equal(four.ok, false)
    assert.match(four.message, /got: 4/)
  })

  test('a region naming an unknown set, a set twice, or a duplicated combination is a schema error', () => {
    assert.match(validateIR(rawIr({ regions: [{ of: ['a', 'zz'], label: 'x' }] })).message, /unknown set "zz"/)
    assert.match(validateIR(rawIr({ regions: [{ of: ['a', 'a'], label: 'x' }] })).message, /names set "a" twice/)
    const dup = validateIR(rawIr({ regions: [{ of: ['a', 'b'], label: 'x' }, { of: ['b', 'a'], label: 'y' }] }))
    assert.match(dup.message, /duplicates the region \[a, b\]/)
    assert.match(validateIR(rawIr({ regions: [{ of: [], label: 'x' }] })).message, /of must be a non-empty list/)
    assert.match(validateIR(rawIr({ regions: [{ of: ['a'], label: '' }] })).message, /regions\[0\]\.label is required/)
  })

  test('duplicate set ids and a non-boolean emphasis are schema errors', () => {
    assert.match(validateIR(rawIr({ sets: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }] })).message, /duplicate set id/)
    assert.match(validateIR(rawIr({ regions: [{ of: ['a'], label: 'x', emphasis: 'yes' }] })).message, /emphasis must be a boolean/)
  })

  test('normalize() is idempotent for every fixture', () => {
    for (const name of ['venn-two.yaml', 'venn-three.yaml', 'venn-over-budget.yaml']) {
      const once = venn.normalize(parseYaml(fixture(name)))
      assert.deepEqual(venn.normalize(once), once, name)
    }
  })
})

// --- budgets --------------------------------------------------------------

describe('figures/venn.mjs: budgets', () => {
  test('the over-budget fixture warns on label and emphasis in stable order', () => {
    const result = validateIR(parseYaml(fixture('venn-over-budget.yaml')))
    assert.equal(result.ok, true)
    assert.equal(formatBudgetWarnings(result.warnings), 'budget:label=16;budget:emphasis=3')
    assert.match(result.warnings[0].detail, /sets\[0\]\.label/)
    assert.match(result.warnings[0].hint, /shorten sets\[0\]\.label/)
    assert.match(result.warnings[1].hint, /one intersection/)
  })

  test('a region count above the limit warns first; the 7-region fixture is at the limit, not over it', () => {
    const three = validIr('venn-three.yaml')
    assert.equal(three.regions.length, 7)
    assert.deepEqual(venn.budgetWarnings(three), [])
    const over = structuredClone(three)
    over.regions.push({ of: ['can'], label: 'extra', emphasis: false })
    const w = venn.budgetWarnings(over)
    assert.equal(w[0].key, 'budget:regions')
    assert.equal(w[0].value, 8)
    assert.deepEqual(plugin().limits, { maxSets: 3, maxRegions: 7, maxLabelLen: 14, maxEmphasis: 2 })
  })
})

// --- layout ---------------------------------------------------------------

describe('figures/venn.mjs: layout', () => {
  test('two sets: side by side, equal radius, set labels above and outside, canvas within the column and on the grid', async () => {
    const { r } = await rendered('venn-two.yaml')
    const { circles, sets } = r.layout.geo
    assert.equal(circles.length, 2)
    assert.equal(circles[0].cy, circles[1].cy)
    assert.equal(circles[0].r, circles[1].r)
    assert.ok(circles[1].cx - circles[0].cx < 2 * circles[0].r, 'the circles overlap')
    assert.ok(r.width <= COLUMN && !r.scaled && !r.scroll)
    assert.equal(r.width % 4, 0)
    assert.equal(r.height % 4, 0)
    for (const c of circles) { assert.equal(c.cx % 4, 0); assert.equal(c.cy % 4, 0) }
    assert.deepEqual(sets.map((s) => s.anchor), ['end', 'start'])
    for (const s of sets) {
      assert.equal(s.x % 4, 0); assert.equal(s.y % 4, 0)
      assert.ok(s.box.bottom < circles[0].cy - circles[0].r, 'set label sits above the circles')
    }
  })

  test('three sets: a triangle (one on top, two below), labels above / below-right / below-left', async () => {
    const { r } = await rendered('venn-three.yaml')
    const { circles, sets } = r.layout.geo
    assert.equal(circles.length, 3)
    assert.ok(circles[0].cy < circles[1].cy && circles[1].cy === circles[2].cy)
    assert.ok(circles[2].cx < circles[0].cx && circles[0].cx < circles[1].cx)
    assert.deepEqual(sets.map((s) => s.place), ['above-middle', 'below-right', 'below-left'])
    assert.ok(sets[0].box.bottom < circles[0].cy - circles[0].r)
    assert.ok(sets[1].box.top > circles[1].cy + circles[1].r)
    assert.ok(sets[2].box.top > circles[2].cy + circles[2].r)
    assert.ok(r.width <= COLUMN && !r.scaled && !r.scroll)
  })

  test('every region label sits at a grid point inside exactly the sets it names, wrapped to at most two lines', async () => {
    for (const name of ['venn-two.yaml', 'venn-three.yaml']) {
      const { ir, r } = await rendered(name)
      const { circles, regions } = r.layout.geo
      assert.equal(regions.length, ir.regions.length)
      for (const l of regions) {
        assert.equal(l.x % 4, 0, `${name} ${l.key}`)
        assert.equal(l.y % 4, 0)
        assert.ok(l.lines.length >= 1 && l.lines.length <= 2)
        assert.equal(l.lines.join(' ').replace(/\s+/g, ''), l.text.replace(/\s+/g, ''))
        for (const [x, y] of [...corners(l.box), [l.x, l.y]]) {
          const members = circles.filter((c) => insideCircle(c, x, y)).map((c) => c.id)
          assert.deepEqual(members, l.of, `${name}: "${l.text}" at (${x},${y})`)
        }
      }
    }
  })

  test('a label too wide for one line in a pairwise sliver wraps; a short one stays on one line', async () => {
    const { r } = await rendered('venn-three.yaml')
    const byKey = Object.fromEntries(r.layout.geo.regions.map((l) => [l.key, l]))
    assert.equal(byKey['can+wanted'].lines.length, 2)
    assert.equal(byKey['can+paid'].lines.length, 1)
    assert.equal(byKey['can+wanted+paid'].lines.length, 1)
    const two = await rendered('venn-two.yaml')
    const lens = two.r.layout.geo.regions.find((l) => l.key === 'sre+dev')
    assert.deepEqual(lens.lines, ['SLO', 'ダッシュボード'], 'a space cut beats a balanced cut through a word')
  })

  test('overlaps darken by stacking one translucent fill; emphasis is a bold label in an accent-stroked pill, never a coloured region', async () => {
    const { r } = await rendered('venn-three.yaml')
    assert.match(r.svg, /<g id="wu-d-v3-sets" fill="currentColor" fill-opacity="0.06" stroke="var\(--wu-ink-3\)" stroke-width="1">/)
    assert.equal((r.svg.match(/<circle id="wu-d-v3-set-/g) || []).length, 3)
    assert.doesNotMatch(r.svg, /fill="var\(--wu-accent/)
    assert.match(r.svg, /<rect id="wu-d-v3-region-can\+wanted\+paid-focal" class="wu-focal" [^>]*rx="4" fill="none" stroke="currentColor" stroke-width="1.5"\/>/)
    assert.equal((r.svg.match(/class="wu-focal"/g) || []).length, 1)
    assert.match(r.svg, /<text id="wu-d-v3-region-can\+wanted\+paid-label" [^>]*font-weight="700"><tspan[^>]*>狙う領域<\/tspan><\/text>/)
    assert.match(r.svg, /<text id="wu-d-v3-region-can\+wanted-label" [^>]*><tspan[^>]*>頼られ<\/tspan><tspan[^>]*>る仕事<\/tspan><\/text>/)
    assert.match(r.svg, /<text id="wu-d-v3-set-can-label" x="\d+" y="\d+" text-anchor="middle">できる<\/text>/)
  })

  test('layout and svg are deterministic: two renders of the same IR are deep-equal / byte-equal', async () => {
    for (const name of ['venn-two.yaml', 'venn-three.yaml']) {
      const a = await rendered(name)
      const b = await rendered(name)
      assert.deepEqual(a.r.layout, b.r.layout)
      assert.equal(a.r.svg, b.r.svg)
    }
  })
})

// --- verify rows ----------------------------------------------------------

describe('figures/venn.mjs: verify rows', () => {
  test('a clean figure passes every own and shared row; doc.rows lists the own rows in order', async () => {
    for (const name of ['venn-two.yaml', 'venn-three.yaml']) {
      const { ir, r } = await rendered(name)
      const result = await verifyFigure(plugin(), ir, r)
      assert.equal(result.ok, true, `${name}: ${JSON.stringify(result.failures)}`)
      assert.deepEqual(result.warnings, [])
      assert.deepEqual(result.checks.slice(0, 7).map((c) => c.name), venn.doc.rows)
    }
    assert.deepEqual(venn.doc.rows, ['region-count', 'label-length', 'emphasis-count', 'regions-valid', 'region-labels-inside', 'set-labels-outside', 'labels-no-overlap'])
  })

  test('#1–#3 budget rows warn (never fail) and carry key/value for data-warn', async () => {
    const { ir, r } = await rendered('venn-over-budget.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    assert.equal(result.ok, true)
    assert.equal(byName(result.checks, 'label-length').ok, false)
    assert.equal(byName(result.checks, 'label-length').severity, 'warn')
    assert.equal(byName(result.checks, 'emphasis-count').value, 3)
    assert.deepEqual(result.warnings.map((w) => w.key), ['budget:label', 'budget:emphasis'])
    const many = structuredClone(validIr('venn-three.yaml'))
    many.regions.push({ of: ['can'], label: 'dup', emphasis: false })
    const m = await verifyFigure(plugin(), many, await renderFigure(plugin(), many))
    assert.equal(byName(m.checks, 'region-count').ok, false)
    assert.equal(byName(m.checks, 'region-count').key, 'budget:regions')
  })

  test('#4 regions-valid fails on an unknown set reference or a duplicated combination in a mutated IR', async () => {
    const { ir, r } = await rendered('venn-two.yaml')
    const unknown = structuredClone(ir)
    unknown.regions[0].of = ['zz']
    const a = await verifyFigure(plugin(), unknown, r)
    assert.equal(byName(a.checks, 'regions-valid').ok, false)
    assert.match(byName(a.checks, 'regions-valid').detail, /regions\[0\] references unknown set\(s\) "zz"/)
    assert.equal(a.ok, false)
    const dup = structuredClone(ir)
    dup.regions[1].of = ['sre']
    const b = await verifyFigure(plugin(), dup, r)
    assert.match(byName(b.checks, 'regions-valid').detail, /regions\[1\] duplicates \[sre\]/)
  })

  test('#5 region-labels-inside fails when a label box is moved out of its region', async () => {
    const { ir, r } = await rendered('venn-three.yaml')
    const bad = structuredClone(r)
    const l = bad.layout.geo.regions.find((x) => x.key === 'can+wanted+paid')
    l.box = { left: l.box.left + 80, top: l.box.top, right: l.box.right + 80, bottom: l.box.bottom }
    const result = await verifyFigure(plugin(), ir, bad)
    assert.equal(byName(result.checks, 'region-labels-inside').ok, false)
    assert.match(byName(result.checks, 'region-labels-inside').detail, /"狙う領域" leaves region \[can, wanted, paid\]/)
    assert.equal(result.ok, false)
  })

  test('#6 set-labels-outside fails when a set label is moved into a circle', async () => {
    const { ir, r } = await rendered('venn-two.yaml')
    const bad = structuredClone(r)
    const c = bad.layout.geo.circles[0]
    bad.layout.geo.sets[0].box = { left: c.cx - 30, top: c.cy - 8, right: c.cx + 30, bottom: c.cy + 8 }
    const result = await verifyFigure(plugin(), ir, bad)
    assert.equal(byName(result.checks, 'set-labels-outside').ok, false)
    assert.match(byName(result.checks, 'set-labels-outside').detail, /"SRE チーム" enters a circle/)
    assert.equal(result.ok, false)
  })

  test('#7 labels-no-overlap fails when two label boxes collide (set vs set, region vs region)', async () => {
    const { ir, r } = await rendered('venn-two.yaml')
    const sets = structuredClone(r)
    sets.layout.geo.sets[1].box = { ...sets.layout.geo.sets[0].box }
    const a = await verifyFigure(plugin(), ir, sets)
    assert.equal(byName(a.checks, 'labels-no-overlap').ok, false)
    assert.match(byName(a.checks, 'labels-no-overlap').detail, /set "SRE チーム" overlaps set "開発チーム"/)
    const regions = structuredClone(r)
    regions.layout.geo.regions[1].box = { ...regions.layout.geo.regions[0].box }
    const b = await verifyFigure(plugin(), ir, regions)
    assert.match(byName(b.checks, 'labels-no-overlap').detail, /region "基盤アラート" overlaps region "機能ログ"/)
  })

  test('the shared rows follow the plugin rows: grid-4px, dark-3-state, stroke-radius, font-size all green', async () => {
    const { ir, r } = await rendered('venn-three.yaml')
    const result = await verifyFigure(plugin(), ir, r)
    for (const name of ['grid-4px', 'dark-3-state', 'stroke-radius', 'font-size', 'a11y', 'single-finite-svg', 'projected-scale']) {
      assert.equal(byName(result.checks, name).ok, true, `${name}: ${byName(result.checks, name).detail}`)
    }
    assert.equal(byName(result.checks, 'single-finite-svg').id, 8)
    assert.equal(byName(result.checks, 'grid-4px').id, 13)
  })
})

// --- registry dispatch + CLI ----------------------------------------------

describe('figures/venn.mjs: renderFigureHtmlChecked and the CLI', () => {
  test('venn-two and venn-three render as data-checks="pass" data-type="venn" figures', async () => {
    for (const name of ['venn-two.yaml', 'venn-three.yaml']) {
      const out = await renderFigureHtmlChecked(validIr(name), { rawYaml: fixture(name) })
      assert.equal(out.checksOk, true, `${name}: ${JSON.stringify(out.failures)}`)
      assert.match(out.html, /^<figure class="wu-figure" data-checks="pass" data-type="venn">/)
      assert.match(out.html, /<script type="text\/x-writeup-diagram">/)
    }
  })

  test('the over-budget fixture still passes, carrying data-warn with every geometry row green', async () => {
    const out = await renderFigureHtmlChecked(validIr('venn-over-budget.yaml'), { rawYaml: fixture('venn-over-budget.yaml') })
    assert.equal(out.checksOk, true, JSON.stringify(out.failures))
    assert.equal(out.warn, 'budget:label=16;budget:emphasis=3')
    assert.ok(out.html.startsWith('<figure class="wu-figure" data-checks="pass" data-warn="budget:label=16;budget:emphasis=3" data-type="venn">'))
  })

  test('CLI: --figure exits 0 with the figure, --json reports ok + checks, --doc venn renders clean', () => {
    const fig = runCli([join(FIXTURES, 'venn-three.yaml'), '--figure'])
    assert.equal(fig.status, 0, fig.stderr)
    assert.match(fig.stdout, /data-type="venn"/)
    const json = runCli([join(FIXTURES, 'venn-two.yaml'), '--json'])
    assert.equal(json.status, 0)
    const parsed = JSON.parse(json.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(parsed.checks.some((c) => c.name === 'region-labels-inside' && c.ok))
    const doc = runCli(['--doc', 'venn'])
    assert.equal(doc.status, 0)
    const example = validateIR(parseYaml(doc.stdout))
    assert.ok(example.ok)
    assert.equal(example.ir.sets.length, 3)
    assert.equal(example.ir.regions.length, 4)
    assert.deepEqual(example.warnings, [])
  })
})
