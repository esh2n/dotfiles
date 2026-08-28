#!/usr/bin/env node
// grilling のラウンド文書を 1 ページの HTML に描画する。
//   node render.mjs <round.md> [-o out.html] [--title "..."] [--fragment]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseRound, SchemaError } from './lib/parse.mjs'
import { renderPage } from './lib/html.mjs'
import { serveRound } from './lib/serve.mjs'

const USAGE = `使い方:
  node render.mjs <round.md> [-o <out.html>] [--title "<見出し>"] [--fragment]
  node render.mjs serve <round.md> [--out <answers.jsonl>] [--port <N>] [--no-open]

書き出し:
  -o, --out <path>   出力先。省略時は $GRILLING_OUT_DIR（未設定なら入力と同じディレクトリ）
      --title <str>  ページ見出し。省略時は frontmatter の target
      --fragment     <title> + <style> + <main> だけを出す（Artifact 公開用）

serve（ローカルで回答を集める。全問の提出まで戻らない）:
      --out <path>   回答の追記先 jsonl。省略時は <round.md と同じディレクトリ>/answers.jsonl
      --port <N>     待ち受けポート。省略時は空きポート
      --no-open      ブラウザを自動で開かない

  -h, --help         この使い方を表示する`

export function parseArgs(argv) {
  const out = { input: null, out: null, title: null, fragment: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { out.help = true }
    else if (a === '-o' || a === '--out') { out.out = argv[++i] ?? null; if (out.out === null) throw new Error('-o の後にパスがありません') }
    else if (a === '--title') { out.title = argv[++i] ?? null; if (out.title === null) throw new Error('--title の後に文字列がありません') }
    else if (a === '--fragment') { out.fragment = true }
    else if (a.startsWith('-')) throw new Error(`未知のオプション: ${a}`)
    else if (out.input === null) out.input = a
    else throw new Error(`入力ファイルは 1 つだけです（余分な引数: ${a}）`)
  }
  return out
}

export function parseServeArgs(argv) {
  const out = { input: null, out: null, title: null, port: 0, open: true, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { out.help = true }
    else if (a === '-o' || a === '--out') { out.out = argv[++i] ?? null; if (out.out === null) throw new Error('--out の後にパスがありません') }
    else if (a === '--title') { out.title = argv[++i] ?? null; if (out.title === null) throw new Error('--title の後に文字列がありません') }
    else if (a === '--port') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--port の後に番号がありません')
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`--port は 1〜65535 の整数です (実際: ${v})`)
      out.port = n
    } else if (a === '--no-open') { out.open = false }
    else if (a.startsWith('-')) throw new Error(`未知のオプション: ${a}`)
    else if (out.input === null) out.input = a
    else throw new Error(`入力ファイルは 1 つだけです（余分な引数: ${a}）`)
  }
  return out
}

function defaultOut(input, fragment) {
  const dir = process.env.GRILLING_OUT_DIR || dirname(resolve(input))
  const stem = basename(input, extname(input))
  return join(dir, `${stem}${fragment ? '.fragment' : ''}.html`)
}

/** ラウンド文書を読んで構造化する。読めない/スキーマ違反なら終了コードを返す。 */
async function loadRound(inputPath) {
  let text
  try {
    text = await readFile(inputPath, 'utf8')
  } catch (e) {
    console.error(`ラウンド文書を読めません: ${inputPath} (${e.code || e.message})`)
    return { code: 1 }
  }
  try {
    return { round: parseRound(text) }
  } catch (e) {
    if (e instanceof SchemaError) {
      console.error(`${inputPath}: スキーマ違反 ${e.message}`)
      return { code: 2 }
    }
    throw e
  }
}

async function mainServe(argv) {
  const args = parseServeArgs(argv)
  if (args.help || !args.input) {
    console.log(USAGE)
    return args.help ? 0 : 1
  }
  const inputPath = resolve(args.input)
  const loaded = await loadRound(inputPath)
  if (loaded.code !== undefined) return loaded.code
  const round = loaded.round

  const html = await renderPage(round, { title: args.title, serve: true })
  const outPath = resolve(args.out || join(dirname(inputPath), 'answers.jsonl'))
  // --port 省略時は slug から決まる固定ポートにする。ラウンドをまたいで同じ URL を
  // 開き直せることが serve の使い勝手そのものなので、空きポート任せにしない。
  const port = args.port || slugPort(round.frontmatter.slug)
  return await serveRound({
    round,
    html,
    outPath,
    port,
    fallbackToFreePort: args.port === 0,
    openBrowser: args.open,
  })
}

/** slug を 40000〜49999 のポートに写す。同じ slug なら常に同じ番号。 */
export function slugPort(slug) {
  let h = 0
  for (const ch of String(slug)) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return 40000 + (h % 10000)
}

export async function main(argv) {
  if (argv[0] === 'serve') return await mainServe(argv.slice(1))

  const args = parseArgs(argv)
  if (args.help || !args.input) {
    console.log(USAGE)
    return args.help ? 0 : 1
  }
  const inputPath = resolve(args.input)
  const loaded = await loadRound(inputPath)
  if (loaded.code !== undefined) return loaded.code
  const round = loaded.round
  const html = await renderPage(round, { title: args.title, fragment: args.fragment })
  const outPath = resolve(args.out || defaultOut(inputPath, args.fragment))
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, html, 'utf8')
  console.log(outPath)
  return 0
}

// シンボリックリンク経由（~/.claude/skills/...）でも直接実行を検出するため realpath で比べる
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
