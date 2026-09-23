// `type: schema` — schema, budgets, layout (er / class / db variants),
// verify rows, the registry dispatch and the CLI. Fixtures:
// test/fixtures/schema-*.yaml.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { validateIR, formatBudgetWarnings } from '../../bin/lib/ir.mjs'
import * as schema from '../../bin/lib/figures/schema.mjs'
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
const runCli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })

const entity = (id, label, extra = {}) => ({ id, label, ...extra })
const minimal = () => ({
  id: 's', type: 'schema', title: 't',
  entities: [
    entity('a', 'A', { fields: [{ name: 'id', type: 'uuid', key: 'pk' }] }),
    entity('b', 'B', { fields: [{ name: 'a_id', key: 'fk' }], tone: 'rs' }),
  ],
  relations: [{ from: 'a', to: 'b', label: 'x' }],
})

async function rendered(name) {
  const ir = validIr(name)
  const out = await renderFigure(schema, ir)
  return { ir, out, geo: out.layout.geo }
}

const FIXTURE_NAMES = ['schema-er.yaml', 'schema-class.yaml', 'schema-db.yaml']
// schema-db.yaml carries a 10-column table on purpose: it is what the
// "+N more" row is drawn from, and the hidden columns still count.
const FIXTURE_WARNINGS = { 'schema-db.yaml': ['budget:fields'] }
const warnKeysOf = (name) => FIXTURE_WARNINGS[name] ?? []

// --- schema ---------------------------------------------------------------

describe('schema: schema', () => {
  test('a minimal valid IR normalizes with variant er, direction auto, kind one-many, empty methods and cards', () => {
    const r = validateIR(minimal())
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.type, 'schema')
    assert.equal(r.ir.variant, 'er')
    assert.equal(r.ir.direction, 'auto')
    assert.deepEqual(r.ir.entities[0], { id: 'a', label: 'A', fields: [{ name: 'id', type: 'uuid', key: 'pk', note: undefined }], methods: [], emphasis: false, tone: 'neutral' })
    assert.equal(r.ir.entities[1].tone, 'rs')
    assert.deepEqual(r.ir.relations, [{ from: 'a', to: 'b', kind: 'one-many', label: 'x', from_card: undefined, to_card: undefined, onDelete: undefined }])
    assert.deepEqual(r.warnings, [])
  })

  test('normalize is idempotent for every fixture and the minimal IR', () => {
    for (const name of FIXTURE_NAMES) {
      const once = schema.normalize(parseYaml(fixture(name)))
      assert.deepEqual(schema.normalize(once), once, name)
    }
    assert.deepEqual(schema.normalize(schema.normalize(minimal())), schema.normalize(minimal()))
  })

  test('numeric cardinalities become strings; explicit cards override the kind defaults', async () => {
    const raw = minimal()
    raw.relations[0] = { from: 'a', to: 'b', kind: 'one-many', from_card: 1, to_card: '0..*' }
    const ir = validateIR(raw).ir
    assert.deepEqual([ir.relations[0].from_card, ir.relations[0].to_card], ['1', '0..*'])
    const out = await renderFigure(schema, ir)
    assert.deepEqual(out.layout.geo.edges[0].ends.map((n) => n.card), ['1', '0..*'])
  })

  test('unknown entity refs, self relations, bad variant/kind/key, duplicate ids and non-string methods are schema errors naming the path', () => {
    const unknown = validateIR({ ...minimal(), relations: [{ from: 'a', to: 'zz' }] })
    assert.equal(unknown.ok, false)
    assert.equal(unknown.reason, 'schema')
    assert.match(unknown.message, /^ir\.relations\[0\]\.to references unknown entity "zz"$/)
    assert.match(validateIR({ ...minimal(), relations: [{ from: 'a', to: 'a' }] }).message, /from and to must differ/)
    assert.match(validateIR({ ...minimal(), variant: 'uml' }).message, /^ir\.variant must be er\|class\|db/)
    assert.match(validateIR({ ...minimal(), relations: [{ from: 'a', to: 'b', kind: 'composes' }] }).message, /^ir\.relations\[0\]\.kind must be one-many\|many-many\|one-one\|inherits\|uses\|composition\|aggregation/)
    const badKey = minimal()
    badKey.entities[0].fields[0].key = 'uq'
    assert.match(validateIR(badKey).message, /^ir\.entities\[0\]\.fields\[0\]\.key must be pk\|fk/)
    assert.match(validateIR({ ...minimal(), entities: [entity('a', 'A'), entity('a', 'A2')], relations: [] }).message, /duplicate entity id: "a"/)
    const badMethod = minimal()
    badMethod.entities[0].methods = ['ok()', 3]
    assert.match(validateIR(badMethod).message, /^ir\.entities\[0\]\.methods\[1\] must be a non-empty string$/)
    assert.match(validateIR({ ...minimal(), entities: [] }).message, /entities must be a non-empty list/)
  })

  test('onDelete is db-only and composition/aggregation are class-only; each is accepted in its own variant', () => {
    const withOd = (variant) => ({ ...minimal(), variant, relations: [{ from: 'a', to: 'b', onDelete: 'cascade' }] })
    assert.match(validateIR(withOd('er')).message, /^ir\.relations\[0\]\.onDelete belongs to variant: db$/)
    assert.match(validateIR(withOd('class')).message, /^ir\.relations\[0\]\.onDelete belongs to variant: db$/)
    assert.equal(validateIR(withOd('db')).ir.relations[0].onDelete, 'cascade')
    assert.match(validateIR({ ...withOd('db'), relations: [{ from: 'a', to: 'b', onDelete: '  ' }] }).message, /onDelete must be a non-empty string/)

    const withKind = (variant, kind) => ({ ...minimal(), variant, relations: [{ from: 'a', to: 'b', kind }] })
    assert.match(validateIR(withKind('er', 'composition')).message, /^ir\.relations\[0\]\.kind: composition belongs to variant: class$/)
    assert.match(validateIR(withKind('db', 'aggregation')).message, /^ir\.relations\[0\]\.kind: aggregation belongs to variant: class$/)
    assert.equal(validateIR(withKind('class', 'composition')).ir.relations[0].kind, 'composition')
    assert.equal(validateIR(withKind('class', 'aggregation')).ir.relations[0].kind, 'aggregation')
  })
})

