import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { faviconSvg, faviconDataUri, glyphFor, statusFromChecks } from '../bin/lib/favicon.mjs'

const KIND_GLYPH_PAIRS = [
  ['決定記録', '決'],
  ['設計', '設'],
  ['調査まとめ', '調'],
  ['参考資料まとめ', '資'],
  ['PBI 資料', 'P'],
  ['絵解き', '絵'],
  ['作業メモ', 'メ'],
  ['議事録', '議'],
]

const ALLOWED_COLORS = new Set(['#1c2230', '#2f4b9c', '#ffffff', 'none'])

/** Every `fill="…"` / `stroke="…"` value present in an SVG string. */
function colorsIn(svg) {
  return [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1])
}

describe('favicon: glyph mapping', () => {
  for (const [kind, glyph] of KIND_GLYPH_PAIRS) {
    test(`kind "${kind}" maps to glyph "${glyph}"`, () => {
      assert.equal(glyphFor(kind), glyph)
    })
  }

  test('an unrecognized kind falls back to a middle dot', () => {
    assert.equal(glyphFor('no-such-kind'), '·')
  })

  test('a missing/empty kind falls back to a middle dot', () => {
    assert.equal(glyphFor(undefined), '·')
    assert.equal(glyphFor(''), '·')
  })

  test('a legacy page (no kind meta at all) gets the same middle-dot mark', () => {
    const svg = faviconSvg({ kind: undefined, status: 'pending' })
    assert.match(svg, />·<\/text>/)
  })
})

describe('favicon: SVG validity and two-color constraint', () => {
  test('every kind produces a well-formed 32x32 SVG with exactly one root <svg>', () => {
    for (const [kind] of KIND_GLYPH_PAIRS) {
      const svg = faviconSvg({ kind, status: 'pass' })
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 32 32">/)
      assert.match(svg, /<\/svg>$/)
      assert.equal((svg.match(/<svg/g) || []).length, 1)
    }
  })

  test('only ink, accent, white, or "none" ever appear as a fill/stroke value', () => {
    for (const status of ['pass', 'fail', 'pending']) {
      for (const kind of [...KIND_GLYPH_PAIRS.map(([k]) => k), 'index', undefined]) {
        const svg = faviconSvg({ kind, status })
        for (const c of colorsIn(svg)) {
          assert.ok(ALLOWED_COLORS.has(c), `unexpected color "${c}" for kind=${kind} status=${status}`)
        }
      }
    }
  })

  test('faviconDataUri returns a percent-encoded data:image/svg+xml, URI (not base64)', () => {
    const uri = faviconDataUri({ kind: '設計', status: 'pass' })
    assert.match(uri, /^data:image\/svg\+xml,/)
    assert.ok(!uri.includes('base64'))
    const encoded = uri.slice('data:image/svg+xml,'.length)
    const decoded = decodeURIComponent(encoded)
    assert.match(decoded, /^<svg /)
  })

  test('the decoded data URI matches faviconSvg\'s own output', () => {
    const opts = { kind: '議事録', status: 'fail' }
    const uri = faviconDataUri(opts)
    const decoded = decodeURIComponent(uri.slice('data:image/svg+xml,'.length))
    assert.equal(decoded, faviconSvg(opts))
  })
})

describe('favicon: status ring variants', () => {
  test('status "pass" renders no ring', () => {
    const svg = faviconSvg({ kind: '設計', status: 'pass' })
    assert.ok(!svg.includes('stroke='))
  })

  test('an omitted status renders no ring (defaults like pass)', () => {
    const svg = faviconSvg({ kind: '設計' })
    assert.ok(!svg.includes('stroke='))
  })

  test('status "fail" renders a solid 3px accent ring', () => {
    const svg = faviconSvg({ kind: '設計', status: 'fail' })
    assert.match(svg, /stroke="#2f4b9c" stroke-width="3"/)
    assert.ok(!svg.includes('stroke-dasharray'))
  })

  test('status "pending" renders a dashed 2px accent ring', () => {
    const svg = faviconSvg({ kind: '設計', status: 'pending' })
    assert.match(svg, /stroke="#2f4b9c" stroke-width="2" stroke-dasharray="3 2"/)
  })

  test('the ring is drawn around the ink square, not replacing it', () => {
    const svg = faviconSvg({ kind: '設計', status: 'fail' })
    assert.match(svg, /fill="#1c2230"/)
  })
})

describe('favicon: index mark', () => {
  test('kind "index" renders three horizontal white bars, not a glyph', () => {
    const svg = faviconSvg({ kind: 'index', status: 'pass' })
    assert.equal((svg.match(/<rect[^>]*fill="#ffffff"/g) || []).length, 3)
    assert.ok(!svg.includes('<text'))
  })

  test('the index mark still sits on the same ink square', () => {
    const svg = faviconSvg({ kind: 'index' })
    assert.match(svg, /fill="#1c2230"/)
  })

  test('faviconDataUri({ kind: "index" }) round-trips to the three-bar mark', () => {
    const uri = faviconDataUri({ kind: 'index' })
    const decoded = decodeURIComponent(uri.slice('data:image/svg+xml,'.length))
    assert.ok(!decoded.includes('<text'))
  })
})

describe('statusFromChecks()', () => {
  test('empty/missing checks -> pending', () => {
    assert.equal(statusFromChecks({}), 'pending')
    assert.equal(statusFromChecks(undefined), 'pending')
  })

  test('self-check=fail -> fail, regardless of other values', () => {
    assert.equal(statusFromChecks({ lint: 'pass', 'self-check': 'fail' }), 'fail')
  })

  test('lint=fail -> fail, regardless of other values', () => {
    assert.equal(statusFromChecks({ lint: 'fail', 'self-check': 'pass' }), 'fail')
  })

  test('a skipped check (no fail present) -> pending', () => {
    assert.equal(statusFromChecks({ lint: 'skipped', 'self-check': 'pass' }), 'pending')
  })

  test('a pending check (no fail present) -> pending', () => {
    assert.equal(statusFromChecks({ lint: 'pending', 'self-check': 'pending' }), 'pending')
  })

  test('every check pass -> pass', () => {
    assert.equal(statusFromChecks({ lint: 'pass', 'self-check': 'pass', diagram: '3/3' }), 'pass')
  })

  test('fail takes priority over a simultaneous pending value', () => {
    assert.equal(statusFromChecks({ lint: 'pending', 'self-check': 'fail' }), 'fail')
  })
})
