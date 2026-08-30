import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { standaloneSvg } from '../bin/lib/standalone-svg.mjs'
import { parseTokens } from '../bin/lib/contrast.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const KIT_CSS = readFileSync(join(HERE, '..', 'kit', 'writeup.css'), 'utf8')

const FIGURE_SVG = `<svg role="img" aria-labelledby="t d" viewBox="0 0 100 100">` +
  `<title id="t">title</title><desc id="d">desc</desc>` +
  `<rect data-tone="ts" x="0" y="0" width="10" height="10"/>` +
  `<rect class="wu-focal" x="20" y="0" width="10" height="10"/>` +
  `<text x="5" y="5">label</text>` +
  `</svg>`

describe('standaloneSvg', () => {
  test('inserts <style> as the svg root\'s first child', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.match(out, /^<svg[^>]*><style[^>]*>/)
  })

  test('the style block defines every light-theme token with its real value', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    const light = parseTokens(KIT_CSS).light
    assert.ok(Object.keys(light).length > 0)
    for (const [name, value] of Object.entries(light)) {
      assert.ok(out.includes(`${name}: ${value};`), `missing token ${name}: ${value}`)
    }
  })

  test('sets color and font-family defaults on svg from the light tokens', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.match(out, /color: var\(--wu-ink\);/)
    assert.match(out, /font-family: var\(--wu-font-body\);/)
  })

  test('carries the rect[data-tone="ts"] rule, prefix stripped', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.match(out, /rect\[data-tone="ts"\]\s*\{\s*\n\s*fill: var\(--wu-fig-tone-ts\);/)
  })

  test('carries the rect.wu-focal (grouped) rule, prefix stripped', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.match(out, /rect\.wu-focal, circle\.wu-focal, ellipse\.wu-focal, polygon\.wu-focal, path\.wu-focal\s*\{\s*\n\s*stroke: var\(--wu-accent\);/)
  })

  test('no ".wu-figure" prefix remains anywhere in the output', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.ok(!out.includes('.wu-figure'))
  })

  test('drops page-only declarations (max-width / margin / display) from carried rules', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    // .wu-figure[data-scroll="true"] svg { max-width: none } has nothing left
    // to keep, so it must not appear as an empty rule.
    assert.ok(!/max-width: none/.test(out))
    assert.ok(!/display: block/.test(out))
    assert.ok(!/margin-inline: auto/.test(out))
  })

  test('inserts an opaque var(--wu-surface) background <rect> as the second child', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.match(out, /<\/style><rect width="100%" height="100%" fill="var\(--wu-surface\)"><\/rect>/)
  })

  test('guarantees xmlns on the svg root when missing', () => {
    const out = standaloneSvg(FIGURE_SVG, KIT_CSS)
    assert.match(out, /^<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  })

  test('leaves an existing xmlns / role / aria-labelledby / viewBox untouched', () => {
    const withXmlns = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t" viewBox="0 0 10 10"><title id="t">t</title></svg>`
    const out = standaloneSvg(withXmlns, KIT_CSS)
    assert.match(out, /role="img"/)
    assert.match(out, /aria-labelledby="t"/)
    assert.match(out, /viewBox="0 0 10 10"/)
    assert.equal((out.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || []).length, 1)
  })

  test('running twice does not add a second <style>', () => {
    const once = standaloneSvg(FIGURE_SVG, KIT_CSS)
    const twice = standaloneSvg(once, KIT_CSS)
    assert.equal((twice.match(/<style/g) || []).length, 1)
  })

  test('returns the markup unchanged (aside from xmlns) when there is no <svg> root', () => {
    const out = standaloneSvg('<p>not an svg</p>', KIT_CSS)
    assert.equal(out, '<p>not an svg</p>')
  })
})
