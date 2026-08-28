import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { parseRound } from '../lib/parse.mjs'
import { renderPage, STATE_SLOT, faviconHref } from '../lib/html.mjs'
import { serveRound, summaryLine } from '../lib/serve.mjs'
import { parseServeArgs } from '../render.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')
const round = (name) => parseRound(fixture(name))

/** 書き込みを溜める stdout/stderr の代わり。 */
function sink() {
  const chunks = []
  return { write: (s) => chunks.push(s), text: () => chunks.join(''), lines: () => chunks.join('').split('\n').filter(Boolean) }
}

/**
 * fixture を --no-open + 空きポートで立ち上げ、URL が分かったところで body を走らせる。
 * 返り値は { code, out, err, outPath }。
 */
async function withServer(name, body, opts = {}) {
  const r = round(name)
  const html = await renderPage(r, { serve: true })
  const dir = mkdtempSync(join(tmpdir(), 'grilling-serve-'))
  const outPath = join(dir, 'answers.jsonl')
  const out = sink()
  const err = sink()
  let ready
  const url = new Promise((resolve) => { ready = resolve })
  // body が投げてもサーバを必ず畳む。畳まないとテストファイルが終わらない。
  const ac = new AbortController()
  const exit = serveRound({
    round: r,
    html,
    outPath,
    port: 0,
    openBrowser: false,
    signal: ac.signal,
    onListening: (u) => ready(u),
    stdout: out,
    stderr: err,
    ...opts,
  })
  const base = await url
  try {
    await body(base, { outPath, round: r })
  } catch (e) {
    ac.abort()
    await exit
    throw e
  }
  const code = await exit
  return { code, out, err, outPath, base }
}

const post = (base, payload) => fetch(new URL('/answer', base), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

const jsonl = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

/** Host ヘッダを自由に決められる素の GET（fetch は Host を書き換えてしまう）。 */
function rawGet(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject)
    req.end()
  })
}

test('serve: 全問提出で jsonl に追記され、要約を出して 0 で終わる', async () => {
  const { code, out, err, outPath } = await withServer('round-serve.md', async (base) => {
    const r1 = await post(base, { round: 1, slug: 'serve-fixture', question: 'q1', choice: 'A', note: 'jsonl で', ts: '2026-01-01T00:00:00.000Z' })
    assert.equal(r1.status, 204)
    const r2 = await post(base, { round: 1, slug: 'serve-fixture', question: 'q2', choice: 'B', note: '', ts: '2026-01-01T00:00:01.000Z' })
    assert.equal(r2.status, 204)
  })

  assert.equal(code, 0)

  const rows = jsonl(outPath)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    round: 1, slug: 'serve-fixture', question: 'q1', choice: 'A', note: 'jsonl で', ts: '2026-01-01T00:00:00.000Z',
  })
  assert.deepEqual(rows[1], {
    round: 1, slug: 'serve-fixture', question: 'q2', choice: 'B', note: '', ts: '2026-01-01T00:00:01.000Z',
  })

  // 要約は stdout に問いの順で 1 行ずつ。補足が空なら choice だけ。
  assert.deepEqual(out.lines(), ['q1: A — jsonl で', 'q2: B'])
  assert.match(err.text(), /提出済み 2 \/ 2/)
})

test('serve: round / slug はラウンド文書が正本で、クライアントの申告を採らない', async () => {
  const { outPath } = await withServer('round-serve.md', async (base) => {
    await post(base, { round: 999, slug: 'なりすまし', question: 'q1', choice: 'A', note: '' })
    await post(base, { round: 999, slug: 'なりすまし', question: 'q2', choice: 'A', note: '' })
  })
  for (const row of jsonl(outPath)) {
    assert.equal(row.round, 1)
    assert.equal(row.slug, 'serve-fixture')
  }
})

