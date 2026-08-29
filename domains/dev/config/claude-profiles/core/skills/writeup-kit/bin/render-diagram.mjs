#!/usr/bin/env node
// CLI for the zero-dependency diagram renderer.
//
//   node bin/render-diagram.mjs <ir.yaml|ir.json> [--column 720] [--out out.svg] [--json] [--figure]
//   node bin/render-diagram.mjs --list-types
//   node bin/render-diagram.mjs --doc <type>
//
// --list-types prints every figure type the registry knows (the builtin
// diagram plus each bin/lib/figures/<type>.mjs plugin) with its purpose and
// budgets; --doc <type> prints that type's example IR (YAML) — ready to
// copy into a page. Neither takes an input file.
//
// Exit codes: 0 ok, 1 cannot read the input file, 2 the IR failed to parse
// or validate (a one-line reason + suggestion is printed to stderr), 3 the
// diagram rendered but failed contract §4-2 verification (the failing rows
// and their hints are printed to stderr).
//
// --figure prints the verified <figure class="wu-figure" data-checks="pass">
// block (svg + figcaption + the original IR script), ready to paste as-is,
// instead of the bare <svg>. A figure that is over budget (nodes/edges/
// groups/edge-label length — guidance, not a gate) still renders and exits
// 0; its opening tag also carries `data-warn="budget:nodes=11;…"` and the
// warnings are echoed on stderr. --json always includes a `figureHtml`
// field (the same block, or null when verification did not pass) plus
// `warnings` (the budget warn rows) and `warn` (the data-warn string or
// null), regardless of whether --figure was also given.
import { readFileSync, writeFileSync } from 'node:fs'
import { parse as parseYamlLite, YamlError } from './lib/yaml-lite.mjs'
import { validateIR } from './lib/ir.mjs'
import { COLUMN } from './lib/diagram.mjs'
import { renderFigureHtmlChecked } from './lib/verify-diagram.mjs'
import { getFigureType, listFigureTypes } from './lib/figures/index.mjs'

export function parseArgs(argv) {
  const args = { input: null, column: COLUMN, out: null, json: false, figure: false, help: false, listTypes: false, doc: null }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list-types') {
      args.listTypes = true
    } else if (a === '--doc') {
      args.doc = argv[++i]
      if (args.doc === undefined || args.doc.startsWith('--')) throw new Error('--doc requires a figure type name')
    } else if (a === '--column') {
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
  if (!args.help && !args.listTypes && args.doc === null) {
    if (rest.length === 0) throw new Error('missing input file')
    if (rest.length > 1) throw new Error('only one input file is allowed')
    args.input = rest[0]
  }
  return args
}

const USAGE = 'usage: render-diagram.mjs <ir.yaml|ir.json> [--column 720] [--out out.svg] [--json] [--figure]\n       render-diagram.mjs --list-types | --doc <type>'

/** `budgets: maxNodes=9 maxEdges=12 …` — the advisory limits a type warns on. */
function formatLimits(limits) {
  const entries = Object.entries(limits ?? {})
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(' ') : '(none)'
}

/** One block per registered type: name, purpose, when to use, budgets,
 * and the verify rows it owns — what `--list-types` prints. */
export function formatTypeList() {
  return listFigureTypes().map((name) => {
    const t = getFigureType(name)
    const kind = t.builtin ? 'builtin' : 'plugin'
    return [
      `${name}  (${kind})`,
      `  purpose: ${t.doc.purpose}`,
      `  when:    ${t.doc.whenToUse}`,
      `  budgets: ${formatLimits(t.limits)}`,
      `  rows:    ${t.doc.rows.join(', ')}`,
    ].join('\n')
  }).join('\n\n')
}

/** Budget warnings (verify-diagram.mjs `warn` rows) go to stderr: the
 * figure still renders and exits 0, but the author should consider
 * splitting it. */
function printWarnings(warnings) {
  for (const w of warnings) {
    console.error(`warning: ${w.key}=${w.value} (#${w.id} ${w.name}): ${w.detail}${w.hint ? ` — ${w.hint}` : ''}`)
  }
}

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
  if (args.listTypes) {
    console.log(formatTypeList())
    return 0
  }
  if (args.doc !== null) {
    const plugin = getFigureType(args.doc)
    if (!plugin) {
      console.error(`unknown figure type "${args.doc}" — known: ${listFigureTypes().join(', ')}`)
      return 2
    }
    process.stdout.write(plugin.doc.irExample.endsWith('\n') ? plugin.doc.irExample : `${plugin.doc.irExample}\n`)
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
  const warnings = rendered.warnings ?? []

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
      warnings,
      warn: rendered.warn || null,
    }))
    return rendered.checksOk ? 0 : 3
  }

  if (!rendered.checksOk) {
    // validateIR() always stamps a type (see ir.mjs) and
    // renderFigureHtmlChecked() already dispatched the render+verify work
    // to the right plugin (verify-diagram.mjs), so the only type-specific
    // thing left here is naming the kind in the error banner.
    console.error(`${validated.ir.type} failed verification (contract §4-2):`)
    for (const c of rendered.checks) {
      if (c.ok || c.severity === 'warn') continue
      console.error(`  #${c.id} ${c.name}: ${c.detail}${c.hint ? ` — hint: ${c.hint}` : ''}`)
    }
    printWarnings(warnings)
    return 3
  }

  // Budget overruns are advisory: the figure is drawn and passes, the
  // author is told (on stderr, so stdout stays paste-ready) to consider
  // splitting it.
  printWarnings(warnings)

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
