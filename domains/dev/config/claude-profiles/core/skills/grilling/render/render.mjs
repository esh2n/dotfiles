#!/usr/bin/env node
// grilling のラウンド文書を 1 ページの HTML に描画する。
//   node render.mjs <round.md> [-o out.html] [--title "..."] [--fragment]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseRound, SchemaError } from './lib/parse.mjs'
import { renderPage } from './lib/html.mjs'

const USAGE = `使い方: node render.mjs <round.md> [-o <out.html>] [--title "<見出し>"] [--fragment]

  -o, --out <path>   出力先。省略時は $GRILLING_OUT_DIR（未設定なら入力と同じディレクトリ）
      --title <str>  ページ見出し。省略時は frontmatter の target
      --fragment     <title> + <style> + <main> だけを出す（Artifact 公開用）
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

function defaultOut(input, fragment) {
  const dir = process.env.GRILLING_OUT_DIR || dirname(resolve(input))
  const stem = basename(input, extname(input))
  return join(dir, `${stem}${fragment ? '.fragment' : ''}.html`)
}

export async function main(argv) {
  const args = parseArgs(argv)
  if (args.help || !args.input) {
    console.log(USAGE)
    return args.help ? 0 : 1
  }
  const inputPath = resolve(args.input)
  let text
  try {
    text = await readFile(inputPath, 'utf8')
  } catch (e) {
    console.error(`ラウンド文書を読めません: ${inputPath} (${e.code || e.message})`)
    return 1
  }
  let round
  try {
    round = parseRound(text)
  } catch (e) {
    if (e instanceof SchemaError) {
      console.error(`${inputPath}: スキーマ違反 ${e.message}`)
      return 2
    }
    throw e
  }
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
