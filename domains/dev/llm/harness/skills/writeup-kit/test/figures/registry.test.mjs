// figures/index.mjs — plugin discovery, the contract check, duplicate
// types, the builtin diagram descriptor, ir.mjs routing, and the
// `--list-types` / `--doc` CLI flags. Type-specific behaviour lives in
// test/figures/<type>.test.mjs.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  getFigureType, listFigureTypes, hasFigureType, isPluginType, loadFigureTypes, pluginFiles, assertPluginContract, PLUGIN_EXPORTS,
  renderFigure, verifyFigure,
} from '../../bin/lib/figures/index.mjs'
import { validateIR, LIMITS, DIAGRAM_ROWS, irTypes } from '../../bin/lib/ir.mjs'
import { parse as parseYaml } from '../../bin/lib/yaml-lite.mjs'
import { parseArgs, formatTypeList } from '../../bin/render-diagram.mjs'
import { SHARED_ROW_NAMES } from '../../bin/lib/figures/_shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const FIGURES_DIR = join(ROOT, 'bin', 'lib', 'figures')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** A minimal, contract-complete plugin source with `type` = `name`. */
function stubPlugin(name, { extra = '', omit = null } = {}) {
  const parts = {
    type: `export const type = '${name}'`,
    limits: 'export const limits = { maxItems: 3 }',
    normalize: `export function normalize(raw, ctx = 'ir') { return { id: raw.id, type: '${name}', title: raw.title, caption: raw.caption, items: raw.items ?? [] } }`,
    budgetWarnings: "export function budgetWarnings(ir) { return ir.items.length > limits.maxItems ? [{ key: 'budget:items', value: ir.items.length, limit: limits.maxItems, detail: 'too many', hint: 'split' }] : [] }",
    layout: 'export async function layout(ir) { return { width: 200, height: 100, geo: { boxes: ir.items.map((label, i) => ({ x: i * 40, y: 8, width: 32, height: 24, label })) } } }',
    draw: 'export function draw(geo, ir) { return geo.geo.boxes.map((b, i) => `<rect id="wu-d-${ir.id}-b${i}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="4" fill="none" stroke="currentColor" stroke-width="1"/>`).join(\'\') }',
    verify: "export function verify(geo, ir) { return [{ id: 1, name: 'has-items', severity: 'fail', ok: geo.geo.boxes.length > 0, detail: `${geo.geo.boxes.length} box(es)`, hint: 'add an item' }] }",
    doc: `export const doc = { purpose: 'stub ${name}', whenToUse: 'tests', irExample: 'id: x\\ntype: ${name}\\ntitle: t\\nitems: [a]\\n', rows: ['has-items'] }`,
  }
  if (omit) delete parts[omit]
  return Object.values(parts).join('\n') + '\n' + extra + '\n'
}

function scratchDir() {
  return mkdtempSync(join(tmpdir(), 'wu-figures-'))
}

