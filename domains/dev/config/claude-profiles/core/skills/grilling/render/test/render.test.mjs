import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseRound } from '../lib/parse.mjs'
import { renderPage, mdInline, mdBlocks, parseAnswer, faviconState, faviconHref, progressPrefix } from '../lib/html.mjs'
import { renderDiagram, textWidth, COLUMN, MIN_SCALE } from '../lib/diagram.mjs'
import { parseArgs } from '../render.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', name), 'utf8')
const round = (name) => parseRound(fixture(name))

const NODE_PAD_X = 18
const BOLD = 1.08

test('ページに全問の id / 選択肢 key / 回答フォームが出る', async () => {
  const r = round('round-example.md')
  const html = await renderPage(r)
  for (const q of r.questions) {
    assert.ok(html.includes(`id="${q.id}"`), `${q.id} の section が無い`)
    assert.ok(html.includes(`name="${q.id}"`), `${q.id} のラジオが無い`)
    assert.ok(html.includes(`name="${q.id}-note"`), `${q.id} の textarea が無い`)
    for (const o of q.options) {
      assert.ok(html.includes(`value="${o.key}"`), `${q.id} の選択肢 ${o.key} が無い`)
    }
  }
  assert.ok(html.includes('value="other"'))
  assert.ok(html.includes('<button type="button"'))
})

test('フォールバック: 回答済みの問いは data-submitted と data-choice が入り、ラジオが選ばれている', async () => {
  const html = await renderPage(round('round-example.md'), { kitDir: null })
  assert.match(html, /<section class="qsec" id="q3" data-submitted="true">/)
  assert.match(html, /<div class="answer" data-submitted="true" data-choice="A">/)
  assert.match(html, /name="q3" value="A" checked/)
  assert.ok(html.includes('リフレッシュは既存の'))
})

test('未回答の問いは data-submitted="false"', async () => {
  const html = await renderPage(round('round-diagram.md'))
  assert.match(html, /<div class="answer" data-submitted="false">/)
  assert.ok(!/<section class="qsec" id="q1" data-submitted="true">/.test(html))
})

test('フォールバック: 推奨の選択肢だけに 推奨 タグが付く', async () => {
  const html = await renderPage(round('round-diagram.md'), { kitDir: null })
  assert.equal((html.match(/<span class="tag">推奨<\/span>/g) || []).length, 1)
})

test('kit モード: 選択肢の比較表に推奨だけ (推奨) が付く', async () => {
  const html = await renderPage(round('round-diagram.md'))
  assert.ok(html.includes('<table class="wu-compare">'))
  assert.equal((html.match(/<strong>\(推奨\)<\/strong>/g) || []).length, 1)
})

test('フォールバック: 前提パネルと進捗行が出る', async () => {
  const html = await renderPage(round('round-diagram.md'), { kitDir: null })
  assert.ok(html.includes('<div class="eyebrow">前提</div>'))
  assert.ok(html.includes('この作業'))
  assert.ok(html.includes('決めると始まること'))
  assert.match(html, /決定済み 1 \/ 回答待ち 1 \/ 未着手 2/)
})

test('kit モード: 前提は wu-terms に、進捗は footer に出る', async () => {
  const html = await renderPage(round('round-diagram.md'))
  assert.ok(html.includes('<h2>前提</h2>'))
  assert.ok(html.includes('<dl class="wu-terms">'))
  assert.ok(html.includes('この作業'))
  assert.ok(html.includes('決めると始まること'))
  assert.match(html, /決定済み 1 \/ 回答待ち 1 \/ 未着手 2/)
  assert.ok(html.includes('<footer class="wu-footer">'))
})

test('kit モード: 前提のリード文の後に段落が残るときは wu-summary に入る', async () => {
  const src = fixture('round-diagram.md').replace(
    'セッションの保存先は httpOnly Cookie に決まっている。残るのは更新（リフレッシュ）を\n**誰が起こすか**で、ここが決まらないと BFF の責務も SDK の API も書き始められない。\n',
    'セッションの保存先は httpOnly Cookie に決まっている。\n\n残る論点は更新（リフレッシュ）を誰が起こすかである。\n',
  )
  const html = await renderPage(parseRound(src))
  assert.ok(html.includes('<div class="wu-summary">'))
  assert.ok(html.includes('残る論点は更新'))
})

