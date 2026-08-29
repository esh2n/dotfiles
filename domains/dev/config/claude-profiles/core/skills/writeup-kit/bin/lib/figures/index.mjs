// Figure-type registry: every `<type>.mjs` in this folder is a plugin that
// owns one IR `type:` value end to end (schema → budgets → layout → draw →
// type-specific verify rows → doc). The registry is discovered from the
// filesystem at import time, so adding a figure type is adding one file —
// no shared file needs an edit, which is what lets many types be written
// in parallel without merge conflicts (references/figure-types.md).
//
// Not plugins: `index.mjs` (this file) and anything prefixed `_`
// (`_shared.mjs`, the kernel; `_template.mjs.txt`, the annotated contract).
// The node/edge diagram (ir.mjs + diagram.mjs + verify-diagram.mjs) is not
// a plugin either — it is the default when `type:` is absent — but ir.mjs
// registers a read-only descriptor for it (registerBuiltin) so
// `getFigureType('diagram')` / listFigureTypes() can list and document it
// next to the plugins.
//
// Import-graph rule (see _shared.mjs's header): this module loads plugins
// with a top-level `await import()`, and ir.mjs imports this module, so a
// plugin must never import ir.mjs, verify-diagram.mjs, or this file —
// _shared.mjs and the renderer modules (diagram.mjs, sequence.mjs, …) only.
import { readdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { COLUMN } from '../diagram.mjs'
import { fitToColumn, wrapFigureSvg, SHARED_CHECK_DEFS, runCheck, summarizeChecks } from './_shared.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** name → expected typeof; `doc` is checked field by field below. */
const CONTRACT = {
  type: 'string',
  limits: 'object',
  normalize: 'function',
  budgetWarnings: 'function',
  layout: 'function',
  draw: 'function',
  verify: 'function',
  doc: 'object',
}
const DOC_FIELDS = ['purpose', 'whenToUse', 'irExample', 'rows']

export const PLUGIN_EXPORTS = Object.keys(CONTRACT)

/** Throws a descriptive error when `mod` (loaded from `file`) does not
 * export exactly the figure-type contract. */
export function assertPluginContract(mod, file) {
  const where = `figure plugin ${file}`
  for (const [name, expected] of Object.entries(CONTRACT)) {
    if (!(name in mod)) throw new Error(`${where}: missing export "${name}"`)
    const actual = mod[name] === null ? 'null' : typeof mod[name]
    if (actual !== expected) throw new Error(`${where}: export "${name}" must be a ${expected} (got ${actual})`)
  }
  const extra = Object.keys(mod).filter((k) => !(k in CONTRACT))
  if (extra.length) throw new Error(`${where}: unexpected export(s) ${extra.join(', ')} — the contract is exactly ${PLUGIN_EXPORTS.join(', ')}`)
  if (!/^[a-z][a-z0-9-]*$/.test(mod.type)) throw new Error(`${where}: type "${mod.type}" must be lowercase [a-z0-9-]`)
  if (mod.type === 'diagram') throw new Error(`${where}: type "diagram" is the builtin node/edge diagram and cannot be a plugin`)
  for (const f of DOC_FIELDS) {
    if (!(f in mod.doc)) throw new Error(`${where}: doc.${f} is required`)
  }
  if (typeof mod.doc.irExample !== 'string') throw new Error(`${where}: doc.irExample must be a YAML string`)
  if (!Array.isArray(mod.doc.rows)) throw new Error(`${where}: doc.rows must be a list of verify row names`)
}

/** Plugin file names in a folder: every `*.mjs` except index.mjs and
 * `_`-prefixed helpers, sorted so discovery order is stable. */
export function pluginFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mjs') && f !== 'index.mjs' && !f.startsWith('_'))
    .sort()
}

