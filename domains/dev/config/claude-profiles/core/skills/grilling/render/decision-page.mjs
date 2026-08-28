#!/usr/bin/env node
// grilling の決定記録 Markdown（SKILL.md §12: `## 決定記録` ブロック）を
// writeup ページ（kind: 決定記録）に変換する。
//   node decision-page.mjs <decisions.md> --out <page.html>
// 書き出し後、writeup-kit の bin/self-check.mjs --write-meta を実行して結果を出す。
// writeup-kit 必須（ページ意匠そのものが kit のものなので、フォールバックはない）。
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { escapeHtml, mdInline } from './lib/html.mjs'
import { kitDir, kitCss } from './lib/kit.mjs'

const USAGE = `使い方:
  node decision-page.mjs <decisions.md> --out <page.html>

<decisions.md> の "## 決定記録" ブロック（決まったこと / 検討して却下した案 /
未決・前提 / 推奨アプローチ / 出典 / 次のステップ / 元ラウンド）を読み、
writeup-kit の kind: 決定記録 ページとして書き出す。書き出し後、
writeup-kit の bin/self-check.mjs --write-meta を実行し、結果を標準出力に出す。

  -h, --help   この使い方を表示する`

export function parseArgs(argv) {
  const out = { input: null, out: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { out.help = true }
    else if (a === '--out' || a === '-o') { out.out = argv[++i] ?? null; if (out.out === null) throw new Error('--out の後にパスがありません') }
    else if (a.startsWith('-')) throw new Error(`未知のオプション: ${a}`)
    else if (out.input === null) out.input = a
    else throw new Error(`入力ファイルは 1 つだけです（余分な引数: ${a}）`)
  }
  return out
}

// --- Markdown -> 構造化データ ------------------------------------------------

const H2_HEADING = /^##\s+(.+?)\s*$/
const H3_HEADING = /^###\s*(.+?)\s*$/
const BULLET = /^[-*]\s+(.*)$/
const ORDERED = /^\d+\.\s+(.*)$/
const BOLD_ONLY = /^\*\*([^*]+)\*\*$/

/**
 * grilling の決定記録 Markdown を構造化データにする。
 * "## 決定記録" が見つからなければ投げる。
 * @param {string} text
 */
export function parseDecisionRecord(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  let i = 0

  let title = null
  if (/^#\s+(.+)$/.test(lines[0] || '')) { title = /^#\s+(.+)$/.exec(lines[0])[1].trim(); i = 1 }

  const ledeLines = []
  while (i < lines.length && !H2_HEADING.test(lines[i])) {
    if (lines[i].trim() !== '') ledeLines.push(lines[i].trim())
    i++
  }
  const lede = ledeLines.join(' ')

  while (i < lines.length && !(H2_HEADING.test(lines[i]) && /決定記録/.test(lines[i]))) i++
  if (i >= lines.length) throw new Error('"## 決定記録" が見つかりません')
  i++

  const sections = new Map() // 見出しテキスト -> 本文行[]
  let current = null
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (H2_HEADING.test(line)) break // 次の h2 で決定記録ブロックは終わり
    const h3 = H3_HEADING.exec(line)
    if (h3) { current = h3[1]; sections.set(current, []); continue }
    if (current) sections.get(current).push(line)
  }

  const find = (needle) => {
    for (const [heading, body] of sections) if (heading.includes(needle)) return body
    return []
  }

  return {
    title: title || '決定記録',
    lede,
    decided: parseDecidedBullets(find('決まったこと')),
    rejected: parseLabelDetailBullets(find('却下した案')),
    open: parseBullets(find('未決・前提')),
    approach: parseOrderedItems(find('推奨アプローチ')),
    sources: parseBullets(find('出典')),
    nextSteps: parseOrderedItems(find('次のステップ')),
    originRound: find('元ラウンド').map((l) => l.trim()).filter(Boolean).join(' '),
  }
}

/**
 * "決まったこと" の本文。`**グループ見出し**` だけの行はグループ名として、
 * 続く `- 決定 — 重視したトレードオフ: ...` 形式の箇条書きは
 * { group, decision, tradeoff } に割る（`重視` が無い箇条書きは tradeoff: null）。
 */