test('凡例には実際に使われた辺の種類だけが、sync → async → reply の順で出る', async () => {
  const d = round('round-diagram.md').questions[0].diagrams[0]
  const all = await renderDiagram(d, 'x')
  assert.deepEqual(all.usedKinds, ['sync', 'async', 'reply'])

  const only = { ...d, edges: d.edges.filter((e) => e.kind === 'sync') }
  const one = await renderDiagram(only, 'y')
  assert.deepEqual(one.usedKinds, ['sync'])
  assert.ok(one.svg.includes('同期の呼び出し'))
  assert.ok(!one.svg.includes('非同期・生成'))
  assert.ok(!one.svg.includes('応答・戻り'))

  const none = { ...d, edges: [] }
  const zero = await renderDiagram(none, 'z')
  assert.deepEqual(zero.usedKinds, [])
  assert.ok(!zero.svg.includes('同期の呼び出し'))
})

test('SVG に NaN / undefined 座標が出ない', async () => {
  for (const name of ['round-example.md', 'round-diagram.md']) {
    const html = await renderPage(round(name))
    assert.ok(!/NaN/.test(html), `${name}: NaN が出た`)
    assert.ok(!/="undefined/.test(html), `${name}: undefined 属性が出た`)
    for (const m of html.matchAll(/<svg viewBox="([^"]+)"/g)) {
      for (const v of m[1].split(/\s+/)) assert.ok(Number.isFinite(Number(v)), `viewBox 不正: ${m[1]}`)
    }
  }
})

test('ノードのラベルが箱からはみ出さない', async () => {
  const r = round('round-diagram.md')
  const d = r.questions[0].diagrams[0]
  const out = await renderDiagram(d, 'w')
  for (const n of d.nodes) {
    const box = out.boxes.get(n.id)
    assert.ok(box, `${n.id} の座標が無い`)
    const need = textWidth(n.label, 12) * (n.emphasis ? BOLD : 1) + NODE_PAD_X * 2
    assert.ok(box.width >= need, `${n.id}: 幅 ${box.width} < 必要 ${need}`)
  }
  for (const g of d.groups) {
    const box = out.boxes.get(g.id)
    const need = textWidth(g.label, 12) * BOLD + NODE_PAD_X * 2
    assert.ok(box.width >= need, `group ${g.id}: 幅 ${box.width} < 必要 ${need}`)
  }
})

test('完全な HTML 文書と fragment を出し分けられる', async () => {
  const r = round('round-diagram.md')
  const full = await renderPage(r)
  assert.ok(full.startsWith('<!doctype html>'))
  assert.ok(full.includes('<html lang="ja">'))
  assert.ok(full.includes('fonts.googleapis.com'))

  const frag = await renderPage(r, { fragment: true })
  assert.ok(!/<!doctype/i.test(frag))
  assert.ok(!/<html[\s>]/i.test(frag))
  assert.ok(!/<body[\s>]/i.test(frag))
  assert.ok(frag.startsWith('<title>'))
  assert.ok(frag.includes('<main>'))
})

test('--title と frontmatter.target のどちらかが見出しになる', async () => {
  const r = round('round-diagram.md')
  assert.ok((await renderPage(r)).includes('<h1>トークン更新の経路をどこに置くか</h1>'))
  assert.ok((await renderPage(r, { title: '別の見出し' })).includes('<h1>別の見出し</h1>'))
})