/**
 * Load every plugin in `dir` into a Map keyed by `type`. Exported (and
 * parameterized) so tests can point it at a scratch folder; the module's
 * own registry below is `loadFigureTypes(HERE)`.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadFigureTypes(dir) {
  const registry = new Map()
  for (const file of pluginFiles(dir)) {
    const mod = await import(pathToFileURL(join(dir, file)).href)
    assertPluginContract(mod, file)
    if (registry.has(mod.type)) {
      throw new Error(`duplicate figure type "${mod.type}": ${registry.get(mod.type).__file} and ${file} both export it`)
    }
    // A frozen view: plugins are read-only once registered. `__file` is
    // kept for error messages only.
    registry.set(mod.type, Object.freeze({ ...mod, __file: file, builtin: false }))
  }
  return registry
}

const registry = await loadFigureTypes(HERE)
const builtins = new Map()

/**
 * Register a read-only descriptor for a figure type that is implemented
 * outside the plugin folder (today: the node/edge `diagram`, registered by
 * ir.mjs). Only `type`, `limits` and `doc` are meaningful — the renderer
 * and verifier are dispatched by verify-diagram.mjs, not through here.
 */
export function registerBuiltin({ type, limits, doc }) {
  if (registry.has(type)) throw new Error(`figure type "${type}" is already a plugin`)
  builtins.set(type, Object.freeze({ type, limits, doc, builtin: true }))
}

/** The plugin (or builtin descriptor) for `name`, or undefined. */
export function getFigureType(name) {
  return registry.get(name) ?? builtins.get(name)
}

export const hasFigureType = (name) => registry.has(name) || builtins.has(name)

/** Whether `name` is a plugin (renderable through renderFigure()) rather
 * than the builtin diagram. */
export const isPluginType = (name) => registry.has(name)

/** Every registered type name, builtins first, then plugins alphabetically. */
export function listFigureTypes() {
  return [...builtins.keys(), ...[...registry.keys()].sort()]
}

// --- dispatch: render + verify one plugin figure ---------------------------

/**
 * layout → fit → draw → wrap for one plugin. Returns the same shape
 * diagram.mjs's renderDiagram() does (`svg`/`width`/`height`/`scaled`/
 * `scroll`/`layout.geo`) so wrapFigureHtml() and the verifiers treat any
 * figure kind as a drop-in.
 */
export async function renderFigure(plugin, ir, { column = COLUMN } = {}) {
  const layout = await plugin.layout(ir, { column })
  if (!layout || !Number.isFinite(layout.width) || !Number.isFinite(layout.height) || !layout.geo) {
    throw new Error(`figure type "${plugin.type}": layout() must return { width, height, geo }`)
  }
  const fit = fitToColumn(layout.width, layout.height, column)
  const inner = plugin.draw(layout, ir, { column, ...fit })
  const svg = wrapFigureSvg(ir, layout, inner, fit)
  return { svg, width: layout.width, height: layout.height, scaled: fit.scaled, scroll: fit.scroll, layout }
}

/**
 * The plugin's own verify() rows (ids as the plugin numbered them) followed
 * by the shared rows from _shared.mjs (ids continuing after the plugin's
 * highest), summarized the same way verifyDiagram()/verifySequence() are.
 */
export async function verifyFigure(plugin, ir, rendered, { column = COLUMN } = {}) {
  if (!rendered || !rendered.layout || !rendered.layout.geo) {
    throw new Error('verifyFigure requires rendered.layout.geo (render with renderFigure())')
  }
  const own = (await plugin.verify(rendered.layout, ir, { column, svg: rendered.svg, rendered })) ?? []
  const checks = own.map((row, i) => ({
    id: row.id ?? i + 1,
    name: row.name,
    severity: row.severity ?? 'fail',
    ok: Boolean(row.ok),
    detail: row.detail,
    hint: row.hint,
    ...(row.severity === 'warn' && !row.ok ? { key: row.key, value: row.value } : {}),
  }))
  let nextId = checks.reduce((m, c) => Math.max(m, c.id), 0) + 1
  const ctx = { ir, svg: rendered.svg, renderResult: rendered, geo: rendered.layout.geo, column }
  for (const [name, fn, severity] of SHARED_CHECK_DEFS) {
    const r = runCheck(fn, ctx)
    checks.push({ id: nextId++, name, severity, ok: r.ok, detail: r.detail, hint: r.hint })
  }
  return summarizeChecks(checks)
}
