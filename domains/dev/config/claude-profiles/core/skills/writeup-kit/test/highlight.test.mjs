import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { highlight } from '../bin/lib/highlight.mjs'

function classesIn(html) {
  return new Set([...html.matchAll(/wu-tok-([a-z]+)/g)].map((m) => m[1]))
}

describe('highlight(): per-language token classes', () => {
  test('go: keywords, strings, comments, numbers, function calls, types', () => {
    const code = [
      'package main',
      '',
      '// Greet prints a greeting.',
      'func Greet(name string) string {',
      '\tmsg := fmt.Sprintf("Hello, %s! <3", name)',
      '\tcount := 42',
      '\treturn msg',
      '}',
    ].join('\n')
    const html = highlight(code, 'go')
    const classes = classesIn(html)
    assert.ok(classes.has('kw'), html)
    assert.ok(classes.has('str'), html)
    assert.ok(classes.has('cmt'), html)
    assert.ok(classes.has('num'), html)
    assert.ok(classes.has('fn'), html)
    assert.ok(classes.has('type'), html)
    assert.match(html, /<span class="wu-tok-kw">package<\/span>/)
    assert.match(html, /<span class="wu-tok-cmt">\/\/ Greet prints a greeting\.<\/span>/)
  })

  test('ts/tsx/js/jsx: keywords, strings, comments share the js-family tokenizer', () => {
    for (const lang of ['ts', 'tsx', 'js', 'jsx']) {
      const code = '// note\nfunction run(x: number) {\n  const label = "go <fast>"\n  return x\n}'
      const html = highlight(code, lang)
      const classes = classesIn(html)
      assert.ok(classes.has('kw'), `${lang}: ${html}`)
      assert.ok(classes.has('str'), `${lang}: ${html}`)
      assert.ok(classes.has('cmt'), `${lang}: ${html}`)
      assert.ok(classes.has('fn'), `${lang}: ${html}`)
    }
  })

  test('sql: uppercase and lowercase keywords both classify; strings use \'\' escaping', () => {
    const code = "-- active users\nSELECT id FROM users WHERE name = 'O''Brien' AND active = 1;"
    const html = highlight(code, 'sql')
    const classes = classesIn(html)
    assert.ok(classes.has('kw'), html)
    assert.ok(classes.has('str'), html)
    assert.ok(classes.has('cmt'), html)
    assert.ok(classes.has('num'), html)
    assert.match(html, /<span class="wu-tok-str">'O''Brien'<\/span>/)
  })

  test('yaml: booleans as keywords, comments, strings, numbers', () => {
    const code = '# service config\nenabled: true\nretries: 3\nlabel: "a <tag>"'
    const html = highlight(code, 'yaml')
    const classes = classesIn(html)
    assert.ok(classes.has('kw'), html)
    assert.ok(classes.has('cmt'), html)
    assert.ok(classes.has('num'), html)
    assert.ok(classes.has('str'), html)
  })

  test('json: true/false/null as keywords, quoted strings, numbers', () => {
    const code = '{"enabled": true, "retries": 3, "note": "<ok>"}'
    const html = highlight(code, 'json')
    const classes = classesIn(html)
    assert.ok(classes.has('kw'), html)
    assert.ok(classes.has('str'), html)
    assert.ok(classes.has('num'), html)
  })

  test('bash/sh: reserved words, comments, strings', () => {
    for (const lang of ['bash', 'sh']) {
      const code = '#!/usr/bin/env bash\n# deploy\nfor env in staging prod; do\n  echo "to $env <ok>"\ndone'
      const html = highlight(code, lang)
      const classes = classesIn(html)
      assert.ok(classes.has('kw'), `${lang}: ${html}`)
      assert.ok(classes.has('cmt'), `${lang}: ${html}`)
      assert.ok(classes.has('str'), `${lang}: ${html}`)
    }
  })

  test('python: keywords, comments, strings, function calls', () => {
    const code = '# compute average\ndef average(nums):\n    total = sum(nums)\n    label = "n < 10"\n    return total / len(nums)'
    const html = highlight(code, 'python')
    const classes = classesIn(html)
    assert.ok(classes.has('kw'), html)
    assert.ok(classes.has('cmt'), html)
    assert.ok(classes.has('str'), html)
    assert.ok(classes.has('fn'), html)
  })

  test('toml: booleans as keywords, comments, strings, numbers', () => {
    const code = '# service config\nname = "retry-worker"\nenabled = true\nretries = 3'
    const html = highlight(code, 'toml')
    const classes = classesIn(html)
    assert.ok(classes.has('kw'), html)
    assert.ok(classes.has('cmt'), html)
    assert.ok(classes.has('str'), html)
    assert.ok(classes.has('num'), html)
  })

  test('html: tag names as kw, attribute names as type, attribute values as str, comments', () => {
    const code = '<!-- header -->\n<div class="wrap" title="a < b">Hello</div>'
    const html = highlight(code, 'html')
    assert.match(html, /<span class="wu-tok-cmt">&lt;!-- header --&gt;<\/span>/)
    assert.match(html, /<span class="wu-tok-kw">div<\/span>/)
    assert.match(html, /<span class="wu-tok-type">class<\/span>/)
    assert.match(html, /<span class="wu-tok-str">"wrap"<\/span>/)
  })

  test('diff: leading +/- lines become add/del spans, context lines stay plain', () => {
    const code = ' context\n+added <b>\n-removed'
    const html = highlight(code, 'diff')
    assert.match(html, /^ context\n<span class="wu-tok-add">\+added &lt;b&gt;<\/span>\n<span class="wu-tok-del">-removed<\/span>$/)
  })

  test('text: no-op, escape only, no wu-tok- spans', () => {
    const html = highlight('plain <b> text', 'text')
    assert.equal(html, 'plain &lt;b&gt; text')
    assert.ok(!html.includes('wu-tok-'))
  })
})

