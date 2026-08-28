#!/usr/bin/env node
// contrast.mjs — audit kit/writeup.css design tokens for WCAG contrast.
//
//   node bin/contrast.mjs [--css <path>] [--json] [--md]
//
// Prints one row per (theme, fg-token on bg-token) pair from
// bin/lib/contrast.mjs USAGE_PAIRS. Exits 1 when any `text` pair is below
// 4.5:1 in either theme. `ui` pairs (rules, borders, strokes, tone fills) are
// reported but only flagged below 3:1 and never fail the run.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  parseTokens, auditTokens, failures, formatTable, formatMarkdown, darkDrift,
} from './lib/contrast.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CSS = join(HERE, '..', 'kit', 'writeup.css')

function parseArgs(argv) {
  const opts = { css: DEFAULT_CSS, json: false, md: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--css') opts.css = resolve(argv[++i] ?? '')
    else if (a === '--json') opts.json = true
    else if (a === '--md') opts.md = true
    else if (a === '-h' || a === '--help') {
      console.log('usage: contrast.mjs [--css <path>] [--json] [--md]')
      process.exit(0)
    } else {
      console.error(`unknown argument: ${a}`)
      process.exit(2)
    }
  }
  return opts
}

const opts = parseArgs(process.argv.slice(2))
const css = readFileSync(opts.css, 'utf8')
const tokens = parseTokens(css)
const rows = auditTokens(tokens)
const bad = failures(rows)
const textBad = bad.filter((r) => r.kind === 'text')
const drift = darkDrift(tokens)

if (opts.json) {
  console.log(JSON.stringify({ css: opts.css, rows, failures: bad, darkDrift: drift }, null, 2))
} else if (opts.md) {
  console.log(formatMarkdown(rows))
} else {
  console.log(formatTable(rows))
  console.log('')
  console.log(`${rows.length} pairs; ${textBad.length} text pair(s) below 4.5:1; ${bad.length - textBad.length} ui pair(s) below 3:1`)
  if (drift.length) console.log(`dark blocks disagree on: ${drift.join(', ')}`)
}

process.exit(textBad.length ? 1 : 0)
