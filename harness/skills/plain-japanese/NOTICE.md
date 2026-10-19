# Third-party notices

## nanaism/yomiyasu

Some rows of `data/metaphors.tsv` (every row whose `source` column starts with
`nanaism/yomiyasu`) are taken from yomiyasu. Only word lists and regular
expressions were taken; no code was copied. Notes were reworded.

- Source: https://github.com/nanaism/yomiyasu
- Commit: `79d15a621751cb7ad3bea556832209e9112e575f` (2026-10-19, skill version 2.0.2)
- Files read:
  - `skills/yomiyasu/scripts/yomiyasu_lint.py`, `METAPHOR_VERB_PATTERNS` (16 patterns, copied verbatim)
  - `skills/yomiyasu/references/lists/fact-gaps.txt`, the `figure` row (copied verbatim)
  - `skills/yomiyasu/references/slop-catalog.md`, §1 (verbs 逃がす, 沈黙する) and §5 (word lists), turned into patterns here
- Taken on: 2026-10-19. The clone was deleted after extraction.
- Licence: MIT

```
MIT License

Copyright (c) 2026 nanaism

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

To refresh: clone the repository into an empty scratch directory, read the
three places above as data (do not run its scripts), update the rows and the
commit here, and delete the clone.

## Ideas adapted without copying text

- pstack `unslop` rule 33 (over-compression) and `technical-writing`
  ("Don't invent jargon", no slashes), cursor/plugins, MIT, Lauren Tan:
  the compression check and the internal-term rule restate these for Japanese.
- coji/natural-japanese v1.6.0 (MIT): the idea of `newfacts.py` (list what a
  rewrite added) behind `scripts/diff_content.py`, and the "unreadable phrase"
  types 3 and 6 behind some `plain-japanese` rows of `data/metaphors.tsv`.
- 文化庁「公用文作成の考え方」(2022): the four treatments behind the `class`
  column of `terms.tsv`.