test('serve: 再提出は行として残り、要約は最後の 1 行が勝つ', async () => {
  const { code, out, outPath } = await withServer('round-serve.md', async (base) => {
    await post(base, { round: 1, slug: 'x', question: 'q1', choice: 'A', note: '打ち間違い' })
    await post(base, { round: 1, slug: 'x', question: 'q1', choice: 'B', note: 'やっぱり B' })
    await post(base, { round: 1, slug: 'x', question: 'q2', choice: 'A', note: '' })
  })

  assert.equal(code, 0)
  const rows = jsonl(outPath)
  assert.equal(rows.length, 3, '再提出も 1 行として残る')
  assert.deepEqual(rows.map((r) => [r.question, r.choice]), [['q1', 'A'], ['q1', 'B'], ['q2', 'A']])
  assert.deepEqual(out.lines(), ['q1: B — やっぱり B', 'q2: A'])
})

test('serve: SIGINT は 130 で終わり、そこまでの回答だけを要約する', async () => {
  const { code, out, err, outPath } = await withServer('round-serve.md', async (base) => {
    await post(base, { round: 1, slug: 'x', question: 'q1', choice: 'A', note: '途中' })
    process.emit('SIGINT')
  })

  assert.equal(code, 130)
  assert.equal(jsonl(outPath).length, 1)
  assert.deepEqual(out.lines(), ['q1: A — 途中'])
  assert.match(err.text(), /未提出 1 \/ 2/)
})

test('serve: 未知の問い / 未知の選択肢 / 壊れた JSON は 400 で、書き込まない', async () => {
  const res = await withServer('round-serve.md', async (base, ctx) => {
    const bad = await post(base, { question: 'q9', choice: 'A' })
    assert.equal(bad.status, 400)
    assert.match(await bad.text(), /未知の問い/)

    const badKey = await post(base, { question: 'q1', choice: 'Z' })
    assert.equal(badKey.status, 400)
    assert.match(await badKey.text(), /未知の選択肢/)

    const broken = await fetch(new URL('/answer', base), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    })
    assert.equal(broken.status, 400)

    assert.equal(existsSync(ctx.outPath), false, '400 では 1 行も書かない')

    await post(base, { question: 'q1', choice: 'A' })
    await post(base, { question: 'q2', choice: 'other', note: '選択肢外' })
  })
  assert.deepEqual(jsonl(res.outPath).map((r) => r.choice), ['A', 'other'])
})

test('serve: GET / は提出済みの問い id を差し込んで返し、未知のパスは 404', async () => {
  await withServer('round-serve.md', async (base) => {
    const first = await fetch(base)
    assert.equal(first.status, 200)
    const page1 = await first.text()
    assert.ok(page1.includes('id="serve-bar"'), 'フッタが無い')
    assert.ok(page1.includes('提出済み <b id="serve-count">0 / 2</b>'))
    assert.ok(page1.includes('new Set([])'), '初回は提出済みが空')
    assert.ok(!page1.includes(STATE_SLOT), 'プレースホルダが残っている')

    await post(base, { question: 'q1', choice: 'A' })

    const page2 = await (await fetch(base)).text()
    assert.ok(page2.includes('new Set(["q1"])'), '再読込で提出済みが復元されない')

    assert.equal((await fetch(new URL('/nope', base))).status, 404)

    await post(base, { question: 'q2', choice: 'A' })
  })
})

test('serve: ループバック以外の Host には応じない', async () => {
  await withServer('round-serve.md', async (base) => {
    // fetch は Host を書き換えるので、node:http で直に投げる
    const status = await rawGet(new URL(base).port, '/', 'evil.example.com')
    assert.equal(status, 403)
    assert.equal(await rawGet(new URL(base).port, '/', `127.0.0.1:${new URL(base).port}`), 200)
    await post(base, { question: 'q1', choice: 'A' })
    await post(base, { question: 'q2', choice: 'A' })
  })
})

test('serve の差し込みは serve モードだけ。単体 HTML と fragment には出ない', async () => {
  const r = round('round-serve.md')
  const plain = await renderPage(r)
  const frag = await renderPage(r, { fragment: true })
  for (const [name, html] of [['単体', plain], ['fragment', frag]]) {
    assert.ok(!html.includes('/answer'), `${name} に POST 先が漏れている`)
    assert.ok(!html.includes('grillingSubmit'), `${name} に serve のスクリプトが漏れている`)
    assert.ok(!html.includes('serve-bar'), `${name} に serve のフッタが漏れている`)
  }
  const served = await renderPage(r, { serve: true })
  assert.ok(served.includes('grillingSubmit(this)'), 'serve のボタンが差し替わっていない')
  assert.ok(served.includes("fetch('/answer'"))
  assert.ok(served.startsWith('<!doctype html>'), 'serve は完全な HTML 文書で出す')
})

