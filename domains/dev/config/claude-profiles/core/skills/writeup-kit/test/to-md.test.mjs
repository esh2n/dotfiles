import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertToMarkdown, findIr } from '../bin/to-md.mjs'
import { parseHtml, findFirst, tagName } from '../bin/lib/html.mjs'
import { escapeIrScript } from '../bin/lib/ir-script.mjs'
import { makeTinyPng } from './helpers/tiny-png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const STORE = join(ROOT, 'test', 'fixtures', 'store')

function convertFixture(relPath, opts = {}) {
  const html = readFileSync(join(STORE, relPath), 'utf8')
  const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-figs-'))
  return { md: convertToMarkdown(html, { slug: 'page', figuresDir, figuresDirRel: 'figs', ...opts }), figuresDir }
}

describe('to-md: decision-record snapshot', () => {
  const { md } = convertFixture('decision/2026-08-01-example-decision.html')

  test('frontmatter carries title/kind/date/updated', () => {
    assert.match(md, /^---\ntitle: "再試行方針の決定"\nkind: "決定記録"\ndate: "2026-08-01"\nupdated: "2026-08-10"\n---/)
  })

  test('h2 sections map to ##', () => {
    assert.match(md, /## 決まったこと/)
    assert.match(md, /## 却下した案/)
    assert.match(md, /## 未決・前提/)
    assert.match(md, /## 次のステップ/)
  })

  test('.wu-summary maps to a > [!NOTE] blockquote', () => {
    assert.match(md, /> \[!NOTE\]\n> 再試行は指数バックオフとし、上限は3回とする。/)
  })

  test('.wu-decision maps to a bulleted, bolded-label list', () => {
    assert.match(md, /- \*\*決定\*\*: 再試行は指数バックオフとし、上限は3回とする。/)
    assert.match(md, /- \*\*根拠\*\*: 過去の障害はいずれも再試行の集中が原因だった。/)
  })

  test('.wu-compare maps to a GFM table', () => {
    assert.match(md, /\| 案 \| 実装コスト \| 運用負荷 \|/)
    assert.match(md, /\| --- \| --- \| --- \|/)
    assert.match(md, /\| 固定間隔で再試行 \| 低 \| 低 \|/)
  })

  test('.wu-open maps to a bullet list of open items', () => {
    assert.match(md, /- デッドレターキューの保持期間は未定。/)
  })

  test('.wu-steps maps to a numbered list', () => {
    assert.match(md, /1\. 再試行ロジックを共通クライアントに実装する。\n2\. 冪等キーをリクエストヘッダーに追加する。\n3\. 障害訓練で上限3回の挙動を確認する。/)
  })

  test('.wu-meta becomes a trailing footnote', () => {
    assert.match(md, /\[\^1\]/)
    assert.match(md, /\[\^1\]: crash-reports\/upload-failures-2026-08\.csv/)
  })
})

describe('to-md: figure (SVG only, no mermaid)', () => {
  const { md, figuresDir } = convertFixture('design/2026-08-05-example-design.html', { slug: 'design-page' })

  test('writes the figure SVG to <figures-dir>/<slug>-<figure-id>.svg', () => {
    const files = readdirSync(figuresDir)
    assert.deepEqual(files, ['design-page-d1.svg'])
    const svg = readFileSync(join(figuresDir, 'design-page-d1.svg'), 'utf8')
    assert.match(svg, /^<svg /)
    assert.match(svg, /<title id="wu-d-1-title">現状の経路<\/title>/)
    // Case-sensitive SVG attributes must round-trip untouched.
    assert.match(svg, /viewBox="0 0 640 260"/)
  })

  test('emits an image reference with the caption and figure path', () => {
    assert.match(md, /!\[クライアントからAPIへ送信し、APIがワーカーへ委譲し、ワーカーが応答を返す。\]\(figs\/design-page-d1\.svg\)/)
  })

  test('never emits a ```mermaid block, even for a node/edge diagram IR', () => {
    assert.doesNotMatch(md, /```mermaid/)
    assert.doesNotMatch(md, /flowchart/)
  })

  test('.wu-terms maps to a bulleted "name — what" list', () => {
    assert.match(md, /- \*\*ワーカー\*\* — 再試行を専門に受け持つバックエンドの処理単位。/)
  })
})

describe('to-md: IRs without groups/nodes', () => {
  /** A page carrying one figure whose IR is `ir` (as a YAML string). */
  function pageWithIr(irYaml) {
    return `<!DOCTYPE html><html lang="ja"><head><title>t</title>
<meta name="description" content="d"><meta name="kind" content="決定記録">
<meta name="date" content="2026-08-29"></head><body><div class="wu-page">
<main><figure class="wu-figure" data-checks="pass"><svg viewBox="0 0 10 10"></svg>
<figcaption>c</figcaption><script type="text/x-writeup-diagram">${escapeIrScript(irYaml)}</script>
</figure></main></div></body></html>`
  }

  test('a diagram IR with no groups still converts (groups/edges are optional)', () => {
    // Regression: `for (const g of ir.groups)` threw TypeError on every
    // diagram written without a `groups:` key — the common case.
    const md = convertToMarkdown(pageWithIr('id: g\nnodes:\n  - id: a\n    label: A\n  - id: b\n    label: B\nedges:\n  - from: a\n    to: b\n    label: L\n'), {
      slug: 'p', figuresDir: mkdtempSync(join(tmpdir(), 'wu-tomd-nogroups-')), figuresDirRel: 'figs',
    })
    assert.match(md, /!\[c\]\(figs\/p-g\.svg\)/)
    assert.doesNotMatch(md, /```mermaid/)
  })

  test('a node-less IR (bar, timeline, …) gets the SVG but no mermaid block', () => {
    const md = convertToMarkdown(pageWithIr('id: q\ntype: bar\ncategories: [a, b, c, d]\n'), {
      slug: 'p', figuresDir: mkdtempSync(join(tmpdir(), 'wu-tomd-nonodes-')), figuresDirRel: 'figs',
    })
    assert.match(md, /!\[c\]\(figs\/p-q\.svg\)/)
    assert.doesNotMatch(md, /```mermaid/)
  })
})

describe('to-md: .wu-shot (screenshot / photo)', () => {
  function pageWithShot(imgHtml, capHtml = '<figcaption>キャプション</figcaption>') {
    return `<!DOCTYPE html><html lang="ja"><head><title>t</title>
<meta name="description" content="d"><meta name="kind" content="設計">
<meta name="date" content="2026-08-29"></head><body><div class="wu-page">
<main><figure class="wu-shot">${imgHtml}${capHtml}</figure></main></div></body></html>`
  }

  test('a page-relative src is copied into figuresDir as <slug>-shot<N>-<basename>; alt becomes the image text, caption follows', () => {
    const pageDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-page-'))
    mkdirSync(join(pageDir, 'shot-assets'), { recursive: true })
    const png = makeTinyPng()
    writeFileSync(join(pageDir, 'shot-assets', 'pic.png'), png)
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-figs-'))
    const html = pageWithShot('<img src="shot-assets/pic.png" alt="実機の画面">')
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figures', pageDir })
    assert.match(md, /!\[実機の画面\]\(figures\/p-shot1-pic\.png\)/)
    assert.match(md, /キャプション/)
    assert.ok(readFileSync(join(figuresDir, 'p-shot1-pic.png')).equals(png))
  })

  test('two .wu-shot figures on the same page get distinct file names, even with the same basename', () => {
    const pageDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-collide-'))
    mkdirSync(join(pageDir, 'a'), { recursive: true })
    mkdirSync(join(pageDir, 'b'), { recursive: true })
    const png = makeTinyPng()
    writeFileSync(join(pageDir, 'a', 'pic.png'), png)
    writeFileSync(join(pageDir, 'b', 'pic.png'), png)
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-collide-figs-'))
    const html = `<!DOCTYPE html><html lang="ja"><head><title>t</title>
<meta name="description" content="d"><meta name="kind" content="設計">
<meta name="date" content="2026-08-29"></head><body><div class="wu-page">
<main>
<figure class="wu-shot"><img src="a/pic.png" alt="a"><figcaption>1枚目</figcaption></figure>
<figure class="wu-shot"><img src="b/pic.png" alt="b"><figcaption>2枚目</figcaption></figure>
</main></div></body></html>`
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figures', pageDir })
    assert.match(md, /!\[a\]\(figures\/p-shot1-pic\.png\)/)
    assert.match(md, /!\[b\]\(figures\/p-shot2-pic\.png\)/)
    assert.ok(readFileSync(join(figuresDir, 'p-shot1-pic.png')).equals(png))
    assert.ok(readFileSync(join(figuresDir, 'p-shot2-pic.png')).equals(png))
  })

  test('a src that escapes the page directory (..) is refused: ![alt](#) placeholder, no file copied', () => {
    const pageDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-escape-'))
    const outsideDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-outside-'))
    writeFileSync(join(outsideDir, 'secret.png'), makeTinyPng())
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-escape-figs-'))
    const rel = relative(pageDir, join(outsideDir, 'secret.png'))
    const html = pageWithShot(`<img src="${rel}" alt="実機の画面">`)
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figures', pageDir })
    assert.match(md, /!\[実機の画面\]\(#\)/)
    assert.equal(readdirSync(figuresDir).length, 0)
  })

  test('an absolute src is refused the same way', () => {
    const pageDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-abs-'))
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-abs-figs-'))
    const html = pageWithShot('<img src="/etc/passwd" alt="実機の画面">')
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figures', pageDir })
    assert.match(md, /!\[実機の画面\]\(#\)/)
    assert.equal(readdirSync(figuresDir).length, 0)
  })

  test('a data: src is decoded and written as <slug>-shot<N>.<ext> (no pageDir needed)', () => {
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-data-'))
    const png = makeTinyPng()
    const html = pageWithShot(`<img src="data:image/png;base64,${png.toString('base64')}" alt="実機の画面">`)
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figures' })
    assert.match(md, /!\[実機の画面\]\(figures\/p-shot1\.png\)/)
    assert.ok(readFileSync(join(figuresDir, 'p-shot1.png')).equals(png))
  })

  test('without a figures dir it degrades to the same ![alt](#) placeholder .wu-figure uses; the caption still follows', () => {
    const html = pageWithShot('<img src="shot-assets/pic.png" alt="実機の画面">')
    const md = convertToMarkdown(html, { slug: 'p' })
    assert.match(md, /!\[実機の画面\]\(#\)/)
    assert.match(md, /キャプション/)
  })

  test('alt falls back to the caption text when the <img> carries no alt', () => {
    const html = pageWithShot('<img src="shot-assets/pic.png">')
    const md = convertToMarkdown(html, { slug: 'p' })
    assert.match(md, /!\[キャプション\]\(#\)/)
  })
})

describe('to-md: diagram IR script escaping contract', () => {
  // A label with a hostile fragment — findIr() must unescape a <script>
  // block written under the ir-script.mjs contract, and must still parse
  // legacy pages that predate it (no &lt;/&amp; in the script text).
  const irText = 'id: d1\ntitle: t\ncaption: c\ngroups: []\nnodes:\n  - id: a\n    label: "<b>bold</b> & c"\nedges: []\n'

  function pageWithFigureScript(scriptBody) {
    return `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2>
        <figure class="wu-figure" data-checks="pass">
          <svg role="img"><title>t</title><desc>d</desc></svg>
          <figcaption>cap</figcaption>
          <script type="text/x-writeup-diagram">\n${scriptBody}\n</script>
        </figure>
      </section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
  }

  test('reads an escaped IR script (current writer contract) and recovers the original label', () => {
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-esc-'))
    const html = pageWithFigureScript(escapeIrScript(irText))
    const md = convertToMarkdown(html, { slug: 'esc', figuresDir, figuresDirRel: 'figs' })
    assert.match(md, /!\[cap\]\(figs\/esc-d1\.svg\)/)
    const fig = findFirst(parseHtml(html), (n) => tagName(n) === 'figure')
    assert.equal(findIr(fig).nodes[0].label, '<b>bold</b> & c', 'label should round-trip to its original, unescaped text')
  })

  test('also reads a legacy unescaped IR script (pre-contract page)', () => {
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-legacy-'))
    const html = pageWithFigureScript(irText)
    const md = convertToMarkdown(html, { slug: 'legacy', figuresDir, figuresDirRel: 'figs' })
    assert.match(md, /!\[cap\]\(figs\/legacy-d1\.svg\)/)
    const fig = findFirst(parseHtml(html), (n) => tagName(n) === 'figure')
    assert.equal(findIr(fig).nodes[0].label, '<b>bold</b> & c')
  })
})

describe('to-md: unmapped elements', () => {
  test('an element outside the §7 mapping becomes an HTML comment placeholder and warns on stderr', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"><h1>t</h1></header>
      <main><nav class="wu-nav-not-mapped"><p>x</p></nav></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const originalWrite = process.stderr.write
    let captured = ''
    process.stderr.write = (chunk) => { captured += chunk; return true }
    let md
    try {
      md = convertToMarkdown(html, { slug: 'unmapped' })
    } finally {
      process.stderr.write = originalWrite
    }
    assert.match(md, /<!-- writeup: unmapped nav\.wu-nav-not-mapped -->/)
    assert.match(captured, /unmapped element <nav\.wu-nav-not-mapped>/)
  })

  test('content nested under an unmapped wrapper is still converted, not dropped', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><nav class="wu-weird"><h2>見出し</h2></nav></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'nested' })
    assert.match(md, /## 見出し/)
  })
})

describe('to-md: inline formatting', () => {
  test('.wu-accent renders as **bold** inline within a paragraph', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p>前 <span class="wu-accent">強調</span> 後</p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'accent' })
    assert.match(md, /前 \*\*強調\*\* 後/)
  })

  test('an inline <a> renders as a Markdown link', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p><a href="https://example.com">link</a></p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'link' })
    assert.match(md, /\[link\]\(https:\/\/example\.com\)/)
  })

  test('an inline <code> becomes a GFM code span, not bare text', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p>色は <code>currentColor</code> を使う。</p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'code' })
    assert.match(md, /色は `currentColor` を使う。/)
  })

  test('an inline <code> with an interior backtick uses a longer fence, unambiguous with no padding needed', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p><code>a\`b</code></p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'code2' })
    assert.match(md, /``a`b``/)
  })

  test('an inline <code> that starts with a backtick gets a padding space (GFM rule)', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p><code>\`x</code></p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'code3' })
    assert.match(md, /`` `x ``/)
  })

  test('a literal < in plain prose (written as &lt; in the source) is escaped as \\<, not left as raw HTML', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p>&lt;img&gt; 内の src を見る。docs/writeup/&lt;slug&gt;/ 以下に置く。</p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'lt' })
    assert.match(md, /\\<img> 内の src を見る。docs\/writeup\/\\<slug>\/ 以下に置く。/)
  })

  test('a paragraph line-wrapped across multiple lines in the HTML source collapses to one line (no leaked raw newline)', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p>1行目の文。
2行目の文。</p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'wrap' })
    assert.match(md, /1行目の文。 2行目の文。/)
  })

  test('a <br> hard break inside a paragraph is still a real line break (not collapsed like source whitespace)', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2><p>1行目<br>2行目</p></section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
    const md = convertToMarkdown(html, { slug: 'br' })
    assert.match(md, /1行目\n2行目/)
  })
})

