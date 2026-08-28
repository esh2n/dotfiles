// 構造化されたラウンドを 1 ページの HTML にする。
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderDiagram } from './diagram.mjs'
import { treeProgress } from './parse.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = join(HERE, '..', 'template')

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
  + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
  + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&amp;family=Noto+Sans+JP:wght@400;500;700&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">'

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
 */
export function mdBlocks(lines) {
  const out = []
  let para = []
  let list = []
  let table = []
  const flushPara = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => {
    if (list.length) { out.push(`<ul>${list.map((li) => `<li>${mdInline(li)}</li>`).join('')}</ul>`); list = [] }
  }
  const flushTable = () => { if (table.length) { out.push(renderTable(table)); table = [] } }
  let code = null // コードブロックの中は行をそのまま集める
  for (const raw of lines) {
    if (code) {
      if (/^```\s*$/.test(raw.trim())) { out.push(`<pre class="code"><code>${escapeHtml(code.body.join('\n'))}</code></pre>`); code = null }
      else code.body.push(raw)
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
function renderTable(rows) {
  const cells = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const [head, ...body] = rows.map(cells)
  const th = head.map((c) => `<th>${mdInline(c)}</th>`).join('')
  const trs = body.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')
  return `<div class="scroll"><table class="md"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`
}

const TREE_STATE_LABEL = { decided: '決定済み', asked: '回答待ち', open: '未着手' }

/** 設計ツリーを入れ子リストにする。深さはインデントで表す。 */
function treeList(nodes, depth) {
  const pad = '  '.repeat(depth)
  const items = nodes.map((n) => {
    const chip = `<span class="chip" data-state="${n.state}">${TREE_STATE_LABEL[n.state]}</span>`
    const label = n.asks
      ? `<a class="tlabel" href="#${escapeHtml(n.asks)}">${escapeHtml(n.label)}</a>`
      : `<span class="tlabel">${escapeHtml(n.label)}</span>`
    const decision = n.state === 'decided' && n.decision
      ? `<span class="tdec">— ${mdInline(n.decision)}</span>`
      : ''
    const kids = n.children.length ? `\n${treeList(n.children, depth + 2)}\n${pad}  ` : ''
    return `${pad}  <li data-state="${n.state}"><span class="tnode">${chip}${label}${decision}</span>${kids}</li>`
  })
  return `${pad}<ul class="tree">\n${items.join('\n')}\n${pad}</ul>`
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
 * @param {{title?: string, fragment?: boolean}} opts
 */
export async function renderPage(round, opts = {}) {
  const { frontmatter, premise, tree, questions } = round
  const title = opts.title || frontmatter.target
  const progress = treeProgress(tree)

  const blocks = []

  // header
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

  // 前提
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

  // 設計ツリー — 入れ子リスト。SVG にすると横に伸びて読めなくなる。
  blocks.push([
    '<section>',
    '  <div class="eyebrow">設計ツリー</div>',
    treeList(tree, 1),
    `  <p class="note">決定済み ${progress.decided} / 回答待ち ${progress.asked} / 未着手 ${progress.open}。このラウンドで聞いているのは「回答待ち」のノード。</p>`,
    '</section>',
  ].join('\n'))

  // 目次
  if (questions.length > 1) {
    const items = questions.map((q) => {
      const done = Boolean(q.answer)
      return `  <a href="#${escapeHtml(q.id)}"><span class="n">Q${q.num}</span><span>${escapeHtml(q.title)}</span>`
        + `<span class="state" data-done="${done}">${done ? '回答済み' : '未回答'}</span></a>`
    })
    blocks.push(`<nav class="toc">\n${items.join('\n')}\n</nav>`)
  }

  // 問い
  for (const q of questions) blocks.push(await renderQuestion(q, opts))

  const main = `<main>\n${blocks.join('\n\n')}\n</main>`
  const body = opts.serve ? `${main}\n${serveBlock(frontmatter, questions)}` : main
  const style = await readFile(join(TEMPLATE_DIR, 'style.css'), 'utf8')

  if (opts.fragment) {
    return `<title>${escapeHtml(title)}</title>\n${FONTS}\n<style>\n${style}</style>\n\n${body}\n`
  }
  const shell = await readFile(join(TEMPLATE_DIR, 'page.html'), 'utf8')
  // $& などの置換パターンを含む見出しでも壊れないよう、すべて関数で差し込む
  return shell
    .replace('{{TITLE}}', () => escapeHtml(title))
    .replace('{{FONTS}}', () => FONTS)
    .replace('{{STYLE}}', () => style)
    .replace('{{BODY}}', () => body)
}

/**
 * serve モード専用の差し込み。フッタ（提出済み n / m）と、提出ボタンから
 * `/answer` へ POST するスクリプト。**Artifact / 単体 HTML には一切出さない。**
 * `STATE_SLOT` はサーバが GET のたびに「提出済みの問い id の配列」へ差し替える。
 * これでページを再読込しても提出済み数が戻らない。
 */
export const STATE_SLOT = '/*__STATE__*/[]'

function jsonInScript(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c')
}

function serveBlock(frontmatter, questions) {
  const cfg = jsonInScript({ round: frontmatter.round, slug: frontmatter.slug, total: questions.length })
  const css = '.serve-bar{position:sticky;bottom:0;z-index:5;display:flex;gap:8px;justify-content:center;'
    + 'padding:10px 20px;background:var(--surface);border-top:1px solid var(--line);'
    + 'color:var(--ink-2);font-size:.85rem}'
    + '.serve-bar b{color:var(--ink);font-weight:700}'
    + '.serve-bar[data-done="true"] b{color:var(--rec)}'
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

async function renderQuestion(q, opts = {}) {
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

  // 回答フォーム
  const name = q.id
  parts.push(`  <div class="answer" data-submitted="${submitted}"${submitted ? ` data-choice="${escapeHtml(picked.choice)}"` : ''}>`)
  parts.push('    <fieldset>')
  parts.push('      <legend>あなたの回答</legend>')
  for (const o of q.options) {
    const checked = picked.choice === o.key ? ' checked' : ''
    const hint = o.key === q.recommended ? '<small>推奨</small>' : ''
    parts.push(`      <label class="radio"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(o.key)}"${checked}><span><b>${escapeHtml(o.key)}</b> ${mdInline(o.label)}${hint}</span></label>`)
  }
  const otherChecked = picked.choice === 'other' ? ' checked' : ''
  parts.push(`      <label class="radio"><input type="radio" name="${escapeHtml(name)}" value="other"${otherChecked}><span><b>他</b> 下に書く</span></label>`)
  parts.push('    </fieldset>')
  parts.push('    <label>')
  parts.push('      <span class="note">補足・条件・反論（任意）</span>')
  parts.push(`      <textarea name="${escapeHtml(name)}-note" placeholder="例: A で。ただし …">${escapeHtml(picked.note)}</textarea>`)
  parts.push('    </label>')
  parts.push('    <div class="row">')
  const onclick = opts.serve ? 'grillingSubmit(this)' : submitScript(name)
  parts.push(`      <button type="button" onclick="${onclick}">提出</button>`)
  parts.push(`      <span class="status">${submitted ? `提出済み（${escapeHtml(picked.choice)}）` : '未提出'}</span>`)
  parts.push('    </div>')
  parts.push('  </div>')
  parts.push('</section>')
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
