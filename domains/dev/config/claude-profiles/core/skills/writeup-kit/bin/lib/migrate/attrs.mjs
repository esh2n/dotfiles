// attrs.mjs — parse explain-pages directive attribute lists (docs/
// authoring.md). Two distinct grammars appear in the corpus, so two
// separate splitters are exported:
//
//  - Container-level `{key=value key2="value 2"}` (a directive's opening
//    fence, e.g. `:::col{title="A" tone=bad}`, or an inline edge suffix
//    `{style=primary}`). The corpus is inconsistent about the separator
//    here — both a comma (`:::board{id=x, height=860}`) and bare
//    whitespace (`:::col{title="A" tone=bad}`) occur — so this splits on
//    a run of comma-and/or-whitespace.
//
//  - Bracket-level `[label: key=value, key=value]` (a node/zone's square
//    brackets). The formal grammar (authoring.md) fixes this to a strict
//    comma list, and unquoted values here routinely contain spaces
//    (`sub=一覧から開き、候補 API か SOC 検索で選んで保存`), so this must
//    split on commas only — treating whitespace as a separator would
//    truncate those values.

function unquote(v) {
  const t = v.trim()
  if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
    return t.slice(1, -1)
  }
  return t
}

function toAttrs(parts) {
  const attrs = {}
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    attrs[key] = unquote(part.slice(eq + 1))
  }
  return attrs
}

/** Split on a run of comma and/or whitespace, respecting quotes. */
function splitCommaOrSpace(text) {
  const parts = []
  let cur = ''
  let quote = null
  const flush = () => { if (cur !== '') { parts.push(cur); cur = '' } }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === ',' || /\s/.test(c)) { flush(); continue }
    cur += c
  }
  flush()
  return parts
}

/** Split on top-level commas only, respecting quotes. */
function splitCommaOnly(text) {
  const parts = []
  let cur = ''
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === ',') { parts.push(cur); cur = ''; continue }
    cur += c
  }
  if (cur.trim() !== '' || parts.length) parts.push(cur)
  return parts
}

/** Container-level `{...}` attrs (directive fences, `{style=...}` edge
 * suffixes). @param {string|undefined} raw @returns {Record<string,string>} */
export function parseAttrString(raw) {
  if (!raw) return {}
  return toAttrs(splitCommaOrSpace(raw))
}

/**
 * Split "label: key=value, key=value" into {label, attrs}, matching
 * parseDiagram.ts's splitLabelAndAttrs: only a ":" immediately followed by
 * "key=" is treated as the attrs separator, so a label containing its own
 * ":" (e.g. a node label with a colon) is preserved. The attrs half is a
 * strict comma list (bracket-level grammar), not comma-or-space.
 */
export function splitLabelAndAttrs(inner) {
  const parts = inner.split(/:\s*(?=[\w-]+=)/)
  const label = parts[0].trim()
  const attrs = parts.length > 1 ? toAttrs(splitCommaOnly(parts.slice(1).join(':'))) : {}
  return { label, attrs }
}
