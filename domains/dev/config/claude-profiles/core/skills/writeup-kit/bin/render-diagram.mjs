#!/usr/bin/env node
// CLI for the zero-dependency diagram renderer.
//
//   node bin/render-diagram.mjs <ir.yaml|ir.json> [--column 720] [--out out.svg] [--json] [--figure]
//
// Exit codes: 0 ok, 1 cannot read the input file, 2 the IR failed to parse
// or validate (a one-line reason + suggestion is printed to stderr), 3 the
// diagram rendered but failed contract §4-2 verification (the failing rows
// and their hints are printed to stderr).
//
// --figure prints the verified <figure class="wu-figure" data-checks="pass">
// block (svg + figcaption + the original IR script), ready to paste as-is,
// instead of the bare <svg>. --json always includes a `figureHtml` field
// (the same block, or null when verification did not pass) regardless of
// whether --figure was also given.
import { readFileSync, writeFileSync } from 'node:fs'
import { parse as parseYamlLite, YamlError } from './lib/yaml-lite.mjs'
import { validateIR } from './lib/ir.mjs'
import { COLUMN } from './lib/diagram.mjs'
import { renderFigureHtmlChecked } from './lib/verify-diagram.mjs'

export function parseArgs(argv) {
  const args = { input: null, column: COLUMN, out: null, json: false, figure: false, help: false }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--column') {
      const v = Number(argv[++i])
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--column must be a positive number (got: ${argv[i]})`)
      args.column = v
    } else if (a === '--out') {
      args.out = argv[++i]
      if (args.out === undefined) throw new Error('--out requires a path')
    } else if (a === '--json') {
      args.json = true
    } else if (a === '--figure') {
      args.figure = true
    } else if (a === '-h' || a === '--help') {
      args.help = true
    } else if (a.startsWith('--')) {
      throw new Error(`unknown option: ${a}`)
    } else {
      rest.push(a)
    }
  }
  if (!args.help) {
    if (rest.length === 0) throw new Error('missing input file')
    if (rest.length > 1) throw new Error('only one input file is allowed')
    args.input = rest[0]
  }
  return args
}

const USAGE = 'usage: render-diagram.mjs <ir.yaml|ir.json> [--column 720] [--out out.svg] [--json] [--figure]'

export async function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(e.message)
    console.error(USAGE)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }

  let text
  try {
    text = readFileSync(args.input, 'utf8')
  } catch (e) {
    console.error(`cannot read ${args.input}: ${e.message}`)
    return 1
  }

  let raw
  try {
    raw = parseYamlLite(text)
  } catch (e) {
    if (e instanceof YamlError) {
      console.error(`yaml error: ${e.message}`)
      return 2
    }
    throw e
  }

  const validated = validateIR(raw)
  if (!validated.ok) {
    const suffix = validated.suggestion ? ` — ${validated.suggestion}` : ''
    console.error(`${validated.reason} error: ${validated.message}${suffix}`)
    return 2
  }

  let rendered
  try {
    rendered = await renderFigureHtmlChecked(validated.ir, { column: args.column, rawYaml: text })
  } catch (e) {
    console.error(`render error: ${e.message}`)
    return 2
  }

  if (args.json) {
    console.log(JSON.stringify({
      ok: rendered.checksOk,
      svg: rendered.svg,
      figureHtml: rendered.checksOk ? rendered.html : null,
      width: rendered.width,
      height: rendered.height,
      scaled: rendered.scaled,
      scroll: rendered.scroll,
      checks: rendered.checks,
      warnings: [],
    }))
    return rendered.checksOk ? 0 : 3
  }

  if (!rendered.checksOk) {
    console.error('diagram failed verification (contract §4-2):')
    for (const c of rendered.checks) {
      if (c.ok) continue
      console.error(`  #${c.id} ${c.name}: ${c.detail}${c.hint ? ` — hint: ${c.hint}` : ''}`)
    }
    return 3
  }

  const output = args.figure ? rendered.html : rendered.svg
  if (args.out) {
    writeFileSync(args.out, output, 'utf8')
  } else {
    console.log(output)
  }
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
