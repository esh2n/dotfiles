import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, YamlError } from '../bin/lib/yaml-lite.mjs'

test('flat mapping of scalars', () => {
  const v = parse('id: d1\ntitle: 現在地\n')
  assert.deepEqual(v, { id: 'd1', title: '現在地' })
})

test('nested mapping', () => {
  const v = parse('a:\n  b: 1\n  c: 2\n')
  assert.deepEqual(v, { a: { b: 1, c: 2 } })
})

test('block sequence indented under its key', () => {
  const v = parse('nodes:\n  - id: a\n    label: A\n  - id: b\n    label: B\n')
  assert.deepEqual(v, { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })
})

test('block sequence at the same indent as its parent key (YAML allowance)', () => {
  const v = parse('groups:\n- id: browser\n  label: ブラウザ\n  tone: ts\n')
  assert.deepEqual(v, { groups: [{ id: 'browser', label: 'ブラウザ', tone: 'ts' }] })
})

test('inline sequence of scalars', () => {
  assert.deepEqual(parse('via: [gw]'), { via: ['gw'] })
  assert.deepEqual(parse('via: [gw, hub, edge]'), { via: ['gw', 'hub', 'edge'] })
  assert.deepEqual(parse('via: []'), { via: [] })
})

test('double-quoted scalar containing ": " is safe', () => {
  assert.deepEqual(parse('label: "A: push"'), { label: 'A: push' })
})

test('single-quoted scalar containing ": " is safe', () => {
  assert.deepEqual(parse("label: 'A: push'"), { label: 'A: push' })
})

test('single-quoted scalar with an escaped quote', () => {
  assert.deepEqual(parse("label: 'it''s ok'"), { label: "it's ok" })
})

test('unquoted value containing ": " is a clear error', () => {
  assert.throws(() => parse('label: A: push'), (e) => {
    assert.ok(e instanceof YamlError)
    assert.equal(e.line, 1)
    assert.match(e.message, /": "/)
    return true
  })
})

test('booleans, null, numbers', () => {
  assert.deepEqual(parse('dashed: true\nemphasis: false\nx: null\ny: ~\nn: 3\nf: 0.3\ne: 1.5e2\n'), {
    dashed: true, emphasis: false, x: null, y: null, n: 3, f: 0.3, e: 150,
  })
})

test('comments are stripped, quoted "#" is not', () => {
  const v = parse('id: x # trailing comment\n# full line comment\ntitle: "y # not a comment"\n')
  assert.deepEqual(v, { id: 'x', title: 'y # not a comment' })
})

test('tabs in indentation throw', () => {
  assert.throws(() => parse('a:\n\tb: 1\n'), (e) => {
    assert.ok(e instanceof YamlError)
    assert.equal(e.line, 2)
    assert.match(e.message, /tabs/)
    return true
  })
})

test('unterminated double-quoted string throws', () => {
  assert.throws(() => parse('label: "unterminated'), (e) => {
    assert.ok(e instanceof YamlError)
    assert.match(e.message, /unterminated/)
    return true
  })
})

test('unterminated single-quoted string throws', () => {
  assert.throws(() => parse("label: 'unterminated"), (e) => {
    assert.ok(e instanceof YamlError)
    assert.match(e.message, /unterminated/)
    return true
  })
})

test('unterminated inline sequence throws', () => {
  assert.throws(() => parse('via: [gw, hub'), YamlError)
})

test('bad (inconsistent) indentation throws with a line number', () => {
  assert.throws(() => parse('a:\n  x: 1\n   y: 2\n'), (e) => {
    assert.ok(e instanceof YamlError)
    assert.equal(e.line, 3)
    return true
  })
})

test('top-level content not starting at column 0 throws', () => {
  assert.throws(() => parse('  a: 1\n'), YamlError)
})

test('JSON input is accepted when it starts with "{"', () => {
  const v = parse('{"id":"x","nodes":[{"id":"a","label":"A"}]}')
  assert.deepEqual(v, { id: 'x', nodes: [{ id: 'a', label: 'A' }] })
})

test('the full contract IR example round-trips', () => {
  const src = [
    'id: d1',
    'title: 現在地',
    'caption: この絵が主張することを一文で',
    'direction: right',
    'groups:',
    '- id: browser',
    '  label: ブラウザ',
    '  tone: ts',
    'nodes:',
    '- id: spa',
    '  label: SPA',
    '  group: browser',
    '  tone: ts',
    '  dashed: true',
    '  emphasis: true',
    'edges:',
    '- from: spa',
    '  to: sdk',
    '  label: "呼ぶ"',
    '  kind: sync',
    '  from_side: right',
    '  to_side: left',
    '  via: [gw]',
    '  label_at: 0.3',
    '',
  ].join('\n')
  const v = parse(src)
  assert.equal(v.id, 'd1')
  assert.equal(v.groups[0].id, 'browser')
  assert.equal(v.nodes[0].dashed, true)
  assert.equal(v.nodes[0].emphasis, true)
  assert.deepEqual(v.edges[0].via, ['gw'])
  assert.equal(v.edges[0].label_at, 0.3)
  assert.equal(v.edges[0].label, '呼ぶ')
})

test('blank lines and comment-only lines between entries are ignored', () => {
  const v = parse('a: 1\n\n# comment\n\nb: 2\n')
  assert.deepEqual(v, { a: 1, b: 2 })
})

test('nested sequence of mappings two levels deep', () => {
  const v = parse('edges:\n- from: a\n  to: b\n  kind: sync\n- from: b\n  to: c\n  kind: async\n')
  assert.deepEqual(v, {
    edges: [
      { from: 'a', to: 'b', kind: 'sync' },
      { from: 'b', to: 'c', kind: 'async' },
    ],
  })
})

test('missing key before ":" throws', () => {
  assert.throws(() => parse(': value'), YamlError)
})

test('empty document returns null', () => {
  assert.equal(parse(''), null)
  assert.equal(parse('\n\n# just a comment\n'), null)
})
