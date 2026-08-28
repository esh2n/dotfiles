import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseArgs, main } from '../bin/render-diagram.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const FIXTURES = join(HERE, 'fixtures')
const BIN = join(ROOT, 'bin', 'render-diagram.mjs')

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'wu-render-diagram-'))
  const file = join(dir, name)
  writeFileSync(file, content)
  return file
}

// A complete bipartite K3,3 graph: schema-valid and well within budget, but
// K3,3 has no planar embedding at all (a classic graph theory fact), so
// laying it out in two layers is guaranteed to leave at least one
// unrelated-edge crossing — a genuine contract §4-2 #3 failure through the
// real render+verify pipeline, not a hand-mutated adversarial renderResult.
const FAILING_IR = [
  'id: k33', 'title: t', 'nodes:',
  '- id: l0\n  label: L0', '- id: l1\n  label: L1', '- id: l2\n  label: L2',
  '- id: r0\n  label: R0', '- id: r1\n  label: R1', '- id: r2\n  label: R2',
  'edges:',
  ...['l0', 'l1', 'l2'].flatMap((l) => ['r0', 'r1', 'r2'].map((r) => `- from: ${l}\n  to: ${r}\n  kind: sync`)),
].join('\n') + '\n'

function runCli(args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('render-diagram: parseArgs', () => {
  test('--figure sets args.figure', () => {
    const args = parseArgs(['ir.yaml', '--figure'])
    assert.equal(args.figure, true)
  })

  test('--figure defaults to false', () => {
    const args = parseArgs(['ir.yaml'])
    assert.equal(args.figure, false)
  })

  test('--help still parses with --figure present', () => {
    const args = parseArgs(['--figure', '--help'])
    assert.equal(args.help, true)
  })
})

describe('render-diagram: --help', () => {
  test('usage text lists --figure', () => {
    const r = runCli(['--help'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /--figure/)
  })
})

describe('render-diagram: --figure output', () => {
  test('prints a verified <figure> block, not a bare <svg>, on success', () => {
    const r = runCli([join(FIXTURES, 'simple.yaml'), '--figure'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^<figure class="wu-figure" data-checks="pass">/)
    assert.match(r.stdout, /<svg /)
    assert.match(r.stdout, /<figcaption>/)
    assert.match(r.stdout, /<script type="text\/x-writeup-diagram">/)
  })

  test('without --figure the output is still the bare <svg> (unchanged behavior)', () => {
    const r = runCli([join(FIXTURES, 'simple.yaml')])
    assert.equal(r.status, 0)
    assert.match(r.stdout.trim(), /^<svg /)
    assert.ok(!r.stdout.includes('<figure'))
  })

  test('--figure writes the <figure> block to --out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wu-render-diagram-out-'))
    const out = join(dir, 'fig.html')
    const r = runCli([join(FIXTURES, 'simple.yaml'), '--figure', '--out', out])
    assert.equal(r.status, 0)
    const written = readFileSync(out, 'utf8')
    assert.match(written, /^<figure class="wu-figure" data-checks="pass">/)
  })

  test('--figure still exits 3 and prints nothing to stdout when verification fails', () => {
    const file = tmpFile('bad.yaml', FAILING_IR)
    const r = runCli([file, '--figure'])
    assert.equal(r.status, 3)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /diagram failed verification/)
  })

  test('--figure still exits 2 on a budget error, before any figure is built', () => {
    const r = runCli([join(FIXTURES, 'budget.yaml'), '--figure'])
    assert.equal(r.status, 2)
    assert.equal(r.stdout, '')
  })
})

describe('render-diagram: --json figureHtml', () => {
  test('figureHtml is the verified <figure> block when ok', () => {
    const r = runCli([join(FIXTURES, 'simple.yaml'), '--json'])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, true)
    assert.match(out.figureHtml, /^<figure class="wu-figure" data-checks="pass">/)
    assert.match(out.svg, /^<svg /)
  })

  test('figureHtml is null when verification fails', () => {
    const file = tmpFile('bad2.yaml', FAILING_IR)
    const r = runCli([file, '--json'])
    assert.equal(r.status, 3)
    const out = JSON.parse(r.stdout)
    assert.equal(out.ok, false)
    assert.equal(out.figureHtml, null)
  })

  test('--json and --figure together: figureHtml is present, exit code unaffected', () => {
    const r = runCli([join(FIXTURES, 'simple.yaml'), '--json', '--figure'])
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.ok(out.figureHtml)
  })
})

describe('render-diagram: main() in-process (exit codes unchanged)', () => {
  test('exit 0 on a clean render without --figure/--json', async () => {
    const logs = []
    const orig = console.log
    console.log = (s) => logs.push(s)
    try {
      const code = await main([join(FIXTURES, 'simple.yaml')])
      assert.equal(code, 0)
      assert.match(logs.join('\n'), /^<svg /)
    } finally {
      console.log = orig
    }
  })

  test('exit 2 on a budget error', async () => {
    const code = await main([join(FIXTURES, 'budget.yaml')])
    assert.equal(code, 2)
  })

  test('exit 3 on a verification failure', async () => {
    const file = tmpFile('bad3.yaml', FAILING_IR)
    const code = await main([file])
    assert.equal(code, 3)
  })
})
