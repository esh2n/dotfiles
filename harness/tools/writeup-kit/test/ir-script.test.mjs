import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeIrScript, unescapeIrScript } from '../bin/lib/ir-script.mjs'

test('escapeIrScript escapes &, <, > only', () => {
  assert.equal(escapeIrScript('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;')
  assert.equal(escapeIrScript('a & b'), 'a &amp; b')
  assert.equal(escapeIrScript('"quoted" \'text\''), '"quoted" \'text\'')
  assert.equal(escapeIrScript('</script><script>alert(1)</script>'),
    '&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
})

test('unescapeIrScript reverses escapeIrScript', () => {
  const raw = 'id: d1\nlabel: <img src=x onerror=alert(1)>\ncaption: "a & b </script>"\n'
  assert.equal(unescapeIrScript(escapeIrScript(raw)), raw)
})

test('unescapeIrScript treats text with no &lt;/&amp; as legacy raw and leaves it unchanged', () => {
  const legacy = 'id: d1\ntitle: 現状のアップロード経路\nnodes: []\nedges: []\n'
  assert.equal(unescapeIrScript(legacy), legacy)
  // even an unescaped &gt; alone (never produced as the *only* entity by
  // escapeIrScript for real content, but exercised here directly) is left
  // alone by the legacy heuristic since it carries neither &lt; nor &amp;
  assert.equal(unescapeIrScript('a &gt; b'), 'a &gt; b')
})

test('round-trips through JSON-shaped IR text (rawYaml may be JSON.stringify output)', () => {
  const raw = JSON.stringify({ id: 'd1', label: '<img>', caption: 'a & b' })
  assert.equal(unescapeIrScript(escapeIrScript(raw)), raw)
})
