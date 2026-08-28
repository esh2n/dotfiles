// 構造化されたラウンドを 1 ページの HTML にする。
// writeup-kit がサイド (../../writeup-kit または ~/.claude/skills/writeup-kit)
// にあればページ意匠・図の検証を kit に委譲し、無ければ grilling 自前の
// template/style.css・lib/diagram.mjs にフォールバックする（lib/kit.mjs）。
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderDiagram } from './diagram.mjs'
import { treeProgress } from './parse.mjs'
import { kitDir, kitCss, loadKitRenderFigureHtmlChecked, loadKitYamlParse } from './kit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(HERE, '..', 'template')

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&amp;family=Noto+Sans+JP:wght@400;500;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">'

// kit/template.html の <link> と同じフォント指定（kit 側の CSS 変数
// --wu-font-body / --wu-font-heading / --wu-font-mono が前提にしているもの）。
const KIT_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&amp;family=BIZ+UDPGothic:wght@400;700&amp;family=IBM+Plex+Mono:wght@400;500&amp;display=swap">'

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i

/** 行内マークダウンの最小サブセット: `code` / **bold** / [text](url)。 */
export function mdInline(src) {
  const escaped = escapeHtml(src)
  return escaped.split(/`([^`]+)`/g)
    .map((part, i) => (i % 2 === 1 ? `<code>${part}</code>` : inlineRest(part)))
    .join('')
}

function inlineRest(s) {
  return s
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) => (
      SAFE_URL.test(url.replace(/&amp;/g, '&')) ? `<a href="${url}" rel="noopener noreferrer">${text}</a>` : m
    ))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/**
 * ブロックマークダウンの最小サブセット: 段落 / `- ` リスト / `####` 小見出し / GFM 表。
 * 生の HTML は一切通さない。解説を「読み物」でなく構造化した「説明」にするための語彙。
 *
 * @param {string[]} lines
 * @param {{kit?: boolean}} [opts] kit: true なら表とコードブロックを
 *   writeup-kit の語彙（`.wu-table` / `.wu-code`）で出す。既定 false は
 *   これまでどおりの grilling 自前のクラスで出す（フォールバック用）。
 */