describe('to-md: blockquotes prefix every line with "> " (.wu-summary / .wu-callout / bare <blockquote>)', () => {
  function pageWithBody(body) {
    return `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <header class="wu-header"></header>
      <main><section class="wu-section"><h2>h</h2>${body}</section></main>
      <footer class="wu-footer"></footer>
    </div></body></html>`
  }

  test('.wu-summary as one <p> with a <br> hard break: every line stays inside the > [!NOTE] alert', () => {
    const md = convertToMarkdown(pageWithBody('<div class="wu-summary"><p>1行目<br>2行目</p></div>'), { slug: 'p' })
    assert.match(md, /> \[!NOTE\]\n> 1行目\n> 2行目/)
    assert.doesNotMatch(md, /^2行目/m)
  })

  test('.wu-summary with 3 separate <p> paragraphs keeps a blank ">" line between them (regression)', () => {
    const md = convertToMarkdown(pageWithBody('<div class="wu-summary"><p>一</p><p>二</p><p>三</p></div>'), { slug: 'p' })
    assert.match(md, /> \[!NOTE\]\n> 一\n>\n> 二\n>\n> 三/)
  })

  test('.wu-callout with a <br> hard break: every line stays inside the alert', () => {
    const md = convertToMarkdown(pageWithBody('<div class="wu-callout" data-tone="warn"><p>1行目<br>2行目</p></div>'), { slug: 'p' })
    assert.match(md, /> \[!WARNING\]\n> 1行目\n> 2行目/)
    assert.doesNotMatch(md, /^2行目/m)
  })

  test('a bare <blockquote> (not .wu-quote) with a <br> hard break: every line stays inside the quote', () => {
    const md = convertToMarkdown(pageWithBody('<blockquote>1行目<br>2行目</blockquote>'), { slug: 'p' })
    assert.match(md, /> 1行目\n> 2行目/)
    assert.doesNotMatch(md, /^2行目/m)
  })

  test('a plain <p> starting with a literal > (written as &gt;) is escaped, not read as a blockquote', () => {
    const md = convertToMarkdown(pageWithBody('<p>&gt;これは引用ではない。</p>'), { slug: 'p' })
    assert.match(md, /^\\>これは引用ではない。$/m)
  })
})

