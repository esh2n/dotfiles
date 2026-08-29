import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseUnifiedDiff,
  renderDiffView,
  renderUnifiedDiff,
  renderCodeCell,
  wordDiffRanges,
  inferLang,
  ensureDiffViews,
  diffFigureText,
  MINUS,
} from '../bin/lib/diffview.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => readFileSync(join(HERE, 'fixtures', `${name}.patch`), 'utf8')

/** The visible text of a rendered cell/table: tags stripped, entities decoded. */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[m]))
}

const rowsOf = (html) => [...html.matchAll(/<tr class="([^"]*)">([\s\S]*?)<\/tr>/g)]

describe('parseUnifiedDiff(): file records', () => {
  test('multi-file diff yields one record per file, with paths and counts', () => {
    const files = parseUnifiedDiff(fixture('diff-multi'))
    assert.equal(files.length, 2)
    assert.equal(files[0].oldPath, 'pkg/http/router.go')
    assert.equal(files[0].newPath, 'internal/transport/router.go')
    assert.deepEqual([files[0].added, files[0].removed], [1, 1])
    assert.equal(files[1].oldPath, 'scripts/legacy_seed.sh')
    assert.equal(files[1].newPath, null) // +++ /dev/null
    assert.deepEqual([files[1].added, files[1].removed], [0, 5])
  })

  test('a rename is flagged and keeps both paths', () => {
    const [renamed] = parseUnifiedDiff(fixture('diff-multi'))
    assert.equal(renamed.renamed, true)
    assert.notEqual(renamed.oldPath, renamed.newPath)
  })

  test('a deletion-only file has no add rows', () => {
    const files = parseUnifiedDiff(fixture('diff-multi'))
    const kinds = new Set(files[1].hunks[0].rows.map((r) => r.kind))
    assert.deepEqual([...kinds], ['del'])
    assert.equal(files[1].hunks[0].newLines, 0)
  })

  test('"\\ No newline at end of file" marks the preceding row, not a row of its own', () => {
    const files = parseUnifiedDiff(fixture('diff-multi'))
    const rows = files[1].hunks[0].rows
    assert.equal(rows.length, 5)
    assert.equal(rows.at(-1).noNewline, true)
    assert.equal(rows[0].noNewline, undefined)
  })

  test('a hunk with only additions numbers the new side and leaves oldNo null', () => {
    const files = parseUnifiedDiff('--- /dev/null\n+++ b/x.go\n@@ -0,0 +1,3 @@\n+package x\n+\n+const N = 1\n')
    const rows = files[0].hunks[0].rows
    assert.deepEqual(rows.map((r) => r.kind), ['add', 'add', 'add'])
    assert.deepEqual(rows.map((r) => r.newNo), [1, 2, 3])
    assert.deepEqual(rows.map((r) => r.oldNo), [null, null, null])
    assert.equal(files[0].oldPath, null)
  })

  test('a bare hunk with no ---/+++ pair gives an unnamed file', () => {
    const files = parseUnifiedDiff(fixture('diff-longlines'))
    assert.equal(files.length, 1)
    assert.equal(files[0].oldPath, null)
    assert.equal(files[0].newPath, null)
    assert.equal(files[0].hunks.length, 1)
  })

  test('a hunk header without counts means one line on each side', () => {
    const [f] = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -7 +7 @@\n-a\n+b\n')
    assert.deepEqual([f.hunks[0].oldLines, f.hunks[0].newLines], [1, 1])
    assert.equal(f.hunks[0].rows[0].oldNo, 7)
  })

  test('binary files are recorded, not parsed', () => {
    const [f] = parseUnifiedDiff('diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n')
    assert.equal(f.binary, true)
    assert.equal(f.hunks.length, 0)
  })

  test('format-patch preamble, index and mode lines are tolerated', () => {
    const text = [
      'From 0e1f2a3 Mon Sep 17 00:00:00 2001', 'Subject: [PATCH] tighten the guard', '',
      'A prose paragraph about the change; it must not confuse the parser.', '',
      'diff --git a/x.go b/x.go', 'old mode 100644', 'new mode 100755', 'index aaa..bbb 100755',
      '--- a/x.go', '+++ b/x.go', '@@ -1,2 +1,2 @@', '-a', '+b', ' c', '--', '2.44.0', '',
    ].join('\n')
    const files = parseUnifiedDiff(text)
    assert.equal(files.length, 1)
    assert.equal(files[0].newPath, 'x.go')
    assert.equal(files[0].hunks[0].rows.length, 3)
  })

  test('the hunk heading after the second @@ is captured', () => {
    const [f] = parseUnifiedDiff(fixture('diff-simple'))
    assert.equal(f.hunks[0].heading, 'func (s *Service) Place(ctx context.Context, o Order) error {')
    assert.equal(f.hunks[1].heading, 'func (s *Service) Cancel(ctx context.Context, id string) error {')
  })
})