export function mdBlocks(lines, opts = {}) {
  const kit = Boolean(opts.kit)
  const out = []
  let para = []
  let list = []
  let table = []
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => {
    if (list.length) { out.push(`<ul>${list.map((li) => `<li>${mdInline(li)}</li>`).join('')}</ul>`); list = [] }
  }
  const flushTable = () => { if (table.length) { out.push(renderTable(table, kit)); table = [] } }
  let code = null // コードブロックの中は行をそのまま集める
  for (const raw of lines) {
    if (code) {
      if (/^```\s*$/.test(raw.trim())) {
        out.push(kit
          ? `<pre class="wu-code"${code.lang ? ` data-lang="${escapeHtml(code.lang)}"` : ''}><code>${escapeHtml(code.body.join('\n'))}</code></pre>`
          : `<pre class="code"><code>${escapeHtml(code.body.join('\n'))}</code></pre>`)
        code = null
      } else code.body.push(raw)
      continue
    }
    const line = raw.trim()
    const fence = /^```(\S*)\s*$/.exec(line)
    if (fence) { flushPara(); flushList(); flushTable(); code = { lang: fence[1], body: [] }; continue }
    if (line === '') { flushPara(); flushList(); flushTable(); continue }
    // 表: `| a | b |` の行が続く。区切り行 (`|---|---|`) は読み飛ばす
    if (/^\|.*\|$/.test(line)) {
      flushPara(); flushList()
      if (!/^\|[\s:|-]+\|$/.test(line)) table.push(line)
      continue
    }
    flushTable()
    // 小見出し: 深さは問わず h4 に揃える（問いの h2 / 選択肢の h3 より下）
    const h = /^#{3,6}\s+(.*)$/.exec(line)
    if (h) { flushPara(); flushList(); out.push(`<h4>${mdInline(h[1])}</h4>`); continue }
    const li = /^[-*]\s+(.*)$/.exec(line)
    if (li) { flushPara(); list.push(li[1]); continue }
    flushList()
    para.push(line)
  }
  flushPara(); flushList(); flushTable()
  return out.join('\n')
}

/** GFM 表の行（先頭行が見出し行）を <table> にする。セルは mdInline を通す。 */
function renderTable(rows, kit) {
  const cells = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const [head, ...body] = rows.map(cells)
  const th = head.map((c) => `<th>${mdInline(c)}</th>`).join('')
  const trs = body.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')
  if (kit) return `<table class="wu-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
  return `<div class="scroll"><table class="md"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`
}

const TREE_STATE_LABEL = { decided: '決定済み', asked: '回答待ち', open: '未着手' }

/** 設計ツリーを入れ子リストにする。深さはインデントで表す。tag は 'ul' | 'ol'。 */
function treeList(nodes, depth, tag) {
  const pad = '  '.repeat(depth)
  const items = nodes.map((n) => {
    const chip = `<span class="chip" data-state="${n.state}">${TREE_STATE_LABEL[n.state]}</span>`
    const label = n.asks
      ? `<a class="tlabel" href="#${escapeHtml(n.asks)}">${escapeHtml(n.label)}</a>`
      : `<span class="tlabel">${escapeHtml(n.label)}</span>`
    const decision = n.state === 'decided' && n.decision
      ? `<span class="tdec">— ${mdInline(n.decision)}</span>`
      : ''
    const kids = n.children.length ? `\n${treeList(n.children, depth + 2, tag)}\n${pad}  ` : ''
    return `${pad}  <li data-state="${n.state}"><span class="tnode">${chip}${label}${decision}</span>${kids}</li>`
  })
  return `${pad}<${tag} class="tree">\n${items.join('\n')}\n${pad}</${tag}>`
}

const PREMISE_LABEL = {
  task: 'この作業',
  decided: '決まっていること',
  why_now: 'なぜ今これか',
  unblocks: '決めると始まること',
}

/**
 * ラウンド 1 つ分のページを組み立てる。
 * @param {object} round parse.mjs の parseRound の戻り値
 * @param {{title?: string, fragment?: boolean, serve?: boolean, kitDir?: string|null}} opts
 *   kitDir を省略すると writeup-kit を自動判定する。null を渡すと
 *   「kit 無し」を強制する（フォールバック経路のテスト用）。
 */
export async function renderPage(round, opts = {}) {
  const { frontmatter, premise, tree, questions } = round
  const title = opts.title || frontmatter.target
  const progress = treeProgress(tree)
  const kd = kitDir(opts.kitDir)

  const body = kd
    ? await renderKitBody({ frontmatter, premise, tree, questions, title, progress, opts, kd })
    : await renderFallbackBody({ frontmatter, premise, tree, questions, title, progress, opts })

  const fullBody = opts.serve ? `${body}\n${serveBlock(frontmatter, questions, Boolean(kd))}` : body
  const styleTags = await buildStyleTags(kd)
  const fonts = kd ? KIT_FONTS : FONTS

  if (opts.fragment) {
    return `<title>${escapeHtml(title)}</title>\n${fonts}\n${styleTags}\n\n${fullBody}\n`
  }
  const shell = await readFile(join(TEMPLATE_DIR, 'page.html'), 'utf8')
  // $& などの置換パターンを含む見出しでも壊れないよう、すべて関数で差し込む
  return shell
    .replace('{{TITLE}}', () => escapeHtml(title))
    .replace('{{FONTS}}', () => fonts)
    .replace('{{STYLE}}', () => styleTags)
    .replace('{{BODY}}', () => fullBody)
}

/** `<style>` タグそのものを組み立てる。kit があれば kit の CSS + grilling 独自の小さな追加分の 2 枚。 */
async function buildStyleTags(kd) {
  if (!kd) {
    const css = await readFile(join(TEMPLATE_DIR, 'style.css'), 'utf8')
    return `<style>\n${css}</style>`
  }
  const css = await kitCss(kd)
  return `<style>\n${css}</style>\n<style data-grilling>\n${grillingKitStyle()}</style>`
}

/**
 * kit に無いラウンド固有の制御だけを足す最小 CSS。
 * 対象は: 設問の回答フォーム（fieldset/radio/textarea/button/status）、
 * 設計ツリーの入れ子（chip/tnode/tdec）、進捗の note 行、
 * 図がフォールバックしたときの `.scroll` 図。すべて kit の CSS 変数
 * （--wu-*）を経由するので、kit のライト/ダーク 3 状態にそのまま追従する。
 */
function grillingKitStyle() {
  return `
ol.tree,ol.tree ol{list-style:none;margin:0;padding:0;display:grid;gap:var(--wu-sp-2)}
ol.tree ol{margin:var(--wu-sp-2) 0 0;padding:0 0 0 var(--wu-sp-4);border-left:var(--wu-bw-1) solid var(--wu-rule)}
.tnode{display:flex;gap:var(--wu-sp-2);align-items:baseline;flex-wrap:wrap;line-height:1.6}
.chip{font-size:var(--wu-fs-1);letter-spacing:.06em;padding:1px 9px;border-radius:999px;white-space:nowrap}
.chip[data-state="decided"]{background:var(--wu-rule-soft);border:var(--wu-bw-1) solid var(--wu-ink-2);color:var(--wu-ink)}
.chip[data-state="asked"]{background:var(--wu-surface);border:var(--wu-bw-1) solid var(--wu-link);color:var(--wu-link);font-weight:700}
.chip[data-state="open"]{background:none;border:var(--wu-bw-1) dashed var(--wu-ink-3);color:var(--wu-ink-3)}
a.tlabel{color:var(--wu-link);text-decoration:none;border-bottom:var(--wu-bw-1) solid currentColor}
li[data-state="open"] .tlabel{color:var(--wu-ink-3)}
.tdec{color:var(--wu-ink-3);font-size:var(--wu-fs-2)}
p.note{font-size:var(--wu-fs-1);color:var(--wu-ink-3)}
.wu-toc [data-done="true"]{color:var(--wu-ink-2)}
.wu-toc [data-done="false"]{color:var(--wu-ink-3)}
figure.scroll{margin:var(--wu-sp-4) 0;display:grid;gap:var(--wu-sp-2)}
figure.scroll svg{color:var(--wu-ink)}
figure.scroll figcaption{font-size:var(--wu-fs-2);color:var(--wu-ink-2)}
.scroll{overflow-x:auto;max-width:100%}
.scroll>svg{width:var(--fig-w,100%);max-width:none}
.answer{margin:var(--wu-sp-4) 0;padding:var(--wu-sp-4);border:var(--wu-bw-1) solid var(--wu-rule);border-radius:var(--wu-radius-2);background:var(--wu-surface);display:grid;gap:var(--wu-sp-3)}
.answer[data-submitted="true"]{border-color:var(--wu-ink)}
.answer fieldset{border:0;padding:0;margin:0;display:grid;gap:var(--wu-sp-2)}
.answer legend{font-weight:700;font-family:var(--wu-font-heading);padding:0;margin-bottom:var(--wu-sp-1)}
.radio{display:flex;gap:var(--wu-sp-3);align-items:flex-start;padding:var(--wu-sp-2) var(--wu-sp-3);border:var(--wu-bw-1) solid var(--wu-rule);border-radius:var(--wu-radius-1);cursor:pointer}
.radio:has(input:checked){border-color:var(--wu-link);background:var(--wu-rule-soft)}
.radio input{margin-top:.45em;accent-color:var(--wu-link)}
.radio small{display:block;color:var(--wu-ink-3);font-size:var(--wu-fs-1)}
textarea{width:100%;min-height:96px;border:var(--wu-bw-1) solid var(--wu-rule);border-radius:var(--wu-radius-1);padding:var(--wu-sp-2) var(--wu-sp-3);font:inherit;font-size:var(--wu-fs-2);background:var(--wu-ground);color:var(--wu-ink);resize:vertical}
.row{display:flex;gap:var(--wu-sp-3);align-items:center;flex-wrap:wrap}
.answer button{font:inherit;font-weight:700;font-family:var(--wu-font-heading);background:var(--wu-ink);color:var(--wu-ground);border:0;border-radius:var(--wu-radius-1);padding:var(--wu-sp-2) var(--wu-sp-4);cursor:pointer}
.answer[data-submitted="true"] button{opacity:.5}
.status{font-size:var(--wu-fs-2);color:var(--wu-ink-2)}
.answer[data-submitted="true"] .status{text-decoration:underline}
`
}

// ---------------------------------------------------------------------------
// フォールバック（kit 無し）— これまでどおりの grilling 自前の意匠。
// ---------------------------------------------------------------------------

async function renderFallbackBody({ frontmatter, premise, tree, questions, title, progress, opts }) {
  const blocks = []

  const nums = questions.map((q) => q.num)
  const range = nums.length === 1 ? `Q${nums[0]}` : `Q${Math.min(...nums)}–Q${Math.max(...nums)}`
  const lead = premise && premise.prose.length ? firstParagraph(premise.prose) : null
  blocks.push([
    '<header>',
    `  <div class="progress"><b>ラウンド ${frontmatter.round}</b> · ${escapeHtml(range)} · 決定済み ${progress.decided} / 回答待ち ${progress.asked} / 未着手 ${progress.open}</div>`,
    `  <h1>${escapeHtml(title)}</h1>`,
    lead ? `  <p>${mdInline(lead)}</p>` : '',
    '</header>',
  ].filter(Boolean).join('\n'))

  if (premise) {
    const body = []
    const rest = premise.prose.length ? dropFirstParagraph(premise.prose) : []
    if (rest.length) body.push(`    <div class="prose">${mdBlocks(rest)}</div>`)
    if (premise.rows.length) {
      const dl = premise.rows
        .map((r) => `      <dt>${escapeHtml(PREMISE_LABEL[r.key] || r.key)}</dt><dd>${mdInline(r.value)}</dd>`)
        .join('\n')
      body.push(`    <dl>\n${dl}\n    </dl>`)
    }
    if (body.length) {
      blocks.push([
        '<section>',
        '  <div class="eyebrow">前提</div>',
        '  <div class="panel">',
        body.join('\n'),
        '  </div>',
        '</section>',
      ].join('\n'))
    }
  }

  blocks.push([
    '<section>',
    '  <div class="eyebrow">設計ツリー</div>',
    treeList(tree, 1, 'ul'),
    `  <p class="note">決定済み ${progress.decided} / 回答待ち ${progress.asked} / 未着手 ${progress.open}。このラウンドで聞いているのは「回答待ち」のノード。</p>`,
    '</section>',
  ].join('\n'))

  if (questions.length > 1) {
    const items = questions.map((q) => {
      const done = Boolean(q.answer)
      return `  <a href="#${escapeHtml(q.id)}"><span class="n">Q${q.num}</span><span>${escapeHtml(q.title)}</span>`
        + `<span class="state" data-done="${done}">${done ? '回答済み' : '未回答'}</span></a>`
    })
    blocks.push(`<nav class="toc">\n${items.join('\n')}\n</nav>`)
  }

  for (const q of questions) blocks.push(await renderQuestionFallback(q, opts))

  return `<main>\n${blocks.join('\n\n')}\n</main>`
}

async function renderQuestionFallback(q, opts = {}) {
  const parts = []
  const submitted = Boolean(q.answer)
  const picked = parseAnswer(q)

  parts.push(`<section class="qsec" id="${escapeHtml(q.id)}"${submitted ? ' data-submitted="true"' : ''}>`)
  parts.push('  <div class="qhead">')
  parts.push(`    <div class="eyebrow">Q${q.num}</div>`)
  parts.push(`    <h2>${escapeHtml(q.title)}</h2>`)
  if (q.why_now) parts.push(`    <p class="why"><b>なぜ今この判断か</b> — ${mdInline(q.why_now)}</p>`)
  parts.push('  </div>')

  if (q.abstract || q.concrete) {
    parts.push('  <div class="meta">')
    if (q.abstract) parts.push(`    <div><b>抽象</b>${mdInline(q.abstract)}</div>`)
    if (q.concrete) parts.push(`    <div><b>具体</b>${mdInline(q.concrete)}</div>`)
    parts.push('  </div>')
  }
  if (q.prose.length) parts.push(`  <div class="prose">${mdBlocks(q.prose)}</div>`)

  for (const d of q.diagrams) {
    const rendered = await renderDiagram(d, `${q.id}-${d.id}`)
    parts.push(`  <div class="eyebrow">${escapeHtml(d.title)}</div>`)
    parts.push(`  <figure class="scroll" style="--fig-w:${rendered.displayWidth}px">`)
    parts.push(`    ${rendered.svg}`)
    if (d.caption) parts.push(`    <figcaption>${mdInline(d.caption)}</figcaption>`)
    parts.push('  </figure>')
  }

  parts.push('  <div class="eyebrow">選択肢</div>')
  parts.push('  <div class="options">')
  for (const o of q.options) {
    const rec = o.key === q.recommended
    parts.push(`    <div class="opt${rec ? ' rec' : ''}">`)
    parts.push(`      <div class="key">${escapeHtml(o.key)}</div>`)
    parts.push('      <div>')
    parts.push(`        <h3>${mdInline(o.label)}${rec ? ' <span class="tag">推奨</span>' : ''}</h3>`)
    parts.push('        <div class="gl">')
    parts.push(`          <div><b>得るもの</b>${mdInline(o.gains)}</div>`)
    parts.push(`          <div><b>失うもの</b>${mdInline(o.loses)}</div>`)
    parts.push('        </div>')
    parts.push('      </div>')
    parts.push('    </div>')
  }
  parts.push('  </div>')

  parts.push('  <div class="eyebrow">推奨とその根拠</div>')
  parts.push('  <div class="rec-box">')
  parts.push(`    <h3>${escapeHtml(q.recommended)} — ${mdInline(q.prioritized_tradeoff)}</h3>`)
  parts.push(`    ${mdBlocks(q.rationale.split('\n'))}`)
  if (q.sources.length) {
    parts.push('    <div class="src">')
    parts.push('      <span>根拠</span>')
    for (const s of q.sources) {
      if (s.kind === 'url' && SAFE_URL.test(s.ref)) {
        parts.push(`      <span><a href="${escapeHtml(s.ref)}" rel="noopener noreferrer">${escapeHtml(s.ref)}</a>${s.note ? ` — ${mdInline(s.note)}` : ''}</span>`)
      } else {
        parts.push(`      <span class="mono">${escapeHtml(s.ref)}${s.note ? ` — ${escapeHtml(s.note)}` : ''}</span>`)
      }
    }
    parts.push('    </div>')
  }
  parts.push('  </div>')

  parts.push(renderAnswerFormHtml(q, opts, picked, submitted))
  parts.push('</section>')
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// kit あり — writeup-kit のページ意匠・コンポーネントに乗せる。
// ---------------------------------------------------------------------------

async function renderKitBody({ frontmatter, premise, tree, questions, title, progress, opts, kd }) {
  const lead = premise && premise.prose.length ? firstParagraph(premise.prose) : null
  const today = new Date().toISOString().slice(0, 10)
  const header = [
    '<header class="wu-header">',
    `<p class="wu-eyebrow">尋問ラウンド &middot; round ${frontmatter.round} &middot; ${today}</p>`,
    `<h1>${escapeHtml(title)}</h1>`,
    lead ? `<p class="wu-lede">${mdInline(lead)}</p>` : '',
    '</header>',
  ].filter(Boolean).join('\n')

  const sections = []

  if (premise) {
    const rest = premise.prose.length ? dropFirstParagraph(premise.prose) : []
    const inner = []
    if (rest.length) inner.push(`<div class="wu-summary">${mdBlocks(rest, { kit: true })}</div>`)
    if (premise.rows.length) {
      const dl = premise.rows
        .map((r) => `<dt>${escapeHtml(PREMISE_LABEL[r.key] || r.key)}</dt><dd>${mdInline(r.value)}</dd>`)
        .join('\n')
      inner.push(`<dl class="wu-terms">\n${dl}\n</dl>`)
    }
    if (inner.length) {
      sections.push(['<section class="wu-section">', '<h2>前提</h2>', ...inner, '</section>'].join('\n'))
    }
  }

  sections.push([
    '<section class="wu-section">',
    '<h2>設計ツリー</h2>',
    treeList(tree, 1, 'ol'),
    `<p class="note">決定済み ${progress.decided} / 回答待ち ${progress.asked} / 未着手 ${progress.open}。このラウンドで聞いているのは「回答待ち」のノード。</p>`,
    '</section>',
  ].join('\n'))

  if (questions.length > 1) {
    const items = questions.map((q) => {
      const done = Boolean(q.answer)
      return `<li><a href="#${escapeHtml(q.id)}">Q${q.num} ${escapeHtml(q.title)} <span data-done="${done}">${done ? '（回答済み）' : '（未回答）'}</span></a></li>`
    })
    sections.push(`<nav class="wu-toc"><ol>\n${items.join('\n')}\n</ol></nav>`)
  }

  for (const q of questions) sections.push(await renderQuestionKit(q, opts, kd))

  return [
    '<div class="wu-page">',
    header,
    '<main>',
    sections.join('\n\n'),
    '</main>',
    '<footer class="wu-footer">',
    '<dl>',
    `<dt>進捗</dt><dd>決定済み ${progress.decided} / 回答待ち ${progress.asked} / 未着手 ${progress.open}</dd>`,
    '</dl>',
    '</footer>',
    '</div>',
  ].join('\n')
}

async function renderQuestionKit(q, opts, kd) {
  const parts = []
  const submitted = Boolean(q.answer)
  const picked = parseAnswer(q)

  parts.push(`<section class="wu-section" id="${escapeHtml(q.id)}"${submitted ? ' data-submitted="true"' : ''}>`)
  parts.push(`<h2>Q${q.num}: ${escapeHtml(q.title)}</h2>`)

  const termRows = []
  if (q.why_now) termRows.push(['なぜ今この判断か', mdInline(q.why_now)])
  if (q.abstract) termRows.push(['抽象', mdInline(q.abstract)])
  if (q.concrete) termRows.push(['具体', mdInline(q.concrete)])
  if (termRows.length) {
    parts.push('<dl class="wu-terms">')
    for (const [k, v] of termRows) parts.push(`<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`)
    parts.push('</dl>')
  }

  if (q.prose.length) parts.push(mdBlocks(q.prose, { kit: true }))

  for (const d of q.diagrams) {
    const attempt = await renderDiagramViaKit(d, q, kd)
    if (attempt.ok) { parts.push(attempt.html); continue }
    const rendered = await renderDiagram(d, `${q.id}-${d.id}`)
    const caption = d.caption ? mdInline(d.caption) : escapeHtml(d.title)
    parts.push(`<figure class="scroll" style="--fig-w:${rendered.displayWidth}px">`)
    parts.push(`  ${rendered.svg}`)
    parts.push(`  <figcaption>${caption}</figcaption>`)
    parts.push('</figure>')
    const hint = attempt.hint || 'writeup-kit の図検証に失敗したため、grilling 自前のレンダラーで描画しました。'
    parts.push(`<div class="wu-callout" data-tone="warn"><p>${escapeHtml(hint)}</p></div>`)
  }

  parts.push('<table class="wu-compare">')
  parts.push('<thead><tr><th>選択肢</th><th>得るもの</th><th>失うもの</th></tr></thead>')
  parts.push('<tbody>')
  for (const o of q.options) {
    const rec = o.key === q.recommended
    parts.push(`<tr><td><strong>${escapeHtml(o.key)}</strong> — ${mdInline(o.label)}${rec ? ' <strong>(推奨)</strong>' : ''}</td><td>${mdInline(o.gains)}</td><td>${mdInline(o.loses)}</td></tr>`)
  }
  parts.push('</tbody>')
  parts.push('</table>')

  parts.push(renderAnswerFormHtml(q, opts, picked, submitted))

  const recOpt = q.options.find((o) => o.key === q.recommended)
  parts.push('<div class="wu-decision">')
  parts.push(`<p><strong>推奨:</strong> ${escapeHtml(q.recommended)} — ${mdInline(recOpt ? recOpt.label : '')}</p>`)
  parts.push(`<p><strong>重視したトレードオフ:</strong> ${mdInline(q.prioritized_tradeoff)}</p>`)
  parts.push(mdBlocks(q.rationale.split('\n'), { kit: true }))
  parts.push('</div>')

  for (const s of q.sources) {
    if (s.kind === 'url' && SAFE_URL.test(s.ref)) {
      parts.push(`<p class="wu-meta"><a href="${escapeHtml(s.ref)}" rel="noopener noreferrer">${escapeHtml(s.ref)}</a>${s.note ? ` — ${mdInline(s.note)}` : ''}</p>`)
    } else {
      parts.push(`<p class="wu-meta">${escapeHtml(s.ref)}${s.note ? ` — ${escapeHtml(s.note)}` : ''}</p>`)
    }
  }

  parts.push('</section>')
  return parts.join('\n')
}

/**
 * grilling の diagram を kit の IR とみなして kit の renderFigureHtmlChecked
 * に渡す。両者は id/title/caption/direction/groups/nodes/edges の形が同じ
 * （tone/dashed/emphasis/kind の語彙も一致）ので変換はほぼ素通し。
 * 20 項目の検証（budget を含む）に通れば { ok: true, html }、
 * 通らなければ { ok: false, hint } を返す。
 */
async function renderDiagramViaKit(d, q, kd) {
  const renderFn = await loadKitRenderFigureHtmlChecked(kd)
  if (!renderFn) return { ok: false }
  const ir = {
    id: `${q.id}-${d.id}`,
    title: d.title,
    caption: d.caption,
    direction: d.directionPinned ? d.direction : undefined,
    groups: d.groups,
    nodes: d.nodes,
    edges: d.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label })),
  }
  const rawYaml = await safeRawYaml(d.raw, kd)
  let result
  try {
    result = await renderFn(ir, { rawYaml })
  } catch (e) {
    return { ok: false, hint: `writeup-kit の描画でエラーが起きました: ${e.message}` }
  }
  if (result.checksOk) return { ok: true, html: result.html }
  const failing = (result.checks || []).find((c) => !c.ok && c.hint)
  return { ok: false, hint: failing ? failing.hint : undefined }
}

/** kit の yaml-lite でも読めることを確かめてから rawYaml として埋め込む。読めなければ省く。 */
async function safeRawYaml(raw, kd) {
  if (!raw) return undefined
  const yamlParse = await loadKitYamlParse(kd)
  if (!yamlParse) return raw
  try {
    yamlParse(raw)
    return raw
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// 回答フォーム — kit の有無によらず共通（kit モードは CSS だけ差し替える）。
// ---------------------------------------------------------------------------

function renderAnswerFormHtml(q, opts, picked, submitted) {
  const parts = []
  const name = q.id
  parts.push(`<div class="answer" data-submitted="${submitted}"${submitted ? ` data-choice="${escapeHtml(picked.choice)}"` : ''}>`)
  parts.push('  <fieldset>')
  parts.push('    <legend>あなたの回答</legend>')
  for (const o of q.options) {
    const checked = picked.choice === o.key ? ' checked' : ''
    const hint = o.key === q.recommended ? '<small>推奨</small>' : ''
    parts.push(`    <label class="radio"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(o.key)}"${checked}><span><b>${escapeHtml(o.key)}</b> ${mdInline(o.label)}${hint}</span></label>`)
  }
  const otherChecked = picked.choice === 'other' ? ' checked' : ''
  parts.push(`    <label class="radio"><input type="radio" name="${escapeHtml(name)}" value="other"${otherChecked}><span><b>他</b> 下に書く</span></label>`)
  parts.push('  </fieldset>')
  parts.push('  <label>')
  parts.push('    <span class="note">補足・条件・反論（任意）</span>')
  parts.push(`    <textarea name="${escapeHtml(name)}-note" placeholder="例: A で。ただし …">${escapeHtml(picked.note)}</textarea>`)
  parts.push('  </label>')
  parts.push('  <div class="row">')
  const onclick = opts.serve ? 'grillingSubmit(this)' : submitScript(name)
  parts.push(`    <button type="button" onclick="${onclick}">提出</button>`)
  parts.push(`    <span class="status">${submitted ? `提出済み（${escapeHtml(picked.choice)}）` : '未提出'}</span>`)
  parts.push('  </div>')
  parts.push('</div>')
  return parts.join('\n')
}