describe('to-md: the generated .wu-sidetoc is chrome, not content', () => {
  const page = '<html><head><title>目次つき</title><meta name="kind" content="設計"></head><body><div class="wu-page"><main>\n' +
    '<nav class="wu-sidetoc" aria-label="目次"><ol><li><a href="#a" title="節 A">節 A</a>\n' +
    '<ol class="wu-sidetoc-sub"><li><a href="#b" title="節 B">節 B</a></li></ol></li></ol></nav>\n' +
    '<section class="wu-section"><h2 id="a">節 A</h2><p>本文。</p><h3 id="b">節 B</h3><p>本文。</p></section>\n' +
    '</main></div></body></html>'

  test('the nav produces no "unmapped" placeholder and no duplicated heading list', () => {
    const md = convertToMarkdown(page, { slug: 'p', figuresDir: mkdtempSync(join(tmpdir(), 'wu-tomd-')), figuresDirRel: 'figs' })
    assert.doesNotMatch(md, /unmapped/)
    assert.doesNotMatch(md, /wu-sidetoc/)
    assert.equal((md.match(/^## 節 A$/gm) || []).length, 1)
    assert.match(md, /### 節 B/)
  })
})

describe('to-md: .wu-diffview becomes a ```diff fence holding the raw diff', () => {
  const RAW = '--- a/internal/order/service.go\n+++ b/internal/order/service.go\n' +
    '@@ -12,3 +12,3 @@ func Place() error {\n \tctx = withTimeout(ctx)\n' +
    '-\treturn errors.New("invalid total")\n+\treturn fmt.Errorf("invalid total: %d", total)\n'
  const page = '<html><head><title>差分</title><meta name="kind" content="設計"></head><body><div class="wu-page"><main>\n' +
    '<section class="wu-section"><h2>変更</h2>\n' +
    '<figure class="wu-diffview" data-mode="unified" data-lang="go">\n' +
    '<table class="wu-dv" data-mode="unified" data-lang="go"><thead><tr><th class="wu-dv-file" colspan="4">internal/order/service.go</th></tr></thead>' +
    '<tbody><tr class="wu-dv-del"><td class="wu-dv-no">13</td><td class="wu-dv-no"></td><td class="wu-dv-mark">−</td>' +
    '<td class="wu-dv-code">return errors.New(<mark class="wu-dv-w">"invalid total"</mark>)</td></tr></tbody></table>\n' +
    '<figcaption>ラップ済みエラーに変えた。</figcaption>\n' +
    '<script type="text/x-writeup-diff">\n' + escapeIrScript(RAW.replace(/\n$/, '')) + '\n</script>\n</figure>\n' +
    '</section>\n</main></div></body></html>'

  const md = convertToMarkdown(page, { slug: 'p', figuresDir: mkdtempSync(join(tmpdir(), 'wu-tomd-dv-')), figuresDirRel: 'figs' })

  test('the fence carries the raw unified diff, unescaped, not the rendered table', () => {
    assert.match(md, /```diff\n/)
    assert.ok(md.includes('--- a/internal/order/service.go'), md)
    assert.ok(md.includes('+\treturn fmt.Errorf("invalid total: %d", total)'), md)
    assert.ok(md.includes('```diff\n' + RAW.replace(/\n$/, '') + '\n```'), md)
  })

  test('the rendered tables, line numbers and word marks do not leak into the Markdown', () => {
    assert.doesNotMatch(md, /wu-dv/)
    assert.doesNotMatch(md, /unmapped/)
    assert.doesNotMatch(md, /\| 13 \|/)
  })

  test('the figcaption survives as a line after the fence', () => {
    assert.match(md, /```\n\nラップ済みエラーに変えた。/)
  })
})

describe('to-md: sanitizes an untrusted diagram IR id before using it in a file name', () => {
  function pageWithIrId(id) {
    return `<!DOCTYPE html><html lang="ja"><head><title>t</title></head><body><div class="wu-page">
<main><figure class="wu-figure" data-checks="pass"><svg viewBox="0 0 10 10"></svg>
<figcaption>c</figcaption><script type="text/x-writeup-diagram">id: ${id}\n</script>
</figure></main></div></body></html>`
  }

  test('an id containing ../ and / is flattened, never escaping figuresDir', () => {
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-figid-'))
    const md = convertToMarkdown(pageWithIrId('../../etc/passwd'), { slug: 'p', figuresDir, figuresDirRel: 'figs' })
    const files = readdirSync(figuresDir)
    assert.deepEqual(files, ['p-etc-passwd.svg'])
    assert.match(md, /!\[c\]\(figs\/p-etc-passwd\.svg\)/)
  })

  test('an id that sanitizes to nothing falls back to fig<N>', () => {
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-figid-empty-'))
    const md = convertToMarkdown(pageWithIrId('../..'), { slug: 'p', figuresDir, figuresDirRel: 'figs' })
    assert.deepEqual(readdirSync(figuresDir), ['p-fig1.svg'])
    assert.match(md, /!\[c\]\(figs\/p-fig1\.svg\)/)
  })
})

describe('to-md: sanitizes a copied .wu-shot file name (the copy is ours to name)', () => {
  test('a src basename with a space and parens is sanitized, extension preserved, bytes untouched', () => {
    const pageDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-unsafe-name-'))
    mkdirSync(join(pageDir, 'assets'), { recursive: true })
    const png = makeTinyPng()
    writeFileSync(join(pageDir, 'assets', 'pic (1).png'), png)
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-unsafe-figs-'))
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <main><figure class="wu-shot"><img src="assets/pic (1).png" alt="a"></figure></main></div></body></html>`
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figures', pageDir })
    const files = readdirSync(figuresDir)
    assert.equal(files.length, 1)
    assert.ok(!files[0].includes(' '), files[0])
    assert.ok(!files[0].includes('('), files[0])
    assert.ok(!files[0].includes(')'), files[0])
    assert.match(files[0], /\.png$/)
    assert.ok(md.includes(`figures/${files[0]}`))
    assert.ok(readFileSync(join(figuresDir, files[0])).equals(png))
  })
})

describe('to-md: alt/caption text is escaped for the ![alt](path) position', () => {
  test('.wu-shot alt containing ], [, (, ) and a backslash is escaped', () => {
    const png = makeTinyPng()
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <main><figure class="wu-shot"><img src="data:image/png;base64,${png.toString('base64')}" alt="a] b[ c( d) e\\f"></figure></main></div></body></html>`
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-shot-alt-'))
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figs' })
    assert.ok(md.includes('![a\\] b\\[ c\\( d\\) e\\\\f](figs/p-shot1.png)'), md)
  })

  test('.wu-figure caption containing ] and ) is escaped', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <main><figure class="wu-figure" data-checks="pass"><svg viewBox="0 0 10 10"></svg>
      <figcaption>a] b) c</figcaption></figure></main></div></body></html>`
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-figcap-'))
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figs' })
    assert.ok(md.includes('![a\\] b\\) c](figs/p-fig1.svg)'), md)
  })

  test('.wu-figure caption with a <br> hard break is flattened to one line for the image syntax', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <main><figure class="wu-figure" data-checks="pass"><svg viewBox="0 0 10 10"></svg>
      <figcaption>a<br>b]</figcaption></figure></main></div></body></html>`
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-figcap-nl-'))
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figs' })
    assert.ok(md.includes('![a b\\]](figs/p-fig1.svg)'), md)
  })
})

describe('to-md: convertToMarkdown(html, { manifest }) records which files it wrote and as what kind', () => {
  test('a passed-in manifest array is pushed a { file, kind } entry per figure/shot file written', () => {
    const pageDir = mkdtempSync(join(tmpdir(), 'wu-tomd-manifest-page-'))
    writeFileSync(join(pageDir, 'shot.png'), makeTinyPng())
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <main>
      <figure class="wu-figure" data-checks="pass"><svg viewBox="0 0 10 10"></svg><figcaption>c</figcaption></figure>
      <figure class="wu-shot"><img src="shot.png" alt="a"></figure>
      </main></div></body></html>`
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-manifest-figs-'))
    const manifest = []
    convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figs', pageDir, manifest })
    assert.deepEqual(manifest, [
      { file: 'p-fig1.svg', kind: 'figure' },
      { file: 'p-shot2-shot.png', kind: 'shot' },
    ])
    for (const { file } of manifest) assert.ok(existsSync(join(figuresDir, file)))
  })

  test('without a manifest option, conversion still works exactly as before (no crash on the omitted array)', () => {
    const html = `<!DOCTYPE html><html><head><title>t</title></head><body><div class="wu-page">
      <main><figure class="wu-figure" data-checks="pass"><svg viewBox="0 0 10 10"></svg><figcaption>c</figcaption></figure></main></div></body></html>`
    const figuresDir = mkdtempSync(join(tmpdir(), 'wu-tomd-nomanifest-'))
    const md = convertToMarkdown(html, { slug: 'p', figuresDir, figuresDirRel: 'figs' })
    assert.match(md, /!\[c\]\(figs\/p-fig1\.svg\)/)
  })
})
