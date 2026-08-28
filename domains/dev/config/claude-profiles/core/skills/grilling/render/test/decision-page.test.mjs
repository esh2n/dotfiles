import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseDecisionRecord, buildDecisionPage, parseArgs, main } from '../decision-page.mjs'
import { kitDir } from '../lib/kit.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')

test('parseDecisionRecord: H1 とリード文、7 節すべてを拾う', () => {
  const p = parseDecisionRecord(fixture('decisions-example.md'))
  assert.equal(p.title, 'サンプル決定記録の対象')
  assert.ok(p.lede.includes('リード文になる'))
  assert.equal(p.decided.length, 3)
  assert.deepEqual(p.decided[0], { group: '構成', decision: '名前は writeup', tradeoff: '覚えやすさより既存名と衝突しないこと' })
  assert.equal(p.decided[2].group, '運用')
  assert.equal(p.decided[2].tradeoff, null)
  assert.equal(p.rejected.length, 2)
  assert.deepEqual(p.rejected[0], { label: 'Markdown を正本にする', detail: '変換器が可用性を下げるため' })
  assert.equal(p.open.length, 2)
  assert.deepEqual(p.approach, ['**M0 契約** — 契約文書を書く', '**M1 kit** — kit を書き直す'])
  assert.equal(p.sources.length, 2)
  assert.deepEqual(p.nextSteps, ['この決定記録を最初の page にする', '契約文書のレビュー'])
  assert.equal(p.originRound, '`.claude/.cache/grilling/sample/transcript.md`')
})

test('parseDecisionRecord: H1 も前置き段落も無い最小形式（SKILL.md §12 どおり）でも読める', () => {
  const minimal = `## 決定記録
### 決まったこと
- A にする — 重視したトレードオフ: 単純さ
### 検討して却下した案
### 未決・前提
### 推奨アプローチ
### 出典
### 次のステップ
### 元ラウンド
`
  const p = parseDecisionRecord(minimal)
  assert.equal(p.title, '決定記録')
  assert.equal(p.lede, '')
  assert.equal(p.decided.length, 1)
  assert.equal(p.decided[0].tradeoff, '単純さ')
})

test('parseDecisionRecord: "## 決定記録" が無ければ投げる', () => {
  assert.throws(() => parseDecisionRecord('# タイトルだけ\n\n本文。\n'), /決定記録/)
})

test('buildDecisionPage: writeup-kit の chrome とコンポーネントに乗る', async () => {
  const p = parseDecisionRecord(fixture('decisions-example.md'))
  const html = await buildDecisionPage(p, { date: '2026-08-28' })

  assert.ok(html.startsWith('<!doctype html>'))
  assert.ok(html.includes('<meta name="kind" content="決定記録">'))
  assert.ok(html.includes('<meta name="date" content="2026-08-28">'))
  assert.ok(html.includes('<header class="wu-header">'))
  assert.ok(html.includes('<footer class="wu-footer">'))

  assert.ok(html.includes('<h2>決まったこと</h2>'))
  assert.equal((html.match(/<div class="wu-decision">/g) || []).length, 3)
  assert.ok(html.includes('<strong>重視したトレードオフ:</strong> 覚えやすさより既存名と衝突しないこと'))

  assert.ok(html.includes('<h2>検討して却下した案</h2>'))
  assert.ok(html.includes('<h2>未決・前提</h2>'))
  assert.ok(html.includes('<div class="wu-open">'))
  assert.ok(html.includes('<h2>推奨アプローチ</h2>'))
  assert.ok(html.includes('<h2>次のステップ</h2>'))
  assert.equal((html.match(/<ol class="wu-steps">/g) || []).length, 2)

  assert.ok(html.includes('<h2>出典</h2>'))
  // 裸の URL がリンクになる
  assert.match(html, /<a href="https:\/\/example\.com\/writeup-design" rel="noopener noreferrer">/)
  assert.ok(html.includes('元ラウンド: <code>.claude/.cache/grilling/sample/transcript.md</code>'))

  // ヘッダ／フッタの chrome には markdown 由来の要素を作らない（self-check の
  // chrome チェックは kit/template.html と構造を厳密比較するため）
  const header = /<header class="wu-header">([\s\S]*?)<\/header>/.exec(html)[1]
  assert.ok(!/<(strong|code|a|em)[ >]/.test(header), 'header に markdown 要素が混ざっている')
})

test('buildDecisionPage: writeup-kit が無ければ投げる', async () => {
  const p = parseDecisionRecord(fixture('decisions-example.md'))
  await assert.rejects(() => buildDecisionPage(p, { kitDir: null }), /writeup-kit が見つかりません/)
})

test('writeup-kit の self-check が chrome / required-meta / role-structure / kind-sections で怒らない', async (t) => {
  const kd = kitDir()
  if (!kd) { t.skip('writeup-kit が無い環境'); return }
  const p = parseDecisionRecord(fixture('decisions-example.md'))
  const html = await buildDecisionPage(p, { date: '2026-08-28' })
  const dir = mkdtempSync(join(tmpdir(), 'grilling-decision-page-'))
  const outPath = join(dir, 'page.html')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(outPath, html, 'utf8')

  const { runSelfCheck } = await import(pathToFileURL(join(kd, 'bin', 'self-check.mjs')).href)
  const result = runSelfCheck(outPath)
  assert.equal(result.unreadable, false)
  const badKinds = new Set(['chrome', 'required-meta', 'role-structure', 'kind-sections', 'single-file', 'markdown-convertibility'])
  const structuralErrors = result.items.filter((i) => badKinds.has(i.item))
  assert.deepEqual(structuralErrors, [], `構造まわりの指摘が出た: ${JSON.stringify(structuralErrors)}`)
})

test('parseArgs: --out 必須、余分な入力は拒否', () => {
  assert.deepEqual(parseArgs(['d.md', '--out', 'p.html']), { input: 'd.md', out: 'p.html', help: false })
  assert.throws(() => parseArgs(['d.md', '--zzz']), /未知のオプション/)
  assert.throws(() => parseArgs(['a.md', 'b.md']), /入力ファイルは 1 つだけ/)
})

test('CLI: 決定記録を書き出し、self-check を実行して 0 を返す', async (t) => {
  const kd = kitDir()
  if (!kd) { t.skip('writeup-kit が無い環境'); return }
  const dir = mkdtempSync(join(tmpdir(), 'grilling-decision-cli-'))
  const outPath = join(dir, 'out.html')
  const logs = []
  const errs = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a) => logs.push(a.join(' '))
  console.error = (...a) => errs.push(a.join(' '))
  try {
    const code = await main([join(HERE, 'fixtures', 'decisions-example.md'), '--out', outPath])
    assert.equal(code, 0)
    assert.ok(logs.some((l) => l === outPath))
    assert.ok(readFileSync(outPath, 'utf8').startsWith('<!doctype html>'))
    // self-check の結果が標準出力に出ている（no findings か行のどちらか）
    assert.ok(logs.length >= 2, 'self-check の結果が出ていない')
  } finally {
    console.log = origLog
    console.error = origErr
  }
})