describe('parseUnifiedDiff(): malformed input', () => {
  test('empty input throws', () => {
    assert.throws(() => parseUnifiedDiff('   \n\n'), /diff: empty input/)
  })

  test('a diff with no hunk throws and quotes the first line', () => {
    assert.throws(() => parseUnifiedDiff('--- a/x\n+++ b/x\n'), /no hunks found[\s\S]*"--- a\/x"/)
  })

  test('a malformed hunk header throws, naming the line number and the line', () => {
    const text = '--- a/x\n+++ b/x\n@@ -bogus +1 @@\n a\n'
    assert.throws(() => parseUnifiedDiff(text), (err) => {
      assert.match(err.message, /malformed hunk header at line 3/)
      assert.match(err.message, /"@@ -bogus \+1 @@"/)
      return true
    })
  })

  test('an unrecognized prefix inside a hunk throws, naming that line', () => {
    const text = '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n a\n?wat\n'
    assert.throws(() => parseUnifiedDiff(text), (err) => {
      assert.match(err.message, /unrecognized line prefix "\?" inside a hunk at line 5/)
      return true
    })
  })

  test('a hunk that ends before its counts are satisfied throws', () => {
    assert.throws(
      () => parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n a\n'),
      /hunk ends early \(3 old \/ 3 new lines missing\) at line 3/,
    )
  })
})

describe('line numbering', () => {
  test('every row of diff-simple carries the numbers git would print', () => {
    const [f] = parseUnifiedDiff(fixture('diff-simple'))
    assert.deepEqual(
      f.hunks[0].rows.map((r) => [r.kind, r.oldNo, r.newNo]),
      [
        ['ctx', 12, 12], ['ctx', 13, 13],
        ['del', 14, null],
        ['add', null, 14],
        ['ctx', 15, 15],
        ['add', null, 16], ['add', null, 17], ['add', null, 18],
        ['ctx', 16, 19], ['ctx', 17, 20], ['ctx', 18, 21],
      ],
    )
    assert.deepEqual(
      f.hunks[1].rows.map((r) => [r.kind, r.oldNo, r.newNo]),
      [
        ['ctx', 40, 43], ['ctx', 41, 44], ['ctx', 42, 45], ['ctx', 43, 46],
        ['del', 44, null], ['del', 45, null],
        ['add', null, 47], ['add', null, 48], ['add', null, 49],
        ['ctx', 46, 50],
      ],
    )
  })

  test('added/removed counts match the +/- row totals', () => {
    const [f] = parseUnifiedDiff(fixture('diff-simple'))
    const all = f.hunks.flatMap((h) => h.rows)
    assert.equal(f.added, all.filter((r) => r.kind === 'add').length)
    assert.equal(f.removed, all.filter((r) => r.kind === 'del').length)
    assert.deepEqual([f.added, f.removed], [7, 3])
  })
})

