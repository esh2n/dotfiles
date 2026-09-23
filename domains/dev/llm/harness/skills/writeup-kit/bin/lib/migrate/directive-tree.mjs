// directive-tree.mjs — split an explain-pages Markdown body into a flat
// sequence of {type:'md', text} and {type:'directive', ...} nodes, tracking
// remark-directive's nesting convention (docs/authoring.md "ネスト規則:
// コンテナの中にコンテナを入れる場合、外側のコロンを 1 つ増やす" —
// `::::compare` wraps `:::col`). A single colon-count stack is enough:
// nesting only ever happens for compare/col, and every other directive's
// body is DSL text or fenced (backtick) code that never collides with a
// colon-run.
//
// A directive node carries both:
//   - `body`  — the raw text with any nested directive replaced by nothing
//               useful for non-nesting directives (the common case)
//   - `children` — nested directive nodes in order (only compare/col uses
//               this; empty for everything else)

import { parseAttrString } from './attrs.mjs'

const OPEN_RE = /^(:{3,})([a-zA-Z][\w-]*)\s*(?:\{([^}]*)\})?\s*$/
const CLOSE_RE = /^(:{3,})\s*$/

function newFrame(colons, name, attrs) {
  return { colons, name, attrs, raw: [] } // raw: Array<string | DirectiveNode>
}

function finalizeFrame(frame) {
  const bodyLines = []
  const children = []
  for (const item of frame.raw) {
    if (typeof item === 'string') bodyLines.push(item)
    else children.push(item)
  }
  return { type: 'directive', name: frame.name, attrs: frame.attrs, colons: frame.colons, body: bodyLines.join('\n'), children }
}

/**
 * @param {string} text
 * @returns {Array<{type:'md',text:string}|{type:'directive',name:string,attrs:object,colons:number,body:string,children:object[]}>}
 */
export function parseDirectiveTree(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const nodes = []
  const stack = []
  let mdBuf = []

  const flushMd = () => {
    const joined = mdBuf.join('\n')
    if (joined.trim() !== '') nodes.push({ type: 'md', text: joined })
    mdBuf = []
  }

  for (const line of lines) {
    const open = OPEN_RE.exec(line)
    if (open) {
      if (!stack.length) flushMd()
      stack.push(newFrame(open[1].length, open[2], parseAttrString(open[3])))
      continue
    }
    const close = CLOSE_RE.exec(line)
    if (close && stack.length && stack[stack.length - 1].colons === close[1].length) {
      const finished = finalizeFrame(stack.pop())
      if (stack.length) stack[stack.length - 1].raw.push(finished)
      else nodes.push(finished)
      continue
    }
    if (stack.length) stack[stack.length - 1].raw.push(line)
    else mdBuf.push(line)
  }
  flushMd()

  // Anything left open at EOF (malformed/truncated input): close it where
  // it stands rather than silently dropping content.
  while (stack.length) {
    const finished = finalizeFrame(stack.pop())
    if (stack.length) stack[stack.length - 1].raw.push(finished)
    else nodes.push(finished)
  }

  return nodes
}
