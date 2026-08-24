// serve モード — ラウンドをローカルに立てて、回答が揃うまでブロックする。
// 依存は node 標準のみ（node:http）。ページ側の差し込みは lib/html.mjs の serveBlock。
import { createServer } from 'node:http'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { STATE_SLOT } from './html.mjs'

const MAX_BODY = 64 * 1024
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
/** 最後の 204 がブラウザに届く猶予。これを待ってからサーバを畳む。 */
export const GRACE_MS = 300

/** 要約 1 行。改行を含む補足は 1 行に潰す（stdout を行指向に保つため）。 */
export function summaryLine(id, rec) {
  const note = String(rec.note ?? '').replace(/\s+/g, ' ').trim()
  return note ? `${id}: ${rec.choice} — ${note}` : `${id}: ${rec.choice}`
}

/**
 * ラウンドを 127.0.0.1 で配り、全問の提出を待つ。
 *
 * @param {object} o
 * @param {object} o.round      parseRound の戻り値
 * @param {string} o.html       serve 差し込み済みの完全な HTML
 * @param {string} o.outPath    追記先の answers.jsonl
 * @param {number} [o.port]     0 なら空きポート
 * @param {boolean} [o.openBrowser]
 * @param {AbortSignal} [o.signal] abort すると SIGINT と同じ扱い（130）で畳む
 * @param {(url: string, port: number) => void} [o.onListening]
 * @param {{write:(s:string)=>void}} [o.stdout]
 * @param {{write:(s:string)=>void}} [o.stderr]
 * @returns {Promise<number>} 終了コード（全問提出 = 0 / SIGINT = 130）
 */
export async function serveRound(o) {
  const {
    round, html, outPath, port = 0, openBrowser = true, signal,
    onListening, stdout = process.stdout, stderr = process.stderr,
  } = o
  const questions = round.questions
  const total = questions.length
  const allowed = new Map(questions.map((q) => [q.id, new Set([...q.options.map((x) => x.key), 'other'])]))
  /** @type {Map<string, object>} 問い id → 有効な回答。再提出は上書き（最後の 1 行が勝つ）。 */
  const answers = new Map()

  await mkdir(dirname(outPath), { recursive: true })
  // 追記を直列化する。同時提出でも 1 行が混ざらない。
  let writeChain = Promise.resolve()

  let settled = false
  let graceTimer = null
  let resolveExit
  const exit = new Promise((r) => { resolveExit = r })

  const onSigint = () => finish(130)
  const onAbort = () => finish(130)

  function finish(code) {
    if (settled) return
    settled = true
    if (graceTimer) clearTimeout(graceTimer)
    process.off('SIGINT', onSigint)
    signal?.removeEventListener('abort', onAbort)
    server.closeAllConnections?.()
    server.close(() => {})
    for (const q of questions) {
      const rec = answers.get(q.id)
      if (rec) stdout.write(`${summaryLine(q.id, rec)}\n`)
    }
    if (answers.size < total) stderr.write(`未提出 ${total - answers.size} / ${total}（中断）\n`)
    resolveExit(code)
  }

  function scheduleFinish() {
    if (graceTimer || settled) return
    graceTimer = setTimeout(() => finish(0), GRACE_MS)
    graceTimer.unref?.()
  }

  function send(res, code, message) {
    res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(message)
  }

  async function handle(req, res) {
    // DNS リバインディング避け。ループバック以外の Host 名では応じない。
    if (!LOOPBACK_HOST.test(String(req.headers.host || ''))) return send(res, 403, 'forbidden')

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      // GET のたびに提出済みの問い id を差し込む。再読込しても提出済み数が戻らない。
      const page = html.split(STATE_SLOT).join(JSON.stringify([...answers.keys()]))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return void res.end(page)
    }
    if (req.method === 'POST' && req.url === '/answer') return void (await postAnswer(req, res))
    return send(res, 404, 'not found')
  }

  async function postAnswer(req, res) {
    let raw
    try {
      raw = await readBody(req)
    } catch (e) {
      if (res.writableEnded) return
      return send(res, e.code === 'TOO_LARGE' ? 413 : 400, String(e.message))
    }
    let payload
    try {
      payload = JSON.parse(raw)
    } catch {
      return send(res, 400, 'JSON として読めません')
    }
    if (!payload || typeof payload !== 'object') return send(res, 400, 'オブジェクトではありません')

    const question = String(payload.question ?? '')
    const keys = allowed.get(question)
    if (!keys) return send(res, 400, `未知の問い: ${question}`)
    const choice = String(payload.choice ?? '')
    if (!keys.has(choice)) return send(res, 400, `未知の選択肢: ${choice}`)

    // round / slug はラウンド文書が正本。クライアントの申告は信じない。
    const rec = {
      round: round.frontmatter.round,
      slug: round.frontmatter.slug,
      question,
      choice,
      note: typeof payload.note === 'string' ? payload.note : '',
      ts: typeof payload.ts === 'string' && payload.ts ? payload.ts : new Date().toISOString(),
    }
    writeChain = writeChain.then(() => appendFile(outPath, `${JSON.stringify(rec)}\n`, 'utf8'))
    await writeChain

    const resubmit = answers.has(question)
    answers.set(question, rec)
    res.writeHead(204).end()

    stderr.write(`提出済み ${answers.size} / ${total}${resubmit ? `（${question} は再提出）` : ''}\n`)
    if (answers.size >= total) scheduleFinish()
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      stderr.write(`serve: 内部エラー ${e.stack || e}\n`)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('internal error')
    })
  })

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectListen)
      server.on('error', (e) => stderr.write(`serve: ${e.message}\n`))
      resolveListen()
    })
  })

  process.on('SIGINT', onSigint)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }

  const bound = server.address().port
  const url = `http://127.0.0.1:${bound}/`
  stderr.write(`serve: ${url} — 全 ${total} 問。回答は ${outPath} に追記します（Ctrl-C で中断）\n`)
  onListening?.(url, bound)
  if (openBrowser && process.platform === 'darwin') {
    try {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
    } catch (e) {
      stderr.write(`serve: ブラウザを開けませんでした（${e.message}）。上の URL を開いてください\n`)
    }
  }

  return await exit
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        const e = new Error('本文が大きすぎます')
        e.code = 'TOO_LARGE'
        req.destroy()
        reject(e)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