function submitScript(name) {
  const js = "var a=this.closest('.answer');var s=a.querySelector('input[name=" + name + "]:checked');"
    + "if(!s){a.querySelector('.status').textContent='選択肢を 1 つ選んでください';return;}"
    + "a.setAttribute('data-submitted','true');a.setAttribute('data-choice',s.value);"
    + "a.closest('section').setAttribute('data-submitted','true');"
    + "a.querySelector('.status').textContent='提出しました（'+s.value+'）'"
  return escapeHtml(js)
}

/** `answer:` 行を選択キーと補足に割る。 */
export function parseAnswer(q) {
  if (!q.answer) return { choice: null, note: '' }
  const m = /^([^\s—-]+)\s*[—-]\s*(.*)$/.exec(q.answer.trim())
  if (m && q.options.some((o) => o.key === m[1])) return { choice: m[1], note: m[2] }
  const bare = q.options.find((o) => o.key === q.answer.trim())
  if (bare) return { choice: bare.key, note: '' }
  return { choice: 'other', note: q.answer.trim() }
}

function firstParagraph(lines) {
  const out = []
  for (const l of lines) {
    if (l.trim() === '') break
    if (/^[-*]\s+/.test(l.trim())) break
    out.push(l.trim())
  }
  return out.join(' ')
}