// --- budgets ----------------------------------------------------------------

describe('schema: budgets are advisory warnings in a stable order', () => {
  test('the over-budget fixture warns entities → fields → relations → label → emphasis, still renders, and the warnings reach data-warn', async () => {
    const r = validateIR(parseYaml(fixture('schema-over-budget.yaml')))
    assert.equal(r.ok, true)
    assert.deepEqual(r.warnings.map((w) => `${w.key}=${w.value}`), ['budget:entities=9', 'budget:fields=9', 'budget:relations=13', 'budget:label=16', 'budget:emphasis=3'])
    assert.equal(formatBudgetWarnings(r.warnings), 'budget:entities=9;budget:fields=9;budget:relations=13;budget:label=16;budget:emphasis=3')
    assert.match(r.warnings[1].detail, /entity "e1" lists 9 fields/)
    assert.deepEqual(schema.budgetWarnings(r.ir), r.warnings)
    const html = await renderFigureHtmlChecked(r.ir)
    assert.equal(html.checksOk, true, JSON.stringify(html.failures))
    assert.match(html.html, /data-checks="pass"/)
    assert.match(html.html, /data-warn="budget:entities=9;budget:fields=9;budget:relations=13;budget:label=16;budget:emphasis=3"/)
  })

  test('a relation label over 14 chars is named as such; every fixture and the doc example are within budget', () => {
    const raw = minimal()
    raw.relations[0].label = 'とても長い関係の名前が十四文字を超える'
    const r = validateIR(raw)
    assert.deepEqual(r.warnings.map((w) => w.key), ['budget:label'])
    assert.match(r.warnings[0].hint, /shorten the label of relation 0 \("a"→"b"\)/)
    for (const name of FIXTURE_NAMES) assert.deepEqual(validateIR(parseYaml(fixture(name))).warnings.map((w) => w.key), warnKeysOf(name), name)
    assert.deepEqual(validateIR(parseYaml(schema.doc.irExample)).warnings, [])
  })

  test('db and class budget entities/relations tighter than er, and class counts each compartment on its own', () => {
    const table = (id, n) => entity(id, id, { fields: Array.from({ length: n }, (_, i) => ({ name: `f${i}` })) })
    const many = (variant, count) => ({
      id: 's', type: 'schema', title: 't', variant,
      entities: Array.from({ length: count }, (_, i) => table(`t${i}`, 1)),
      relations: Array.from({ length: count - 1 }, (_, i) => ({ from: `t${i}`, to: `t${i + 1}` })),
    })
    // 6 tables / 5 relations: fine as er, over budget as db
    assert.deepEqual(validateIR(many('er', 6)).warnings.map((w) => w.key), [])
    const db = validateIR(many('db', 6)).warnings
    assert.deepEqual(db.map((w) => `${w.key}=${w.value}`), ['budget:entities=6'])
    assert.match(db[0].detail, /guidance ≤ 5 for variant: db/)
    assert.deepEqual(validateIR(many('db', 8)).warnings.map((w) => `${w.key}=${w.value}`), ['budget:entities=8', 'budget:relations=7'])
    assert.deepEqual(validateIR(many('class', 8)).warnings.map((w) => `${w.key}=${w.value}`), ['budget:entities=8'])

    // class: 6 fields is over the 5-per-compartment budget, and methods count too
    const cls = (extra) => ({ id: 's', type: 'schema', title: 't', variant: 'class', entities: [{ ...table('a', 6), ...extra }], relations: [] })
    assert.match(validateIR(cls()).warnings[0].detail, /entity "a" lists 6 fields \(guidance ≤ 5\)/)
    const methods = validateIR({ id: 's', type: 'schema', title: 't', variant: 'class', entities: [entity('a', 'A', { methods: ['m1()', 'm2()', 'm3()', 'm4()', 'm5()', 'm6()', 'm7()'] })], relations: [] })
    assert.match(methods.warnings[0].detail, /entity "a" lists 7 methods \(guidance ≤ 5\)/)
    // er/db keep the 8-line budget and never look at methods
    assert.deepEqual(validateIR({ ...cls(), variant: 'er' }).warnings, [])
  })
})