test('ラウンド文書の文字列はすべてエスケープされる', async () => {
  const src = fixture('round-diagram.md')
    .replace('target: トークン更新の経路をどこに置くか', 'target: "<script>alert(1)</script>"')
    .replace('    label: SPA', '    label: <img src=x onerror=alert(1)>')
  const html = await renderPage(parseRound(src))
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('行内マークダウンは code / bold / 安全な link だけを通す', () => {
  assert.equal(mdInline('`a<b>`'), '<code>a&lt;b&gt;</code>')
  assert.equal(mdInline('**強い**'), '<strong>強い</strong>')
  assert.equal(mdInline('[x](https://e.com)'), '<a href="https://e.com" rel="noopener noreferrer">x</a>')
  assert.equal(mdInline('[x](javascript:alert(1))'), '[x](javascript:alert(1))')
  assert.equal(mdInline('<b>raw</b>'), '&lt;b&gt;raw&lt;/b&gt;')
})

test('ブロックマークダウンは段落とリスト', () => {
  assert.equal(mdBlocks(['あ', 'い', '', '- x', '- y']), '<p>あ い</p>\n<ul><li>x</li><li>y</li></ul>')
})

test('ブロックマークダウンの小見出しは深さを問わず h4 になる', () => {
  assert.equal(mdBlocks(['#### 何の話か', '本文', '### 深さ 3 でも', '- x']),
    '<h4>何の話か</h4>\n<p>本文</p>\n<h4>深さ 3 でも</h4>\n<ul><li>x</li></ul>')
})

test('ブロックマークダウンの GFM 表は区切り行を捨てて <table> になる', () => {
  const html = mdBlocks(['| 案 | 部品 |', '|---|---|', '| A | 増える |', '| B | **増えない** |'])
  assert.equal(html,
    '<div class="scroll"><table class="md"><thead><tr><th>案</th><th>部品</th></tr></thead>'
    + '<tbody><tr><td>A</td><td>増える</td></tr><tr><td>B</td><td><strong>増えない</strong></td></tr></tbody></table></div>')
  assert.ok(!mdBlocks(['| <b>x</b> |', '|---|', '| y |']).includes('<b>x</b>'), '生 HTML は通さない')
})

test('answer 行を選択キーと補足に割る', () => {
  const q = { answer: 'A — 15分で', options: [{ key: 'A' }, { key: 'B' }] }
  assert.deepEqual(parseAnswer(q), { choice: 'A', note: '15分で' })
  assert.deepEqual(parseAnswer({ answer: 'B', options: [{ key: 'A' }, { key: 'B' }] }), { choice: 'B', note: '' })
  assert.deepEqual(parseAnswer({ answer: 'どれでもない', options: [{ key: 'A' }] }), { choice: 'other', note: 'どれでもない' })
  assert.deepEqual(parseAnswer({ answer: null, options: [] }), { choice: null, note: '' })
})

test('CLI の引数解析', () => {
  assert.deepEqual(parseArgs(['a.md', '-o', 'b.html', '--title', 'T', '--fragment']),
    { input: 'a.md', out: 'b.html', title: 'T', fragment: true, help: false })
  assert.throws(() => parseArgs(['a.md', '--nope']), /未知のオプション/)
  assert.throws(() => parseArgs(['a.md', 'b.md']), /入力ファイルは 1 つだけ/)
})

test('CLI: 正常系は 0、スキーマ違反は 2、読めなければ 1 を返す', async () => {
  const { mkdtemp, writeFile, readFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { main } = await import('../render.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'grilling-render-'))

  const logs = []
  const errs = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a) => logs.push(a.join(' '))
  console.error = (...a) => errs.push(a.join(' '))
  try {
    const out = join(dir, 'ok.html')
    assert.equal(await main([join(HERE, 'fixtures', 'round-diagram.md'), '-o', out]), 0)
    assert.ok((await readFile(out, 'utf8')).startsWith('<!doctype html>'))

    const broken = join(dir, 'broken.md')
    await writeFile(broken, fixture('round-diagram.md').replace('recommended: A', 'recommended: Z'), 'utf8')
    assert.equal(await main([broken]), 2)
    assert.match(errs.join('\n'), /スキーマ違反 \[question q1\]/)

    assert.equal(await main([join(dir, 'missing.md')]), 1)
  } finally {
    console.log = origLog
    console.error = origErr
  }
})

test('GRILLING_OUT_DIR が既定の出力先になる', async () => {
  const { mkdtemp, access } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { main } = await import('../render.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'grilling-outdir-'))
  const prev = process.env.GRILLING_OUT_DIR
  const origLog = console.log
  console.log = () => {}
  try {
    process.env.GRILLING_OUT_DIR = dir
    assert.equal(await main([join(HERE, 'fixtures', 'round-diagram.md')]), 0)
    await access(join(dir, 'round-diagram.html'))
  } finally {
    console.log = origLog
    if (prev === undefined) delete process.env.GRILLING_OUT_DIR
    else process.env.GRILLING_OUT_DIR = prev
  }
})

// --- 設計ツリーは入れ子リスト -------------------------------------------

test('フォールバック: 設計ツリーは SVG ではなく入れ子リスト (ul) で出る', async () => {
  const html = await renderPage(round('round-example.md'), { kitDir: null })
  assert.ok(html.includes('<ul class="tree">'))
  // 図は問いの中だけ。ツリーの節に figure は使わない
  assert.ok(!/設計ツリー<\/div>\s*<figure/.test(html))
  for (const label of ['セッショントークンの保持方式', '保存先（Cookie / localStorage）', 'リフレッシュトークンの失効伝播']) {
    assert.ok(html.includes(label), `${label} が出ていない`)
  }
})

test('kit モード: 設計ツリーは wu-section の中の入れ子リスト (ol) で出る', async () => {
  const html = await renderPage(round('round-example.md'))
  assert.ok(html.includes('<h2>設計ツリー</h2>'))
  assert.ok(html.includes('<ol class="tree">'))
  assert.ok(!/設計ツリー<\/h2>\s*<figure/.test(html))
  for (const label of ['セッショントークンの保持方式', '保存先（Cookie / localStorage）', 'リフレッシュトークンの失効伝播']) {
    assert.ok(html.includes(label), `${label} が出ていない`)
  }
})

test('ツリーの各節に state チップが付き、decided は decision を添える', async () => {
  const html = await renderPage(round('round-example.md'))
  assert.ok(html.includes('<span class="chip" data-state="decided">決定済み</span>'))
  assert.ok(html.includes('<span class="chip" data-state="asked">回答待ち</span>'))
  assert.ok(html.includes('<span class="chip" data-state="open">未着手</span>'))
  assert.match(html, /<span class="tdec">— httpOnly Cookie に保存する<\/span>/)
  // decision は decided の節にだけ出る
  assert.equal((html.match(/class="tdec"/g) || []).length, 1)
})

test('asks を持つ節はその問いへのリンクになる', async () => {
  const html = await renderPage(round('round-example.md'))
  assert.ok(html.includes('<a class="tlabel" href="#q3">有効期限とリフレッシュ戦略</a>'))
  assert.ok(html.includes('<a class="tlabel" href="#q4">複数タブ間の同期</a>'))
  // asks の無い節はリンクにしない
  assert.ok(html.includes('<span class="tlabel">複数タブ間の同期</span>') === false)
  assert.ok(html.includes('<span class="tlabel">セッショントークンの保持方式</span>'))
})

test('ツリーの下に件数の1行がある', async () => {
  const html = await renderPage(round('round-example.md'))
  assert.match(html, /<p class="note">決定済み 1 \/ 回答待ち 2 \/ 未着手 2。/)
})

test('フォールバック: 入れ子は ul の入れ子で表す', async () => {
  const html = await renderPage(round('round-example.md'), { kitDir: null })
  // root > n2 > n4 の 3 階層ぶん ul が開く
  assert.ok((html.match(/<ul class="tree">/g) || []).length >= 3)
})

test('kit モード: 入れ子は ol の入れ子で表す', async () => {
  const html = await renderPage(round('round-example.md'))
  // root > n2 > n4 の 3 階層ぶん ol が開く
  assert.ok((html.match(/<ol class="tree">/g) || []).length >= 3)
})

// --- 図は列幅に収める ----------------------------------------------------

test('フォールバック: 10 ノード 2 群の図も列幅（720px）に収まる', async () => {
  const html = await renderPage(round('round-diagram.md'), { kitDir: null })
  const widths = [...html.matchAll(/--fig-w:(\d+)px/g)].map((m) => Number(m[1]))
  assert.ok(widths.length >= 3, `図が ${widths.length} 枚しか出ていない`)
  for (const w of widths) assert.ok(w <= COLUMN, `--fig-w:${w}px が列幅 ${COLUMN}px を超えている`)
})

test('列幅を超える図は向きを倒すか縮めて収める', async () => {
  const d = round('round-diagram.md').questions[0].diagrams.find((x) => x.id === 'd2')
  const out = await renderDiagram(d, 'fit')
  assert.equal(out.displayWidth, COLUMN)
  assert.equal(out.scaled, true)
  assert.ok(out.width / COLUMN <= 1 / MIN_SCALE, `縮小率が下限 ${MIN_SCALE} を下回っている`)
})

test('列幅に収まる小さい図は縮小しない', async () => {
  const d = round('round-diagram.md').questions[0].diagrams.find((x) => x.id === 'd3')
  assert.equal(d.nodes.length, 4)
  const out = await renderDiagram(d, 'small')
  assert.equal(out.scaled, false)
  assert.equal(out.displayWidth, out.width)
  assert.ok(out.width <= COLUMN)
})

test('direction を明示した図は向きを変えられない', async () => {
  const d = round('round-diagram.md').questions[0].diagrams.find((x) => x.id === 'd2')
  const pinned = { ...d, direction: 'right', directionPinned: true }
  const out = await renderDiagram(pinned, 'pin')
  assert.equal(out.direction, 'right')
})

// --- 推奨の論証 ----------------------------------------------------------

test('フォールバック: 推奨ボックスは 見出し + rationale の段落で構成される', async () => {
  const r = round('round-diagram.md')
  const html = await renderPage(r, { kitDir: null })
  const q = r.questions[0]
  assert.ok(html.includes(`<h3>${q.recommended} — ${q.prioritized_tradeoff}</h3>`))
  assert.ok(html.includes('水平展開のたびに共有ストアの話が付いてくる'))
  assert.ok(html.includes('条件つき: 同時実行が問題になった時点で B へ移す。'))
  // 選択肢の gains/loses の言い直しは推奨ボックスに入れない
  const recBox = /<div class="rec-box">([\s\S]*?)<\/div>\s*<div class="answer"/.exec(html)
  assert.ok(recBox, 'rec-box が見つからない')
  assert.ok(!recBox[1].includes('得るもの'))
})

test('kit モード: 推奨は wu-decision に、根拠の段落も出る', async () => {
  const r = round('round-diagram.md')
  const html = await renderPage(r)
  const q = r.questions[0]
  assert.ok(html.includes('<div class="wu-decision">'))
  assert.ok(html.includes(`<strong>推奨:</strong> ${q.recommended} —`))
  assert.ok(html.includes(`<strong>重視したトレードオフ:</strong> ${q.prioritized_tradeoff}`))
  assert.ok(html.includes('水平展開のたびに共有ストアの話が付いてくる'))
  assert.ok(html.includes('条件つき: 同時実行が問題になった時点で B へ移す。'))
})

// --- kit モード: 図は kit の renderFigureHtmlChecked に委譲、budget/検証に落ちたら
//     grilling 自前のレンダラー + wu-callout にフォールバックする -----------------

test('kit モード: 検証を通った図は wu-figure data-checks=pass で埋め込まれる', async () => {
  const html = await renderPage(round('round-diagram.md'))
  // d3 は 4 ノードで kit の 20 項目検証をすべて通る
  assert.ok(html.includes('<figure class="wu-figure" data-checks="pass">'))
  assert.ok(html.includes('id="wu-d-q1-d3-title"'))
})

test('kit モード: budget を超える図 (d2, 10 ノード) も幾何検証を通れば kit が描き、data-warn で注意を付ける', async () => {
  const html = await renderPage(round('round-diagram.md'))
  // 予算（ノード 9 など）は目安で、幾何検証を通れば描く。超過は data-warn に残る
  const d2Idx = html.indexOf('<figcaption>契約の型は Rust 側にしか無く')
  assert.ok(d2Idx >= 0, 'd2 の figcaption が出ていない')
  const figureStart = html.lastIndexOf('<figure class="wu-figure" data-checks="pass" data-warn="budget:nodes=10', d2Idx)
  assert.ok(figureStart >= 0, 'd2 が kit の図として data-warn 付きで描かれていない')
  assert.ok(!html.includes('<figure class="scroll"'), '自前レンダラーへ落ちている')
  assert.ok(!html.includes('<div class="wu-callout" data-tone="warn">'), '検証を通った図に warn callout が出ている')
})

test('kit モード: 図が無い問いには <div class="wu-callout" は出ない（CSS 定義とは区別する）', async () => {
  const html = await renderPage(round('round-serve.md'))
  assert.ok(!html.includes('<figure'))
  assert.ok(!html.includes('<div class="wu-callout"'))
})

test('kit モード: 検証用 fixture (round-kit.md) は 2 問・表・#### 小見出し・図をすべて描く', async () => {
  const r = round('round-kit.md')
  assert.equal(r.questions.length, 2)
  const html = await renderPage(r)
  assert.ok(html.includes('<h2>Q1: 図は誰が描きますか</h2>'))
  assert.ok(html.includes('<h2>Q2: ページの chrome（見出し・進捗）はどちらに寄せますか</h2>'))
  assert.ok(html.includes('<table class="wu-table">'), '#### 比較 直後の GFM 表が wu-table になっていない')
  assert.ok(html.includes('<h4>kit がある場合</h4>'))
  assert.ok(html.includes('<h4>比較</h4>'))
  assert.ok(html.includes('<figure class="wu-figure" data-checks="pass">'), 'd1 が kit の検証を通っていない')
  assert.equal((html.match(/<table class="wu-compare">/g) || []).length, 2)
})

// --- kit.mjs: writeup-kit の在り処解決 ------------------------------------

test('kit.mjs: override なしでは grilling のきょうだいの writeup-kit を自動判定する', async () => {
  const { kitDir } = await import('../lib/kit.mjs')
  const dir = kitDir()
  assert.ok(dir, 'このリポジトリでは writeup-kit がきょうだいに実在するはず')
  assert.ok(dir.endsWith('writeup-kit'))
})

test('kit.mjs: override に null を渡すと無いものとして扱う', async () => {
  const { kitDir } = await import('../lib/kit.mjs')
  assert.equal(kitDir(null), null)
})

test('kit.mjs: override に不正なパスを渡すと無いものとして扱う', async () => {
  const { kitDir } = await import('../lib/kit.mjs')
  assert.equal(kitDir('/no/such/writeup-kit'), null)
})

test('kit.mjs: kitCss / loadKitRenderFigureHtmlChecked / loadKitYamlParse が実体を返す', async () => {
  const { kitCss, loadKitRenderFigureHtmlChecked, loadKitYamlParse } = await import('../lib/kit.mjs')
  const css = await kitCss()
  assert.ok(css.includes('--wu-ink'))
  const renderFn = await loadKitRenderFigureHtmlChecked()
  assert.equal(typeof renderFn, 'function')
  const parseFn = await loadKitYamlParse()
  assert.equal(typeof parseFn, 'function')
  assert.deepEqual(parseFn('a: 1\nb: 2'), { a: 1, b: 2 })
})

test('kit.mjs: kit が無いときは全部 null を返す', async () => {
  const { kitCss, loadKitRenderFigureHtmlChecked, loadKitYamlParse } = await import('../lib/kit.mjs')
  assert.equal(await kitCss(null), null)
  assert.equal(await loadKitRenderFigureHtmlChecked(null), null)
  assert.equal(await loadKitYamlParse(null), null)
})

// --- mdBlocks の kit オプション --------------------------------------------

test('mdBlocks: kit:true では表とコードブロックが wu- クラスになる', () => {
  const table = mdBlocks(['| 案 | 部品 |', '|---|---|', '| A | 増える |'], { kit: true })
  assert.ok(table.startsWith('<table class="wu-table">'))
  const code = mdBlocks(['```sql', 'SELECT 1;', '```'], { kit: true })
  assert.equal(code, '<pre class="wu-code" data-lang="sql"><code>SELECT 1;</code></pre>')
})

test('mdBlocks: kit を渡さなければ既定のフォールバック出力のまま', () => {
  const table = mdBlocks(['| 案 | 部品 |', '|---|---|', '| A | 増える |'])
  assert.ok(table.startsWith('<div class="scroll"><table class="md">'))
})

// --- 回答状況のファビコン / タイトル進捗 -----------------------------------

/** html から <link rel="icon" href="..."> の href を 1 つ取り出す。 */
function faviconHrefIn(html) {
  const m = /<link rel="icon" href="([^"]*)">/.exec(html)
  return m ? m[1] : null
}

/** data:image/svg+xml,... を decode して SVG 文字列に戻す。 */
function decodeFavicon(href) {
  assert.ok(href.startsWith('data:image/svg+xml,'), `data URI ではない: ${href}`)
  return decodeURIComponent(href.slice('data:image/svg+xml,'.length))
}

test('faviconState: 0 件は pending、一部は partial、全件は done', () => {
  assert.equal(faviconState(0, 2), 'pending')
  assert.equal(faviconState(1, 2), 'partial')
  assert.equal(faviconState(2, 2), 'done')
})

test('progressPrefix: 全回答なら (done)、それ以外は (n/m)', () => {
  assert.equal(progressPrefix(0, 2), '(0/2)')
  assert.equal(progressPrefix(1, 2), '(1/2)')
  assert.equal(progressPrefix(2, 2), '(done)')
})

test('faviconHref: 3 状態すべてが妥当な SVG の data URI になる（2 色のみ）', () => {
  for (const state of ['pending', 'partial', 'done']) {
    const svg = decodeFavicon(faviconHref(state))
    assert.ok(svg.includes('<svg'), `${state}: <svg が無い`)
    assert.ok(svg.includes('viewBox="0 0 32 32"'), `${state}: viewBox が 32x32 でない`)
    assert.ok(!/[\uD800-\uDFFF]/.test(svg), `${state}: 絵文字（サロゲートペア）が混入している`)
    const colors = new Set([...svg.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase()))
    assert.ok(colors.size <= 2, `${state}: 色数が 2 を超えている (${[...colors]})`)
  }
})

test('未回答 (0/N) のラウンドは pending のファビコンと (0/N) タイトルになる', async () => {
  const r = round('round-serve.md')
  const html = await renderPage(r)
  assert.equal(faviconHrefIn(html), faviconHref('pending'))
  assert.match(html, /<title>\(0\/2\) serve モードのテスト用ラウンド<\/title>/)
})

test('全回答済みのラウンドは done のファビコンと (done) タイトルになる', async () => {
  const r = round('round-example.md')
  assert.equal(r.questions.filter((q) => q.answer).length, r.questions.length, '前提: fixture が全問回答済み')
  const html = await renderPage(r)
  assert.equal(faviconHrefIn(html), faviconHref('done'))
  assert.match(html, /<title>\(done\) spec\/requirements\.md のセッション保持要件<\/title>/)
  const svg = decodeFavicon(faviconHrefIn(html))
  assert.ok(svg.includes('polyline'), 'done はチェックマーク（polyline）を含むはず')
})

test('一部だけ回答済みのラウンドは partial のファビコンと (n/m) タイトルになる', async () => {
  // round-example.md は q3 / q4 の 2 問とも answer: 行を持つ。q4 の answer: を落として 1/2 にする。
  const src = fixture('round-example.md').replace(
    "\nanswer: A — 即時同期。ただし BroadcastChannel 非対応環境は B にフォールバック\n", '\n',
  )
  const r = parseRound(src)
  assert.equal(r.questions.filter((q) => q.answer).length, 1)
  const html = await renderPage(r)
  assert.equal(faviconHrefIn(html), faviconHref('partial'))
  assert.match(html, /<title>\(1\/2\) spec\/requirements\.md のセッション保持要件<\/title>/)
})

test('fragment には favicon もタイトルの進捗接頭辞も出ない（Artifact 側の領分）', async () => {
  const r = round('round-example.md')
  const frag = await renderPage(r, { fragment: true })
  assert.ok(!frag.includes('<link rel="icon"'))
  assert.ok(frag.startsWith(`<title>${r.frontmatter.target}</title>`))
})