describe('highlight(): HTML escaping is preserved through token spans', () => {
  test('a "<" inside a string literal is escaped, not left raw', () => {
    const html = highlight('const s = "a < b"', 'js')
    assert.ok(!/[^&]<b/.test(html), html) // no raw "<b" outside of markup
    assert.match(html, /a &lt; b/)
  })

  test('a "<" inside a go comment is escaped', () => {
    const html = highlight('// a < b', 'go')
    assert.match(html, /<span class="wu-tok-cmt">\/\/ a &lt; b<\/span>/)
  })
})

describe('highlight(): unknown/no-op languages', () => {
  test('unrecognized language falls back to escape-only (no wu-tok- spans)', () => {
    const html = highlight('foo < bar', 'brainfuck')
    assert.equal(html, 'foo &lt; bar')
  })

  test('empty lang falls back to escape-only', () => {
    assert.equal(highlight('a < b', ''), 'a &lt; b')
    assert.equal(highlight('a < b', undefined), 'a &lt; b')
  })
})

describe('highlight(): determinism / idempotence', () => {
  test('same (code, lang) always produces the same output', () => {
    const code = 'func Foo() { return 1 }'
    assert.equal(highlight(code, 'go'), highlight(code, 'go'))
  })

  test('output contains no unescaped "<" outside markup for every language', () => {
    const samples = [
      ['go', 'x := "<a>"'],
      ['js', 'const x = "<a>"'],
      ['sql', "SELECT '<a>'"],
      ['yaml', 'x: "<a>"'],
      ['json', '{"x": "<a>"}'],
      ['bash', 'echo "<a>"'],
      ['python', 'x = "<a>"'],
      ['toml', 'x = "<a>"'],
      ['diff', '+<a>'],
      ['text', '<a>'],
    ]
    for (const [lang, code] of samples) {
      const html = highlight(code, lang)
      // every literal "<a>" must have become "&lt;a&gt;"
      assert.ok(!html.includes('<a>'), `${lang}: ${html}`)
      assert.ok(html.includes('&lt;a&gt;'), `${lang}: ${html}`)
    }
  })
})

describe('highlight(): never throws', () => {
  const garbage = [
    [null, 'go'],
    [undefined, 'js'],
    [123, 'python'],
    [{}, 'sql'],
    ['unterminated "string', 'go'],
    ['unterminated /* comment', 'go'],
    ['unterminated \'\'\' triple', 'python'],
    ['a'.repeat(2000) + '((((((((((', 'go'],
    ['`unterminated template', 'ts'],
    ['x', 'this-language-does-not-exist'],
    ['', 'go'],
    [' \n\t ', 'json'],
  ]
  for (const [code, lang] of garbage) {
    test(`does not throw for ${JSON.stringify(lang)} / ${JSON.stringify(String(code)).slice(0, 30)}`, () => {
      assert.doesNotThrow(() => highlight(code, lang))
      const html = highlight(code, lang)
      assert.equal(typeof html, 'string')
    })
  }
})