test('parseServeArgs: --out / --port / --no-open と、不正な値', () => {
  const a = parseServeArgs(['r.md', '--out', 'a.jsonl', '--port', '8123', '--no-open'])
  assert.deepEqual(a, { input: 'r.md', out: 'a.jsonl', title: null, port: 8123, open: false, help: false })

  const b = parseServeArgs(['r.md'])
  assert.equal(b.port, 0, '既定は空きポート')
  assert.equal(b.open, true)

  assert.throws(() => parseServeArgs(['r.md', '--port', 'abc']), /--port は 1〜65535/)
  assert.throws(() => parseServeArgs(['r.md', '--port', '70000']), /--port は 1〜65535/)
  assert.throws(() => parseServeArgs(['r.md', '--zzz']), /未知のオプション/)
  assert.throws(() => parseServeArgs(['a.md', 'b.md']), /入力ファイルは 1 つだけ/)
})

// --- 回答状況のファビコン / タイトル進捗（serve モード） -------------------

function faviconHrefIn(html) {
  const m = /<link rel="icon" href="([^"]*)">/.exec(html)
  return m ? m[1] : null
}

test('serve: 提出が進むほど GET / のファビコンとタイトルが pending → partial → done と変わる', async () => {
  await withServer('round-serve.md', async (base) => {
    const page0 = await (await fetch(base)).text()
    assert.equal(faviconHrefIn(page0), faviconHref('pending'))
    assert.match(page0, /<title>\(0\/2\) serve モードのテスト用ラウンド<\/title>/)

    await post(base, { question: 'q1', choice: 'A' })
    const page1 = await (await fetch(base)).text()
    assert.equal(faviconHrefIn(page1), faviconHref('partial'))
    assert.match(page1, /<title>\(1\/2\) serve モードのテスト用ラウンド<\/title>/)

    await post(base, { question: 'q2', choice: 'A' })
    const page2 = await (await fetch(base)).text()
    assert.equal(faviconHrefIn(page2), faviconHref('done'))
    assert.match(page2, /<title>\(done\) serve モードのテスト用ラウンド<\/title>/)
  })
})

test('serve: answers.jsonl の読み戻しだけで初回 GET から partial / done になる', async () => {
  const r = round('round-serve.md')
  const html = await renderPage(r, { serve: true })
  const dir = mkdtempSync(join(tmpdir(), 'grilling-serve-'))
  const outPath = join(dir, 'answers.jsonl')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(outPath, [
    JSON.stringify({ round: 1, slug: 'serve-fixture', question: 'q1', choice: 'A', note: '', ts: '2026-01-01T00:00:00.000Z' }),
  ].join('\n') + '\n', 'utf8')

  const err = sink()
  const ac = new AbortController()
  let ready
  const url = new Promise((resolve) => { ready = resolve })
  const exit = serveRound({
    round: r, html, outPath, port: 0, openBrowser: false, signal: ac.signal,
    onListening: (u) => ready(u), stdout: sink(), stderr: err,
  })
  const base = await url
  try {
    const page = await (await fetch(base)).text()
    assert.equal(faviconHrefIn(page), faviconHref('partial'), '読み戻した q1 の分で partial のはず')
    assert.match(page, /<title>\(1\/2\) serve モードのテスト用ラウンド<\/title>/)
    await post(base, { question: 'q2', choice: 'A' })
  } finally {
    ac.abort()
    await exit
  }
})

test('summaryLine: 補足の改行は 1 行に潰し、空なら choice だけ', () => {
  assert.equal(summaryLine('q1', { choice: 'A', note: '一行目\n二行目  ' }), 'q1: A — 一行目 二行目')
  assert.equal(summaryLine('q1', { choice: 'A', note: '   ' }), 'q1: A')
  assert.equal(summaryLine('q1', { choice: 'other' }), 'q1: other')
})