describe('figures/index.mjs: discovery from the filesystem', () => {
  test('the real folder yields exactly the plugin files, skipping index.mjs, _-prefixed helpers and the .txt template', () => {
    const files = pluginFiles(FIGURES_DIR)
    const expected = readdirSync(FIGURES_DIR).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs' && !f.startsWith('_')).sort()
    assert.deepEqual(files, expected)
    assert.ok(files.includes('sequence.mjs'))
    const all = readdirSync(FIGURES_DIR)
    assert.ok(all.includes('index.mjs') && all.includes('_shared.mjs') && all.includes('_template.mjs.txt'))
  })

  test('listFigureTypes() lists the builtin diagram first, then every plugin alphabetically', () => {
    const plugins = pluginFiles(FIGURES_DIR).map((f) => f.replace(/\.mjs$/, '')).sort()
    assert.deepEqual(listFigureTypes(), ['diagram', ...plugins])
    assert.deepEqual(irTypes(), listFigureTypes())
  })

  test('getFigureType("sequence") is a frozen plugin with every contract export', () => {
    const p = getFigureType('sequence')
    assert.ok(Object.isFrozen(p))
    for (const name of PLUGIN_EXPORTS) assert.ok(name in p, `missing ${name}`)
    assert.equal(p.builtin, false)
    assert.equal(isPluginType('sequence'), true)
    assert.equal(hasFigureType('sequence'), true)
  })

  test('getFigureType("diagram") is the read-only builtin descriptor (limits + doc, no renderer)', () => {
    const d = getFigureType('diagram')
    assert.ok(d && d.builtin === true)
    assert.equal(d.limits, LIMITS)
    assert.equal(d.doc.rows, DIAGRAM_ROWS)
    assert.match(d.doc.irExample, /^id: request-path\n/)
    assert.equal(isPluginType('diagram'), false)
    assert.equal(hasFigureType('diagram'), true)
    assert.equal('layout' in d, false)
    assert.throws(() => { d.limits = {} }, /read only|Cannot assign/)
  })

  test('an unknown type is undefined, and validateIR() reports it as a schema error naming the known types', () => {
    assert.equal(getFigureType('nope'), undefined)
    assert.equal(hasFigureType('nope'), false)
    const r = validateIR({ id: 'x', type: 'nope', title: 't' })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'schema')
    assert.match(r.message, /ir\.type must be diagram\|[a-z|-]*sequence[a-z|-]* \(got: "nope"\)/)
  })

  test('loadFigureTypes(dir) discovers a stub plugin and keys it by its exported type', async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'boxes.mjs'), stubPlugin('boxes'))
    writeFileSync(join(dir, '_helper.mjs'), 'export const notAPlugin = true\n')
    writeFileSync(join(dir, 'index.mjs'), 'export const ignored = true\n')
    writeFileSync(join(dir, '_template.mjs.txt'), 'export const type = "broken"\n')
    const reg = await loadFigureTypes(dir)
    assert.deepEqual([...reg.keys()], ['boxes'])
    assert.equal(reg.get('boxes').__file, 'boxes.mjs')
  })

  test('the file name does not have to match the type — the exported `type` is the key', async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'anything.mjs'), stubPlugin('boxes'))
    const reg = await loadFigureTypes(dir)
    assert.deepEqual([...reg.keys()], ['boxes'])
  })

  test('two files exporting the same type is an error naming both files', async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'a.mjs'), stubPlugin('boxes'))
    writeFileSync(join(dir, 'b.mjs'), stubPlugin('boxes'))
    await assert.rejects(loadFigureTypes(dir), /duplicate figure type "boxes": a\.mjs and b\.mjs/)
  })

  test('a plugin missing a contract export fails to load with the file and export named', async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'boxes.mjs'), stubPlugin('boxes', { omit: 'verify' }))
    await assert.rejects(loadFigureTypes(dir), /figure plugin boxes\.mjs: missing export "verify"/)
  })

  test('a plugin with an extra export fails to load (the contract is exactly the 8 exports)', async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'boxes.mjs'), stubPlugin('boxes', { extra: 'export const helper = 1' }))
    await assert.rejects(loadFigureTypes(dir), /unexpected export\(s\) helper/)
  })

  test('a plugin claiming type "diagram" is rejected — the builtin owns it', () => {
    const mod = { type: 'diagram', limits: {}, normalize() {}, budgetWarnings() {}, layout() {}, draw() {}, verify() {}, doc: { purpose: '', whenToUse: '', irExample: '', rows: [] } }
    assert.throws(() => assertPluginContract(mod, 'x.mjs'), /"diagram" is the builtin/)
  })

  test('assertPluginContract checks export types and the doc fields', () => {
    const good = { type: 'boxes', limits: {}, normalize() {}, budgetWarnings() {}, layout() {}, draw() {}, verify() {}, doc: { purpose: '', whenToUse: '', irExample: '', rows: [] } }
    assert.doesNotThrow(() => assertPluginContract(good, 'boxes.mjs'))
    assert.throws(() => assertPluginContract({ ...good, limits: 'x' }, 'boxes.mjs'), /export "limits" must be a object/)
    assert.throws(() => assertPluginContract({ ...good, type: 'Bad Name' }, 'boxes.mjs'), /lowercase/)
    assert.throws(() => assertPluginContract({ ...good, doc: { purpose: '' } }, 'boxes.mjs'), /doc\.whenToUse is required/)
    assert.throws(() => assertPluginContract({ ...good, doc: { ...good.doc, irExample: {} } }, 'boxes.mjs'), /irExample must be a YAML string/)
  })
})