function dropFirstParagraph(lines) {
  let i = 0
  while (i < lines.length && lines[i].trim() !== '' && !/^[-*]\s+/.test(lines[i].trim())) i++
  while (i < lines.length && lines[i].trim() === '') i++
  return lines.slice(i)
}

// ---------------------------------------------------------------------------
// serve モード専用の差し込み。フッタ（提出済み n / m）と、提出ボタンから
// `/answer` へ POST するスクリプト。**Artifact / 単体 HTML には一切出さない。**
// `STATE_SLOT` はサーバが GET のたびに「提出済みの問い id の配列」へ差し替える。
// これでページを再読込しても提出済み数が戻らない。
// ---------------------------------------------------------------------------

export const STATE_SLOT = '/*__STATE__*/[]'

function jsonInScript(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c')
}

function serveBlock(frontmatter, questions, usingKit) {
  const cfg = jsonInScript({ round: frontmatter.round, slug: frontmatter.slug, total: questions.length })
  const t = usingKit
    ? { surface: 'var(--wu-surface)', line: 'var(--wu-rule)', ink: 'var(--wu-ink)', ink2: 'var(--wu-ink-2)' }
    : { surface: 'var(--surface)', line: 'var(--line)', ink: 'var(--ink)', ink2: 'var(--ink-2)' }
  const doneRule = usingKit
    ? '.serve-bar[data-done="true"] b{text-decoration:underline}'
    : '.serve-bar[data-done="true"] b{color:var(--rec)}'
  const css = `.serve-bar{position:sticky;bottom:0;z-index:5;display:flex;gap:8px;justify-content:center;`
    + `padding:10px 20px;background:${t.surface};border-top:1px solid ${t.line};`
    + `color:${t.ink2};font-size:.85rem}`
    + `.serve-bar b{color:${t.ink};font-weight:700}`
    + doneRule
  const js = `(function(){
var G=${cfg};
var posted=new Set(${STATE_SLOT});
function bar(){
  var el=document.getElementById('serve-bar');
  if(!el)return;
  el.setAttribute('data-done',String(posted.size>=G.total));
  document.getElementById('serve-count').textContent=posted.size+' / '+G.total;
}
window.grillingSubmit=function(btn){
  var a=btn.closest('.answer');
  var sec=a.closest('section');
  var st=a.querySelector('.status');
  var sel=a.querySelector('input[type=radio]:checked');
  if(!sel){st.textContent='選択肢を 1 つ選んでください';return;}
  var ta=a.querySelector('textarea');
  st.textContent='送信中…';
  fetch('/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    round:G.round,slug:G.slug,question:sec.id,choice:sel.value,note:ta?ta.value:'',ts:new Date().toISOString()
  })}).then(function(r){
    if(!r.ok){st.textContent='送信できませんでした（'+r.status+'）';return;}
    a.setAttribute('data-submitted','true');
    a.setAttribute('data-choice',sel.value);
    sec.setAttribute('data-submitted','true');
    st.textContent='提出しました（'+sel.value+'）';
    posted.add(sec.id);bar();
  }).catch(function(){st.textContent='送信できませんでした（サーバが終了しています）';});
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bar);else bar();
})();`
  return [
    `<style>${css}</style>`,
    `<footer class="serve-bar" id="serve-bar" data-done="false">提出済み <b id="serve-count">0 / ${questions.length}</b></footer>`,
    `<script>${js}</script>`,
  ].join('\n')
}