function parseDecidedBullets(lines) {
  const out = []
  let group = null
  const tradeoffRe = /^(.*?)\s+—\s+重視(?:したトレードオフ)?\s*[:：]\s*(.*)$/
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    const bold = BOLD_ONLY.exec(line)
    if (bold) { group = bold[1]; continue }
    const li = BULLET.exec(line)
    if (!li) continue
    const m = tradeoffRe.exec(li[1])
    out.push(m ? { group, decision: m[1], tradeoff: m[2] } : { group, decision: li[1], tradeoff: null })
  }
  return out
}

/** "却下した案" の `- 案 — 理由` 形式。理由が無ければ detail は空文字。 */
function parseLabelDetailBullets(lines) {
  const out = []
  for (const raw of lines) {
    const li = BULLET.exec(raw.trim())
    if (!li) continue
    const m = /^(.*?)\s+—\s+(.*)$/.exec(li[1])
    out.push(m ? { label: m[1], detail: m[2] } : { label: li[1], detail: '' })
  }
  return out
}

/** 素の箇条書き（未決・前提、出典）。 */
function parseBullets(lines) {
  const out = []
  for (const raw of lines) {
    const li = BULLET.exec(raw.trim())
    if (li) out.push(li[1])
  }
  return out
}

/**
 * 番号付き（`1. `）または箇条書き（`- `）のどちらでも項目として拾う
 * （推奨アプローチ・次のステップ）。項目に続く地の文は前の項目に連結する。
 */
function parseOrderedItems(lines) {
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    const ordered = ORDERED.exec(line)
    if (ordered) { out.push(ordered[1]); continue }
    const li = BULLET.exec(line)
    if (li) { out.push(li[1]); continue }
    if (out.length) out[out.length - 1] += ` ${line}`
  }
  return out
}

/** チャンクの markdown 記法（`**` / `` ` `` / `[text](url)`）を平文に戻す。
 * ヘッダ／フッタの chrome は writeup-kit の self-check が
 * kit/template.html と構造（タグ + クラスの木）を厳密比較するため、
 * 中に要素を作る mdInline は使えない（プレーンテキストのみ許される）。 */