describe('figures/index.mjs: renderFigure + verifyFigure on a stub plugin', () => {
  const load = async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'boxes.mjs'), stubPlugin('boxes'))
    return (await loadFigureTypes(dir)).get('boxes')
  }

  test('renderFigure wraps draw() in the shared <svg role="img"> root with title/desc first and the plugin geometry attached', async () => {
    const plugin = await load()
    const ir = plugin.normalize({ id: 'bx', title: 'Boxes', caption: 'three boxes', items: ['a', 'b', 'c'] })
    const r = await renderFigure(plugin, ir)
    assert.match(r.svg, /^<svg role="img" aria-labelledby="wu-d-bx-title wu-d-bx-desc" width="200" height="100" viewBox="0 0 200 100" xmlns="http:\/\/www\.w3\.org\/2000\/svg"><title id="wu-d-bx-title">Boxes<\/title><desc id="wu-d-bx-desc">three boxes<\/desc><rect /)
    assert.equal(r.width, 200)
    assert.equal(r.scaled, false)
    assert.equal(r.scroll, false)
    assert.equal(r.layout.geo.boxes.length, 3)
  })

  test('verifyFigure appends the shared rows after the plugin rows, ids continuing', async () => {
    const plugin = await load()
    const ir = plugin.normalize({ id: 'bx', title: 'Boxes', items: ['a'] })
    const v = await verifyFigure(plugin, ir, await renderFigure(plugin, ir))
    assert.equal(v.ok, true, JSON.stringify(v.failures))
    assert.deepEqual(v.checks.map((c) => c.name), ['has-items', ...SHARED_ROW_NAMES])
    assert.deepEqual(v.checks.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8])
    assert.ok(v.checks.every((c) => c.severity === 'fail'))
  })

  test('a failing plugin row lands in failures; the shared a11y row catches an unprefixed id', async () => {
    const plugin = await load()
    const ir = plugin.normalize({ id: 'bx', title: 'Boxes', items: [] })
    const rendered = await renderFigure(plugin, ir)
    const v = await verifyFigure(plugin, ir, rendered)
    assert.deepEqual(v.failures.map((f) => f.name), ['has-items'])
    const bad = { ...rendered, svg: rendered.svg.replace('<desc', '<g id="rogue"/><desc') }
    const v2 = await verifyFigure(plugin, ir, bad)
    assert.ok(v2.failures.some((f) => f.name === 'a11y' && /rogue/.test(f.detail)))
  })

  test('the column fit is the shared one: a 900px layout scales to 720 (0.8 ≥ MIN_SCALE), an 1800px one scrolls', async () => {
    const dir = scratchDir()
    writeFileSync(join(dir, 'wide.mjs'), stubPlugin('wide').replace('width: 200', 'width: ir.items.length * 900'))
    const plugin = (await loadFigureTypes(dir)).get('wide')
    const one = await renderFigure(plugin, plugin.normalize({ id: 'w', title: 't', items: ['a'] }))
    assert.deepEqual([one.scaled, one.scroll], [true, false])
    assert.match(one.svg, /width="720" height="80" viewBox="0 0 900 100"/)
    const two = await renderFigure(plugin, plugin.normalize({ id: 'w', title: 't', items: ['a', 'b'] }))
    assert.deepEqual([two.scaled, two.scroll], [false, true])
  })
})