// --- layout -------------------------------------------------------------------

describe('schema: layout', () => {
  test('er: boxes are sized from their longest line, sit on the grid, never overlap, and the layout picks "right" when it fits the column', async () => {
    const { ir, out, geo } = await rendered('schema-er.yaml')
    assert.equal(geo.direction, 'right')
    assert.equal(geo.boxes.length, 5)
    assert.ok(out.width <= 720)
    for (const b of geo.boxes) {
      assert.equal(b.x % 4, 0); assert.equal(b.y % 4, 0)
      assert.ok(b.width >= 120, `${b.id} at least MIN_W`)
      assert.equal(b.height, 28 + b.rows.length * 20 + 4, `${b.id} height = header + rows + pad`)
    }
    const order = geo.boxes.find((b) => b.id === 'order')
    const line = geo.boxes.find((b) => b.id === 'line')
    assert.ok(order.width > line.width, 'the entity with the wider status note gets the wider box')
    for (let i = 0; i < geo.boxes.length; i++) {
      for (let j = i + 1; j < geo.boxes.length; j++) {
        const a = geo.boxes[i], b = geo.boxes[j]
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.id} vs ${b.id}`)
      }
    }
    assert.equal(ir.variant, 'er')
  })

  test('relations are orthogonal, start/end on the box borders, and two relations on one side fan out to distinct ports', async () => {
    const { geo } = await rendered('schema-er.yaml')
    const byId = new Map(geo.boxes.map((b) => [b.id, b]))
    for (const e of geo.edges) {
      for (let i = 0; i < e.points.length - 1; i++) {
        const p = e.points[i], q = e.points[i + 1]
        assert.ok(p.x === q.x || p.y === q.y, `relation ${e.index} segment ${i} orthogonal`)
        assert.equal(p.x % 4, 0); assert.equal(p.y % 4, 0)
      }
    }
    // product → line and product → tag both leave product's right side
    const fromProduct = geo.edges.filter((e) => e.from === 'product')
    assert.equal(fromProduct.length, 2)
    assert.deepEqual(fromProduct.map((e) => e.sides[0]), ['right', 'right'])
    assert.notEqual(fromProduct[0].points[0].y, fromProduct[1].points[0].y)
    const product = byId.get('product')
    for (const e of fromProduct) assert.equal(e.points[0].x, product.x + product.width)
  })

  test('variants: er draws crow/bar markers with 1/N text, class draws methods, a hollow triangle and a dashed uses arrow, db tags PK/FK and shows no cardinality text', async () => {
    const er = await rendered('schema-er.yaml')
    const oneMany = er.geo.edges.find((e) => e.from === 'customer')
    assert.deepEqual(oneMany.ends.map((n) => n.marker), ['bar', 'crow'])
    assert.deepEqual(oneMany.ends.map((n) => n.card), ['1', 'N'])
    const manyMany = er.geo.edges.find((e) => e.to === 'tag')
    assert.deepEqual(manyMany.ends.map((n) => n.marker), ['crow', 'crow'])
    assert.match(er.out.svg, /text-decoration="underline"/)
    assert.doesNotMatch(er.out.svg, />PK</)

    const cls = await rendered('schema-class.yaml')
    const shape = cls.geo.boxes.find((b) => b.id === 'shape')
    assert.equal(shape.methods.length, 2)
    assert.ok(shape.methodsTop > 28 + shape.rows.length * 20)
    const inherits = cls.geo.edges.find((e) => e.kind === 'inherits')
    assert.deepEqual(inherits.ends.map((n) => n.marker), [null, 'tri'])
    const uses = cls.geo.edges.find((e) => e.kind === 'uses')
    assert.deepEqual(uses.ends.map((n) => n.marker), [null, 'open'])
    assert.equal(uses.dash, true)
    const holds = cls.geo.edges.find((e) => e.kind === 'composition')
    assert.deepEqual(holds.ends.map((n) => n.card), ['1', '*'])
    assert.match(cls.out.svg, /marker-end="url\(#wu-d-s-class-tri\)"/)
    assert.match(cls.out.svg, /stroke-dasharray="5 4"/)
    assert.ok(cls.out.layout.legend.items.some((i) => i.marker === 'tri'))

    const db = await rendered('schema-db.yaml')
    const orders = db.geo.boxes.find((b) => b.id === 'orders')
    assert.deepEqual(orders.rows.map((r) => r.tag), ['PK', 'FK', '', ''])
    assert.match(db.out.svg, />PK</)
    assert.match(db.out.svg, />FK</)
    for (const e of db.geo.edges) assert.deepEqual(e.ends.map((n) => n.card), [undefined, undefined])
    assert.deepEqual(db.geo.edges[0].ends.map((n) => n.marker), ['bar', 'crow'])
  })

  test('class: composition and aggregation put a filled / hollow diamond at the owner end and nothing at the part end', async () => {
    const { out, geo } = await rendered('schema-class.yaml')
    const comp = geo.edges.find((e) => e.kind === 'composition')
    const agg = geo.edges.find((e) => e.kind === 'aggregation')
    assert.deepEqual(comp.ends.map((n) => n.marker), ['dia', null])
    assert.deepEqual(agg.ends.map((n) => n.marker), ['dia-open', null])
    // owner = the `from` entity: the diamond sits on Canvas's border
    for (const e of [comp, agg]) {
      const owner = geo.boxes.find((b) => b.id === e.from)
      assert.equal(e.from, 'canvas')
      assert.equal(e.points[0].x, owner.x + owner.width, 'diamond on the owner box border')
      assert.ok(e.ends[0].markerBox, 'the diamond has a box the label must dodge')
      assert.equal(e.dash, false)
    }
    assert.match(out.svg, /marker-start="url\(#wu-d-s-class-dia\)"/)
    assert.match(out.svg, /marker-start="url\(#wu-d-s-class-dia-open\)"/)
    assert.match(out.svg, /id="wu-d-s-class-dia" [^>]*><path d="M0 6 L6 1 L12 6 L6 11 z" fill="currentColor"/)
    assert.match(out.svg, /id="wu-d-s-class-dia-open" [^>]*><path d="M0 6 L6 1 L12 6 L6 11 z" fill="var\(--wu-surface\)"/)
    assert.deepEqual(out.layout.legend.items.map((i) => i.label), ['inherits', 'composition', 'aggregation', 'uses'])
  })

  test('db: a relation attaches to the row it joins — the parent PK row and the child FK row that names it', async () => {
    const { geo } = await rendered('schema-db.yaml')
    const byId = new Map(geo.boxes.map((b) => [b.id, b]))
    const rowBand = (boxId, name) => {
      const b = byId.get(boxId)
      const row = b.rows.find((r) => r.text === name)
      return [b.y + row.top, b.y + row.top + 20]
    }
    const touches = (e, k, boxId, name) => {
      const p = k === 0 ? e.points[0] : e.points[e.points.length - 1]
      const [top, bot] = rowBand(boxId, name)
      assert.ok(p.y >= top && p.y <= bot, `relation ${e.index} end ${k} at y=${p.y} is outside the "${name}" row (${top}–${bot})`)
      assert.ok(e.sides[k] === 'left' || e.sides[k] === 'right', 'db ports stay on the vertical sides')
    }
    const [users, orders, products] = ['users', 'orders', 'products'].map((id) => geo.edges.find((e) => e.from === id))
    assert.deepEqual(users.anchors, [{ box: 'users', row: 0, name: 'id' }, { box: 'orders', row: 1, name: 'user_id' }])
    touches(users, 0, 'users', 'id'); touches(users, 1, 'orders', 'user_id')
    touches(orders, 0, 'orders', 'id'); touches(orders, 1, 'order_items', 'order_id')
    touches(products, 0, 'products', 'id'); touches(products, 1, 'order_items', 'product_id')
    // the two FKs of order_items land on different rows
    assert.notEqual(orders.points[orders.points.length - 1].y, products.points[products.points.length - 1].y)
  })

  test('db: onDelete draws as a muted uppercase tag at the child end only', async () => {
    const { out, geo } = await rendered('schema-db.yaml')
    const cascade = geo.edges.find((e) => e.to === 'order_items' && e.from === 'orders')
    assert.deepEqual(cascade.ends.map((n) => n.onDelete), ['', 'CASCADE'])
    assert.equal(cascade.ends[0].odBox, null)
    const box = cascade.ends[1].odBox
    const P = cascade.points[cascade.points.length - 1]
    const child = geo.boxes.find((b) => b.id === 'order_items')
    assert.ok(Math.abs(box.y - P.y) <= 24, 'the tag hugs the line at the child end')
    assert.ok(box.x + box.width <= child.x, 'the tag stays outside the child table')
    assert.ok(box.x + box.width >= P.x - 100, 'the tag stays next to the end, not adrift in the gap')
    assert.match(out.svg, /<text id="wu-d-s-db-r1-od"[^>]*fill="var\(--wu-ink-3\)">CASCADE<\/text>/)
    assert.equal((out.svg.match(/-od"/g) || []).length, 3)
  })

  test('a field list past the budget shows the first 8 rows and a muted "+2 more"; the hidden columns still warn', async () => {
    const { ir, out, geo } = await rendered('schema-db.yaml')
    const users = geo.boxes.find((b) => b.id === 'users')
    assert.equal(ir.entities.find((e) => e.id === 'users').fields.length, 10)
    assert.equal(users.rows.length, 9)
    assert.deepEqual(users.rows.slice(-1), [{ name: '+2 more', text: '+2 more', right: '', tag: '', top: 28 + 8 * 20, more: true, hidden: 2 }])
    assert.equal(users.height, 28 + 9 * 20 + 4)
    assert.match(out.svg, /<text id="wu-d-s-db-users-f8"[^>]*fill="var\(--wu-ink-3\)">\+2 more<\/text>/)
    assert.doesNotMatch(out.svg, />deleted_at</)
    assert.deepEqual(schema.budgetWarnings(ir).map((w) => `${w.key}=${w.value}`), ['budget:fields=10'])
  })

  test('class: a long methods list collapses in its own compartment and the box grows for it', async () => {
    const raw = {
      id: 's', type: 'schema', title: 't', variant: 'class',
      entities: [entity('a', 'A', { fields: [{ name: 'f1' }, { name: 'f2' }, { name: 'f3' }, { name: 'f4' }, { name: 'f5' }, { name: 'f6' }, { name: 'f7' }], methods: ['m1()', 'm2()', 'm3()', 'm4()', 'm5()', 'm6()'] }), entity('b', 'B')],
      relations: [{ from: 'a', to: 'b', kind: 'aggregation' }],
    }
    const ir = validateIR(raw).ir
    const { geo } = { geo: (await schema.layout(ir)).geo }
    const a = geo.boxes.find((b) => b.id === 'a')
    assert.deepEqual(a.rows.map((r) => r.text), ['f1', 'f2', 'f3', 'f4', 'f5', '+2 more'])
    assert.deepEqual(a.methods.map((m) => m.text), ['m1()', 'm2()', 'm3()', 'm4()', 'm5()', '+1 more'])
    assert.equal(a.methods.at(-1).more, true)
    assert.equal(a.height, 28 + 6 * 20 + 8 + 6 * 20 + 4)
  })

  test('direction: down stacks a chain vertically; the wide chain falls back to down on its own', async () => {
    const chain = validateIR({ ...minimal(), direction: 'down' }).ir
    const g = (await schema.layout(chain)).geo
    const [a, b] = ['a', 'b'].map((id) => g.boxes.find((x) => x.id === id))
    assert.equal(g.direction, 'down')
    assert.ok(b.y >= a.y + a.height + 16)
    assert.deepEqual(g.edges[0].sides, ['bottom', 'top'])
    const over = validIr('schema-over-budget.yaml')
    const wide = await schema.layout(over)
    assert.equal(wide.geo.direction, 'down')
    assert.ok(wide.width <= 720)
  })

  test('layout is deterministic: same IR → byte-identical svg and deep-equal geometry', async () => {
    for (const name of FIXTURE_NAMES) {
      const ir = validIr(name)
      const a = await renderFigure(schema, ir)
      const b = await renderFigure(schema, ir)
      assert.equal(a.svg, b.svg, name)
      assert.deepEqual(a.layout, b.layout, name)
    }
  })
})

// --- verify rows ----------------------------------------------------------------

describe('schema: verify rows', () => {
  test('a real render of every fixture passes every fail row; rows 1–5 warn, 6–13 fail; the shared rows follow', async () => {
    for (const name of FIXTURE_NAMES) {
      const { ir, out } = await rendered(name)
      const result = await verifyFigure(schema, ir, out)
      assert.deepEqual(result.checks.filter((c) => !c.ok).map((c) => c.key), warnKeysOf(name), name)
      assert.deepEqual(result.checks.filter((c) => !c.ok && c.severity === 'fail'), [], name)
      assert.equal(result.ok, true)
      assert.deepEqual(result.checks.slice(0, 13).map((c) => c.severity), ['warn', 'warn', 'warn', 'warn', 'warn', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
      assert.deepEqual(result.checks.slice(0, 13).map((c) => c.name), schema.doc.rows)
      assert.equal(result.checks.length, 13 + 7)
    }
  })

  test('end-anchors fails when a db relation is pulled off its row or onto a horizontal side', async () => {
    const { ir, out } = await rendered('schema-db.yaml')
    const offRow = structuredClone(out)
    const e = offRow.layout.geo.edges[0]
    const users = offRow.layout.geo.boxes.find((b) => b.id === 'users')
    e.points[0].y = users.y + users.height // still on the border, but not on the "id" row
    e.points[1].y = e.points[0].y
    let result = await verifyFigure(schema, ir, offRow)
    assert.equal(byName(result.checks, 'end-anchors').ok, false)
    assert.match(byName(result.checks, 'end-anchors').detail, /relation 0 misses the "id" row of "users"/)
    assert.equal(result.ok, false)

    const offSide = structuredClone(out)
    offSide.layout.geo.edges[0].sides[1] = 'top'
    result = await verifyFigure(schema, ir, offSide)
    assert.match(byName(result.checks, 'end-anchors').detail, /relation 0 leaves "orders" on its top side, off the rows/)
  })

  test('marker-label-clear fails when an ON DELETE tag is pushed onto a relation line', async () => {
    const { ir, out } = await rendered('schema-db.yaml')
    const bad = structuredClone(out)
    const e = bad.layout.geo.edges[1]
    const onLine = bad.layout.geo.edges[0]
    e.ends[1].odBox.x = onLine.points[1].x - 8
    e.ends[1].odBox.y = onLine.points[1].y + 8
    const result = await verifyFigure(schema, ir, bad)
    assert.equal(byName(result.checks, 'marker-label-clear').ok, false)
    assert.match(byName(result.checks, 'marker-label-clear').detail, /the ON DELETE tag of relation 1 sits on a relation line/)
  })

  test('end-anchors fails when a diamond moves off the owner end', async () => {
    const { ir, out } = await rendered('schema-class.yaml')
    const moved = structuredClone(out)
    const comp = moved.layout.geo.edges.find((x) => x.kind === 'composition')
    comp.ends[0].marker = null
    comp.ends[1].marker = 'dia'
    const result = await verifyFigure(schema, ir, moved)
    assert.equal(byName(result.checks, 'end-anchors').ok, false)
    assert.match(byName(result.checks, 'end-anchors').detail, /\(composition\) has no diamond at the "canvas" end/)
    assert.match(byName(result.checks, 'end-anchors').detail, /marks the "shape" \(part\) end/)
  })

  test('end-anchors passes with nothing to check in er, and its ok detail names the variant', async () => {
    const { ir, out } = await rendered('schema-er.yaml')
    const result = await verifyFigure(schema, ir, out)
    const row = byName(result.checks, 'end-anchors')
    assert.equal(row.ok, true)
    assert.equal(row.detail, 'every diamond sits at the owner end (er)')
    const db = await rendered('schema-db.yaml')
    const dbRow = byName((await verifyFigure(schema, db.ir, db.out)).checks, 'end-anchors')
    assert.equal(dbRow.detail, 'every relation meets the key row it joins (db)')
  })

  test('relation-refs fails when a relation names an entity that has no box', async () => {
    const { ir, out } = await rendered('schema-er.yaml')
    const bad = structuredClone(out)
    bad.layout.geo.edges[0].to = 'ghost'
    const result = await verifyFigure(schema, ir, bad)
    assert.equal(byName(result.checks, 'relation-refs').ok, false)
    assert.match(byName(result.checks, 'relation-refs').detail, /relation 0 ends at unknown entity "ghost"/)
    assert.equal(result.ok, false)
  })

  test('box-overlap fails when one entity is moved onto another', async () => {
    const { ir, out } = await rendered('schema-er.yaml')
    const bad = structuredClone(out)
    const boxes = bad.layout.geo.boxes
    const customer = boxes.find((b) => b.id === 'customer')
    const order = boxes.find((b) => b.id === 'order')
    customer.x = order.x + 8
    customer.y = order.y + 8
    const result = await verifyFigure(schema, ir, bad)
    assert.equal(byName(result.checks, 'box-overlap').ok, false)
    assert.match(byName(result.checks, 'box-overlap').detail, /"customer" overlaps "order"/)
  })

  test('field-fit fails when a box is narrower than its longest field line or shorter than its rows', async () => {
    const { ir, out } = await rendered('schema-db.yaml')
    const narrow = structuredClone(out)
    narrow.layout.geo.boxes.find((b) => b.id === 'users').width = 80
    let result = await verifyFigure(schema, ir, narrow)
    assert.equal(byName(result.checks, 'field-fit').ok, false)
    assert.match(byName(result.checks, 'field-fit').detail, /field "email" of "users" is wider than its box/)
    const short = structuredClone(out)
    short.layout.geo.boxes.find((b) => b.id === 'orders').height = 60
    result = await verifyFigure(schema, ir, short)
    assert.match(byName(result.checks, 'field-fit').detail, /falls below its box/)
  })

  test('edges-orthogonal fails on a diagonal segment or an endpoint off the box border', async () => {
    const { ir, out } = await rendered('schema-er.yaml')
    const diag = structuredClone(out)
    const e = diag.layout.geo.edges.find((x) => x.points.length === 4)
    e.points[1].x += 8
    let result = await verifyFigure(schema, ir, diag)
    assert.equal(byName(result.checks, 'edges-orthogonal').ok, false)
    assert.match(byName(result.checks, 'edges-orthogonal').detail, /diagonal/)
    const off = structuredClone(out)
    off.layout.geo.edges[0].points[0].x -= 4
    result = await verifyFigure(schema, ir, off)
    assert.match(byName(result.checks, 'edges-orthogonal').detail, /does not start on the border of "customer"/)
  })

  test('edge-clearance fails when a relation is re-routed straight through another entity', async () => {
    const { ir, out } = await rendered('schema-er.yaml')
    const bad = structuredClone(out)
    const boxes = bad.layout.geo.boxes
    const product = boxes.find((b) => b.id === 'product')
    const line = boxes.find((b) => b.id === 'line')
    const e = bad.layout.geo.edges.find((x) => x.from === 'product' && x.to === 'line')
    const yThrough = line.y + 20
    e.points = [{ x: product.x + product.width, y: product.y + product.height }, { x: product.x + product.width, y: yThrough }, { x: line.x + line.width, y: yThrough }]
    // (starts on product's corner, ends on line's right border — passing through line itself)
    const result = await verifyFigure(schema, ir, bad)
    assert.equal(byName(result.checks, 'edges-orthogonal').ok, true)
    assert.equal(byName(result.checks, 'edge-clearance').ok, false)
    assert.match(byName(result.checks, 'edge-clearance').detail, /relation \d+ \("product"→"line"\) runs through an entity box/)
  })

  test('label-clear fails when a label sits on an entity; marker-label-clear fails when it sits on an end marker or cardinality', async () => {
    const { ir, out } = await rendered('schema-er.yaml')
    const onBox = structuredClone(out)
    const labelled = onBox.layout.geo.edges.find((x) => x.labelBox)
    const target = onBox.layout.geo.boxes.find((b) => b.id === 'order')
    labelled.labelBox.x = target.x + 8
    labelled.labelBox.y = target.y + 8
    let result = await verifyFigure(schema, ir, onBox)
    assert.equal(byName(result.checks, 'label-clear').ok, false)
    assert.match(byName(result.checks, 'label-clear').detail, /overlaps "order"/)

    const onMarker = structuredClone(out)
    const e = onMarker.layout.geo.edges.find((x) => x.labelBox)
    e.labelBox.x = e.ends[1].markerBox.x
    e.labelBox.y = e.ends[1].markerBox.y
    result = await verifyFigure(schema, ir, onMarker)
    assert.equal(byName(result.checks, 'marker-label-clear').ok, false)
    assert.match(byName(result.checks, 'marker-label-clear').detail, /overlaps the end marker of relation/)
  })

  test('emphasis-count warns (ok stays true overall) when 3 entities are emphasized', async () => {
    const raw = minimal()
    raw.entities.push(entity('c', 'C'))
    raw.entities.forEach((e) => { e.emphasis = true })
    const ir = validateIR(raw).ir
    const out = await renderFigure(schema, ir)
    const result = await verifyFigure(schema, ir, out)
    assert.equal(result.ok, true)
    assert.deepEqual(result.warnings.map((w) => `${w.key}=${w.value}`), ['budget:emphasis=3'])
    assert.equal(byName(result.checks, 'emphasis-count').severity, 'warn')
  })
})

// --- registry + CLI -----------------------------------------------------------------

describe('schema: registry dispatch and CLI', () => {
  test('the registry knows schema with its limits and rows; the doc example (4 ER entities) renders clean', async () => {
    const t = getFigureType('schema')
    assert.deepEqual(t.limits, { maxEntities: 8, maxFields: 8, maxRelations: 12, maxLabelLen: 14, maxEmphasis: 2 })
    assert.equal(t.doc.rows.length, 13)
    const r = validateIR(parseYaml(t.doc.irExample))
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.equal(r.ir.variant, 'er')
    assert.deepEqual(r.ir.entities.map((e) => e.label), ['顧客', '注文', '明細', '商品'])
    const html = await renderFigureHtmlChecked(r.ir)
    assert.match(html.html, /^<figure class="wu-figure" data-checks="pass" data-type="schema">/)
  })

  test('renderFigureHtmlChecked embeds the IR, carries data-type, and scales the db fixture to the column without scrolling', async () => {
    const ir = validIr('schema-db.yaml')
    const html = await renderFigureHtmlChecked(ir, { rawYaml: fixture('schema-db.yaml') })
    assert.equal(html.checksOk, true, JSON.stringify(html.failures))
    assert.match(html.html, /data-checks="pass" data-warn="budget:fields=10" data-type="schema"/)
    assert.doesNotMatch(html.html, /data-scroll/)
    assert.match(html.html, /variant: db/)
    assert.match(html.html, /onDelete: cascade/)
    assert.match(html.html, /class="wu-focal"/)
  })

  test('CLI: --figure exits 0 with a passing figure for every variant; --json carries figureHtml and the warnings of the over-budget fixture', () => {
    for (const name of FIXTURE_NAMES) {
      const ok = runCli([join(FIXTURES, name), '--figure'])
      assert.equal(ok.status, 0, ok.stderr)
      const warn = warnKeysOf(name)[0]
      if (warn) assert.match(ok.stdout, new RegExp(`^<figure class="wu-figure" data-checks="pass" data-warn="${warn}=\\d+" data-type="schema">`), name)
      else assert.match(ok.stdout, /^<figure class="wu-figure" data-checks="pass" data-type="schema">/, name)
    }
    const over = runCli([join(FIXTURES, 'schema-over-budget.yaml'), '--json'])
    assert.equal(over.status, 0, over.stderr)
    const j = JSON.parse(over.stdout)
    assert.ok(j.figureHtml)
    assert.equal(j.warn, 'budget:entities=9;budget:fields=9;budget:relations=13;budget:label=16;budget:emphasis=3')
    assert.deepEqual(j.warnings.map((w) => w.key), ['budget:entities', 'budget:fields', 'budget:relations', 'budget:label', 'budget:emphasis'])
  })
})