function stripMd(text) {
  return String(text)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

const BARE_URL = /https?:\/\/[^\s）」』"'<>（、。]+/g

/** 素の URL を `[url](url)` に変えてから mdInline に渡す（出典の裸 URL をリンクにする）。 */
function autolink(text) {
  return String(text).replace(BARE_URL, (m) => `[${m}](${m})`)
}

// --- 構造化データ -> HTML ----------------------------------------------------

function renderDecidedSection(decided) {
  const parts = ['<section class="wu-section">', '<h2>決まったこと</h2>']
  let lastGroup
  for (const d of decided) {
    if (d.group !== lastGroup) {
      if (d.group) parts.push(`<h3>${escapeHtml(d.group)}</h3>`)
      lastGroup = d.group
    }
    parts.push('<div class="wu-decision">')
    parts.push(`<p>${mdInline(d.decision)}</p>`)
    if (d.tradeoff) parts.push(`<p><strong>重視したトレードオフ:</strong> ${mdInline(d.tradeoff)}</p>`)
    parts.push('</div>')
  }
  parts.push('</section>')
  return parts.join('\n')
}

function renderRejectedSection(rejected) {
  const items = rejected.map((r) => `<li>${mdInline(r.label)}${r.detail ? ` — ${mdInline(r.detail)}` : ''}</li>`)
  return ['<section class="wu-section">', '<h2>検討して却下した案</h2>', `<ul>\n${items.join('\n')}\n</ul>`, '</section>'].join('\n')
}

function renderOpenSection(open) {
  const items = open.map((o) => `<li>${mdInline(o)}</li>`)
  return [
    '<section class="wu-section">', '<h2>未決・前提</h2>',
    `<div class="wu-open">\n<ul>\n${items.join('\n')}\n</ul>\n</div>`,
    '</section>',
  ].join('\n')
}

function renderStepsSection(heading, items) {
  if (!items.length) return ''
  const lis = items.map((t) => `<li>${mdInline(t)}</li>`)
  return [
    '<section class="wu-section">', `<h2>${escapeHtml(heading)}</h2>`,
    `<ol class="wu-steps">\n${lis.join('\n')}\n</ol>`,
    '</section>',
  ].join('\n')
}

function renderSourcesSection(sources, originRound) {
  const parts = ['<section class="wu-section">', '<h2>出典</h2>']
  for (const s of sources) parts.push(`<p class="wu-meta">${mdInline(autolink(s))}</p>`)
  if (originRound) parts.push(`<p class="wu-meta">元ラウンド: ${mdInline(autolink(originRound))}</p>`)
  parts.push('</section>')
  return parts.join('\n')
}

/**
 * 決定記録の構造化データを、kit/template.html の chrome に乗せた
 * 1 枚の完全な HTML 文書にする。writeup-kit 必須（フォールバックなし）。
 * @param {ReturnType<typeof parseDecisionRecord>} parsed
 * @param {{date?: string, kitDir?: string}} [opts]
 */
export async function buildDecisionPage(parsed, opts = {}) {
  const kd = kitDir(opts.kitDir)
  if (!kd) throw new Error('writeup-kit が見つかりません（decision-page.mjs は kit 必須です）')
  const css = await kitCss(kd)

  const date = opts.date || new Date().toISOString().slice(0, 10)
  const title = stripMd(parsed.title)
  const ledeSource = parsed.lede || parsed.decided[0]?.decision || '決定記録。'
  const lede = stripMd(ledeSource)
  const description = lede.slice(0, 116)

  const sections = [renderDecidedSection(parsed.decided)]
  if (parsed.rejected.length) sections.push(renderRejectedSection(parsed.rejected))
  if (parsed.open.length) sections.push(renderOpenSection(parsed.open))
  const approach = renderStepsSection('推奨アプローチ', parsed.approach)
  if (approach) sections.push(approach)
  const nextSteps = renderStepsSection('次のステップ', parsed.nextSteps)
  if (nextSteps) sections.push(nextSteps)
  sections.push(renderSourcesSection(parsed.sources, parsed.originRound))

  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="UTF-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    '<meta name="kind" content="決定記録">',
    `<meta name="date" content="${date}">`,
    `<meta name="updated" content="${date}">`,
    '<meta name="checks" content="self-check=pending">',
    '<meta name="robots" content="noindex">',
    // kit/template.html と同じ 1 本だけ（self-check の single-file チェックは
    // fonts.googleapis.com 配下のパス付き URL だけを許す。preconnect の
    // オリジンだけの href は弾かれるので置かない）。
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700&family=BIZ+UDPGothic:wght@400;700&family=IBM+Plex+Mono:wght@400;500&display=swap">',
    `<style>\n${css}</style>`,
    '</head>',
    '<body>',
    '<div class="wu-page">',
    '<header class="wu-header">',
    `<p class="wu-eyebrow">${escapeHtml(`決定記録 ・ ${date}`)}</p>`,
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="wu-lede">${escapeHtml(lede)}</p>`,
    '</header>',
    '<main>',
    sections.join('\n\n'),
    '</main>',
    '<footer class="wu-footer">',
    '<dl>',
    '<dt>checks</dt><dd>self-check=pending</dd>',
    `<dt>sources</dt><dd>${parsed.sources.length ? `${parsed.sources.length} 件` : '&mdash;'}</dd>`,
    '</dl>',
    '</footer>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n')
}

// --- CLI --------------------------------------------------------------------

export async function main(argv) {
  const args = parseArgs(argv)
  if (args.help || !args.input || !args.out) {
    console.log(USAGE)
    return args.help ? 0 : 1
  }
  const inputPath = resolve(args.input)
  let text
  try {
    text = await readFile(inputPath, 'utf8')
  } catch (e) {
    console.error(`決定記録を読めません: ${inputPath} (${e.code || e.message})`)
    return 1
  }
  let parsed
  try {
    parsed = parseDecisionRecord(text)
  } catch (e) {
    console.error(`${inputPath}: ${e.message}`)
    return 2
  }
  let html
  try {
    html = await buildDecisionPage(parsed)
  } catch (e) {
    console.error(e.message)
    return 3
  }
  const outPath = resolve(args.out)
  await writeFile(outPath, html, 'utf8')
  console.log(outPath)

  const kd = kitDir()
  if (!kd) {
    console.error('writeup-kit が見つからないため self-check を実行できませんでした')
    return 0
  }
  const selfCheckPath = join(kd, 'bin', 'self-check.mjs')
  try {
    const out = execFileSync('node', [selfCheckPath, outPath, '--write-meta'], { encoding: 'utf8' })
    console.log(out.trim() || 'self-check: no findings')
  } catch (e) {
    if (e.stdout) console.log(String(e.stdout).trim())
    else console.error(`self-check の実行に失敗しました: ${e.message}`)
  }
  return 0
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch { return false }
})()

if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }).catch((e) => {
    console.error(e.stack || String(e))
    process.exitCode = 1
  })
}