describe('renderDiffView(): unified mode', () => {
  const html = renderUnifiedDiff(fixture('diff-simple'))

  test('one table per file, with the path, the counts and a U+2212 minus', () => {
    assert.equal([...html.matchAll(/<table class="wu-dv"/g)].length, 1)
    assert.match(html, /data-mode="unified"/)
    assert.match(html, /<span class="wu-dv-path">internal\/order\/service\.go<\/span>/)
    assert.match(html, new RegExp(`<span class="wu-dv-stat">\\+7 ${MINUS}3</span>`))
    assert.equal(MINUS, '−')
    assert.ok(!/<span class="wu-dv-stat">\+7 -3<\/span>/.test(html), 'stat must not use a hyphen')
  })

  test('hunk header rows carry the @@ counts and the heading', () => {
    const hunks = [...html.matchAll(/<tr class="wu-dv-hunk">([\s\S]*?)<\/tr>/g)].map((m) => textOf(m[1]))
    assert.equal(hunks.length, 2)
    assert.match(hunks[0], /^@@ -12,7 \+12,10 @@ func \(s \*Service\) Place\(/)
    assert.match(hunks[1], /^@@ -40,7 \+43,8 @@/)
  })

  test('every line row has four cells: old no, new no, marker, code', () => {
    for (const [, cls, inner] of rowsOf(html)) {
      if (!cls.includes('wu-dv-line')) continue
      const cells = [...inner.matchAll(/<td class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)]
      assert.equal(cells.length, 4, inner)
      assert.match(cells[0][1], /wu-dv-no/)
      assert.match(cells[1][1], /wu-dv-no/)
      assert.match(cells[2][1], /wu-dv-mark/)
      assert.match(cells[3][1], /wu-dv-code/)
    }
  })

  test('the marker column is + for adds, U+2212 for deletions, empty for context', () => {
    const marks = rowsOf(html)
      .filter(([, cls]) => cls.includes('wu-dv-line'))
      .map(([, cls, inner]) => [cls.split(' ').at(-1), textOf(/<td class="wu-dv-mark"[^>]*>([\s\S]*?)<\/td>/.exec(inner)[1])])
    assert.ok(marks.some(([c, m]) => c === 'wu-dv-add' && m === '+'))
    assert.ok(marks.some(([c, m]) => c === 'wu-dv-del' && m === MINUS))
    assert.ok(marks.filter(([c]) => c === 'wu-dv-ctx').every(([, m]) => m === ''))
  })

  test('a deleted row shows only the old number and an added row only the new one', () => {
    const del = rowsOf(html).find(([, cls]) => cls.includes('wu-dv-del'))
    const cells = [...del[2].matchAll(/<td class="wu-dv-no">([^<]*)<\/td>/g)].map((m) => m[1])
    assert.deepEqual(cells, ['14', ''])
    const add = rowsOf(html).find(([, cls]) => cls.includes('wu-dv-add'))
    const acells = [...add[2].matchAll(/<td class="wu-dv-no">([^<]*)<\/td>/g)].map((m) => m[1])
    assert.deepEqual(acells, ['', '14'])
  })

  test('no chromatic class or inline color reaches the markup', () => {
    assert.ok(!/style=/.test(html))
    assert.ok(!/(green|red|#[0-9a-fA-F]{3,6})/.test(html))
  })
})

describe('renderDiffView(): split mode', () => {
  const html = renderDiffView(parseUnifiedDiff(fixture('diff-simple')), { mode: 'split' })

  test('rows carry old no / old code / new no / new code and no marker column', () => {
    assert.match(html, /data-mode="split"/)
    assert.ok(!/wu-dv-mark/.test(html))
    const line = rowsOf(html).find(([, cls]) => cls.includes('wu-dv-line'))
    const cells = [...line[2].matchAll(/<td class="([^"]*)"[^>]*>/g)].map((m) => m[1])
    assert.equal(cells.length, 4)
    assert.deepEqual(cells.map((c) => c.split(' ')[0]), ['wu-dv-no', 'wu-dv-code', 'wu-dv-no', 'wu-dv-code'])
  })

  test('a changed del/add pair shares one row', () => {
    const pair = rowsOf(html).find(([, cls]) => cls.includes('wu-dv-chg'))
    assert.match(pair[2], /wu-dv-no wu-dv-del/)
    assert.match(pair[2], /wu-dv-no wu-dv-add/)
    assert.equal(textOf(pair[2]).includes('StatusCancelled') || textOf(pair[2]).includes('errors.New'), true)
  })

  test('a lone add leaves the old side blank', () => {
    const rows = rowsOf(html).filter(([, cls]) => cls.includes('wu-dv-chg'))
    const lone = rows.find(([, , inner]) => /wu-dv-no wu-dv-blank/.test(inner))
    assert.ok(lone, 'expected at least one row with a blank old side')
    assert.match(lone[2], /<td class="wu-dv-no wu-dv-blank"><\/td><td class="wu-dv-code wu-dv-blank"><\/td>/)
    assert.match(lone[2], /wu-dv-code wu-dv-add/)
  })

  test('split and unified show the same set of source lines', () => {
    const unified = renderUnifiedDiff(fixture('diff-simple'))
    const codes = (h) => [...new Set(
      [...h.matchAll(/<td class="wu-dv-code[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1])).filter(Boolean),
    )].sort()
    assert.deepEqual(codes(html), codes(unified))
  })
})

describe('word diff', () => {
  test('a one-word edit marks the changed token on both sides', () => {
    const r = wordDiffRanges('\to.Status = StatusCancelled', '\to.Status = StatusCanceled')
    assert.ok(r)
    assert.equal('\to.Status = StatusCancelled'.slice(r.del.start, r.del.end), 'StatusCancelled')
    assert.equal('\to.Status = StatusCanceled'.slice(r.add.start, r.add.end), 'StatusCanceled')
  })

  test('an argument rename marks only the argument', () => {
    const a = '\ttotal := computeTotal(o.Items)'
    const b = '\ttotal := computeTotal(o.Lines)'
    const r = wordDiffRanges(a, b)
    assert.equal(a.slice(r.del.start, r.del.end), 'Items')
    assert.equal(b.slice(r.add.start, r.add.end), 'Lines')
  })

  test('a pure insertion leaves the deleted side unmarked', () => {
    const [f] = parseUnifiedDiff(fixture('diff-longlines'))
    const [del, add] = f.hunks[0].rows.filter((r) => r.kind !== 'ctx')
    const r = wordDiffRanges(del.text, add.text)
    assert.equal(r.del.end - r.del.start, 0)
    assert.equal(add.text.slice(r.add.start, r.add.end).trim(), "where o.status <> 'canceled'")
  })

  test('a rewritten line is not word-diffed (change is more than half the line)', () => {
    assert.equal(wordDiffRanges('\t\treturn err', '\t\treturn fmt.Errorf("find order %s: %w", id, err)'), null)
    assert.equal(wordDiffRanges('\t\treturn errors.New("invalid total")', '\t\treturn fmt.Errorf("invalid total: %d", o.Total)'), null)
  })

  test('identical, empty and one-sided lines produce no marks', () => {
    assert.equal(wordDiffRanges('same', 'same'), null)
    assert.equal(wordDiffRanges('', 'x'), null)
    assert.equal(wordDiffRanges('x', ''), null)
  })

  test('the rendered table marks the paired edit and nothing else', () => {
    const html = renderUnifiedDiff(fixture('diff-simple'))
    const marks = [...html.matchAll(/<mark class="wu-dv-w">([\s\S]*?)<\/mark>/g)].map((m) => textOf(m[1]))
    assert.deepEqual(marks, ['StatusCancelled', 'Items', 'StatusCanceled', 'Lines'])
  })
})

describe('highlight interaction', () => {
  test('a keyword span outside the mark survives intact', () => {
    const html = renderCodeCell('\treturn ErrNotFound', 'go', wordDiffRanges('\treturn ErrNotFound', '\treturn ErrNotfound').del)
    assert.match(html, /<span class="wu-tok-kw">return<\/span>/)
    assert.match(html, /<mark class="wu-dv-w"><span class="wu-tok-type">ErrNotFound<\/span><\/mark>/)
  })

  test('a Go keyword span survives inside a changed line of the fixture', () => {
    const html = renderUnifiedDiff(fixture('diff-simple'))
    const del = rowsOf(html).find(([, c]) => c.includes('wu-dv-del'))
    assert.match(del[2], /<span class="wu-tok-kw">return<\/span>/)
    const changed = rowsOf(html).find(([, , i]) => /wu-dv-w/.test(i))
    assert.match(changed[2], /wu-tok-/, 'a marked row still carries token spans')
  })

  test('a mark landing inside a token splits the token into same-class spans, never an unbalanced one', () => {
    const a = '\tx := "hello world"'
    const b = '\tx := "hello there"'
    const html = renderCodeCell(a, 'go', wordDiffRanges(a, b).del)
    assert.equal([...html.matchAll(/<span class="wu-tok-str">/g)].length, 3)
    assert.match(html, /<span class="wu-tok-str">"hello <\/span><mark class="wu-dv-w"><span class="wu-tok-str">world<\/span><\/mark><span class="wu-tok-str">"<\/span>/)
    assert.equal([...html.matchAll(/<span/g)].length, [...html.matchAll(/<\/span>/g)].length)
    assert.equal([...html.matchAll(/<mark/g)].length, [...html.matchAll(/<\/mark>/g)].length)
  })

  test('the code cell reproduces its source text exactly, marked or not', () => {
    const raw = '\tif a < b && c > d { return "x&y" } // note'
    const plain = renderCodeCell(raw, 'go', null)
    const marked = renderCodeCell(raw, 'go', { start: 4, end: 9 })
    assert.equal(textOf(plain), raw)
    assert.equal(textOf(marked), raw)
  })

  test('an unknown language degrades to escaped plain text', () => {
    const html = renderCodeCell('a <b> c', 'brainfuck', null)
    assert.equal(html, 'a &lt;b&gt; c')
  })
})

describe('escaping and determinism', () => {
  test('a <script> in the diff text stays inert', () => {
    const html = renderDiffView(parseUnifiedDiff(fixture('diff-longlines')), { lang: 'sql' })
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
    assert.ok(!/<script/i.test(html))
    assert.ok(!/<\/script/i.test(html))
  })

  test('renderDiffView emits no raw < from the diff content', () => {
    const nasty = '--- a/x.html\n+++ b/x.html\n@@ -1,2 +1,2 @@\n-<img src=x onerror=alert(1)>\n+<b>ok</b>\n'
    const html = renderDiffView(parseUnifiedDiff(nasty))
    assert.ok(textOf(html).includes('<img src=x onerror=alert(1)>'))
    assert.ok(html.includes('&lt;'))
    assert.ok(!/<img/i.test(html))
    const allowed = new Set(['mark', 'span', 'table', 'tbody', 'td', 'th', 'thead', 'tr'])
    const tags = [...html.matchAll(/<\/?([a-z]+)/gi)].map((m) => m[1].toLowerCase())
    assert.deepEqual(tags.filter((t) => !allowed.has(t)), [])
  })

  test('rendering is deterministic across calls and modes', () => {
    for (const mode of ['unified', 'split']) {
      const a = renderDiffView(parseUnifiedDiff(fixture('diff-multi')), { mode })
      const b = renderDiffView(parseUnifiedDiff(fixture('diff-multi')), { mode })
      assert.equal(a, b)
    }
  })

  test('a long line is emitted whole, not truncated or wrapped in markup', () => {
    const [f] = parseUnifiedDiff(fixture('diff-longlines'))
    const longest = f.hunks[0].rows.map((r) => r.text).sort((x, y) => y.length - x.length)[0]
    assert.ok(longest.length > 250)
    const html = renderDiffView([f], { lang: 'sql' })
    assert.ok(textOf(html).includes(longest))
  })
})

describe('file header notes', () => {
  test('a rename shows old → new', () => {
    const html = renderDiffView(parseUnifiedDiff(fixture('diff-multi')))
    assert.match(html, /pkg\/http\/router\.go <span class="wu-dv-arrow" aria-hidden="true">→<\/span> internal\/transport\/router\.go/)
  })

  test('a deleted file is labelled, and a new file too', () => {
    const html = renderDiffView(parseUnifiedDiff(fixture('diff-multi')))
    assert.match(html, /<span class="wu-dv-note">deleted<\/span>/)
    const added = renderUnifiedDiff('--- /dev/null\n+++ b/x.go\n@@ -0,0 +1,1 @@\n+package x\n')
    assert.match(added, /<span class="wu-dv-note">new file<\/span>/)
  })

  test('an unnamed file says so instead of showing an empty path', () => {
    const html = renderDiffView(parseUnifiedDiff(fixture('diff-longlines')))
    assert.match(html, /<span class="wu-dv-unnamed">\(unnamed\)<\/span>/)
  })

  test('a binary file gets a header and no rows', () => {
    const html = renderDiffView(parseUnifiedDiff('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n'))
    assert.match(html, /<span class="wu-dv-note">binary<\/span>/)
    assert.ok(!/<tbody>/.test(html))
  })
})

describe('inferLang()', () => {
  test('maps known extensions and falls back to empty', () => {
    assert.equal(inferLang('internal/order/service.go'), 'go')
    assert.equal(inferLang('web/app.tsx'), 'tsx')
    assert.equal(inferLang('db/schema.sql'), 'sql')
    assert.equal(inferLang('scripts/seed.sh'), 'bash')
    assert.equal(inferLang('Makefile'), '')
    assert.equal(inferLang(null), '')
  })

  test('renderDiffView infers the language per file and an explicit lang wins', () => {
    const inferred = renderDiffView(parseUnifiedDiff(fixture('diff-simple')))
    assert.match(inferred, /data-lang="go"/)
    const forced = renderDiffView(parseUnifiedDiff(fixture('diff-simple')), { lang: 'text' })
    assert.match(forced, /data-lang="text"/)
    assert.ok(!/wu-tok-kw/.test(forced))
  })
})

describe('ensureDiffViews(): the page pass', () => {
  const page = (mode, body) =>
    `<p>before</p>\n<figure class="wu-diffview" data-mode="${mode}"><script type="text/x-writeup-diff">\n${body}\n</script><figcaption>差分</figcaption></figure>\n<p>after</p>\n`

  test('author markup becomes tables, keeping the caption and the raw diff', () => {
    const out = ensureDiffViews(page('unified', fixture('diff-simple')))
    assert.match(out, /<table class="wu-dv" data-mode="unified" data-lang="go">/)
    assert.match(out, /<figcaption>差分<\/figcaption>/)
    assert.match(out, /<script type="text\/x-writeup-diff">/)
    assert.match(out, /<p>before<\/p>/)
    assert.match(out, /<p>after<\/p>/)
    assert.equal(diffFigureText(out), fixture('diff-simple'))
  })

  test('the pass is idempotent', () => {
    const once = ensureDiffViews(page('split', fixture('diff-multi')))
    assert.equal(ensureDiffViews(once), once)
    assert.equal(ensureDiffViews(ensureDiffViews(once)), once)
  })

  test('editing data-mode re-renders from the stored raw diff', () => {
    const once = ensureDiffViews(page('unified', fixture('diff-simple')))
    const flipped = ensureDiffViews(once.replace('data-mode="unified"', 'data-mode="split"'))
    assert.match(flipped, /<table class="wu-dv" data-mode="split"/)
    assert.equal(ensureDiffViews(flipped), flipped)
    assert.equal(diffFigureText(flipped), fixture('diff-simple'))
  })

  test('the raw diff is HTML-escaped inside the script, per the ir-script contract', () => {
    const out = ensureDiffViews(page('unified', '--- a/x.html\n+++ b/x.html\n@@ -1 +1 @@\n-<a>\n+<b>\n'))
    const script = /<script type="text\/x-writeup-diff">([\s\S]*?)<\/script>/.exec(out)[1]
    assert.ok(!script.includes('<a>'))
    assert.ok(script.includes('&lt;a&gt;'))
  })

  test('a figure with no diff script, and a non-diffview figure, are left alone', () => {
    const plain = '<figure class="wu-figure"><svg></svg><figcaption>x</figcaption></figure>'
    assert.equal(ensureDiffViews(plain), plain)
    const empty = '<figure class="wu-diffview"><figcaption>x</figcaption></figure>'
    assert.equal(ensureDiffViews(empty), empty)
  })

  test('a malformed diff leaves the page byte-for-byte unchanged and reports why', () => {
    const src = page('unified', '@@ nope @@\n a\n')
    const errors = []
    assert.equal(ensureDiffViews(src, { onError: (m) => errors.push(m) }), src)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /malformed hunk header at line 1/)
  })

  test('two diffview figures on one page are both rendered', () => {
    const src = page('unified', fixture('diff-simple')) + page('split', fixture('diff-multi'))
    const out = ensureDiffViews(src)
    assert.equal([...out.matchAll(/<table class="wu-dv"/g)].length, 3) // 1 + 2 files
  })
})