describe('ir.mjs: validateIR routes plugin types through the registry', () => {
  test('type omitted → diagram; type: diagram → diagram; type: sequence → the plugin\'s normalize()', () => {
    const d = validateIR({ id: 'd', title: 't', nodes: [{ id: 'a', label: 'A' }] })
    assert.equal(d.ok, true)
    assert.equal(d.ir.type, 'diagram')
    const d2 = validateIR({ id: 'd', type: 'diagram', title: 't', nodes: [{ id: 'a', label: 'A' }] })
    assert.equal(d2.ir.type, 'diagram')
    const s = validateIR(parseYaml(getFigureType('sequence').doc.irExample))
    assert.equal(s.ok, true, JSON.stringify(s))
    assert.equal(s.ir.type, 'sequence')
    assert.deepEqual(s.warnings, [])
  })

  test('a plugin schema error surfaces as { ok:false, reason:"schema" } with the plugin\'s ${ctx} path', () => {
    const r = validateIR({ id: 's', type: 'sequence', title: 't', participants: [{ id: 'a', label: 'A' }], messages: [{ from: 'a', to: 'zz', kind: 'sync' }] })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'schema')
    assert.match(r.message, /^messages\[0\]\.to references unknown participant "zz"$/)
  })

  test('every registered type\'s doc.irExample validates and, for plugins, carries type: <name>', () => {
    for (const name of listFigureTypes()) {
      const r = validateIR(parseYaml(getFigureType(name).doc.irExample))
      assert.equal(r.ok, true, `${name}: ${JSON.stringify(r)}`)
      assert.equal(r.ir.type, name)
    }
  })
})

describe('render-diagram.mjs: --list-types and --doc', () => {
  test('parseArgs accepts --list-types and --doc <type> without an input file', () => {
    assert.equal(parseArgs(['--list-types']).listTypes, true)
    assert.equal(parseArgs(['--doc', 'sequence']).doc, 'sequence')
    assert.throws(() => parseArgs(['--doc']), /--doc requires a figure type name/)
    assert.throws(() => parseArgs(['--doc', '--json']), /--doc requires a figure type name/)
    assert.throws(() => parseArgs([]), /missing input file/)
  })

  test('--list-types prints every type with purpose, budgets and rows', () => {
    const r = runCli(['--list-types'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stdout.trim(), formatTypeList())
    assert.match(r.stdout, /^diagram {2}\(builtin\)\n {2}purpose: /m)
    assert.match(r.stdout, /^sequence {2}\(plugin\)\n {2}purpose: /m)
    assert.match(r.stdout, /budgets: maxNodes=9 maxEdges=12 maxGroups=4 maxLabelLen=12 maxEmphasis=2/)
    assert.match(r.stdout, /budgets: maxParticipants=6 maxMessages=16 maxLabelLen=16/)
    assert.match(r.stdout, /rows: {4}participant-count, message-count/)
  })

  test('--doc <type> prints that type\'s irExample verbatim, and it renders as a passing figure', () => {
    for (const name of listFigureTypes()) {
      const r = runCli(['--doc', name])
      assert.equal(r.status, 0, r.stderr)
      assert.equal(r.stdout, getFigureType(name).doc.irExample)
      const dir = scratchDir()
      const file = join(dir, `${name}.yaml`)
      writeFileSync(file, r.stdout)
      const rendered = runCli([file, '--figure'])
      assert.equal(rendered.status, 0, `${name}: ${rendered.stderr}`)
      assert.match(rendered.stdout, /^<figure class="wu-figure" data-checks="pass"/)
      if (name !== 'diagram') assert.match(rendered.stdout, new RegExp(`data-type="${name}"`))
    }
  })

  test('--doc with an unknown type exits 2 and lists the known types', () => {
    const r = runCli(['--doc', 'nope'])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /unknown figure type "nope" — known: diagram, (?:[a-z-]+, )*sequence/)
  })

  test('--help mentions the two new flags', () => {
    const r = runCli(['--help'])
    assert.match(r.stdout, /--list-types \| --doc <type>/)
  })
})

describe('references/figure-types.md exists and names every registered type', () => {
  test('the reference documents the contract exports and lists diagram + sequence as implemented', () => {
    const path = join(ROOT, 'references', 'figure-types.md')
    assert.ok(existsSync(path))
    const text = readFileSync(path, 'utf8')
    for (const name of PLUGIN_EXPORTS) assert.ok(text.includes(`\`${name}\``), `figure-types.md does not mention export ${name}`)
    for (const name of SHARED_ROW_NAMES) assert.ok(text.includes(name), `figure-types.md does not mention shared row ${name}`)
    assert.match(text, /\| `sequence` \|[^\n]*implemented/)
    assert.match(text, /\| `diagram` \|[^\n]*builtin/)
  })
})
