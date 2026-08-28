# lint-corpus — calibration corpus for the token-based lint detectors

25 Japanese texts used by `test/lint-calibration.test.mjs` and by the
2026-08 recalibration of `bin/lib/lint/morph.mjs` (see the "Granularity
note" and the per-threshold comments there for the measured numbers).

Two groups:

- `store-*.txt` (15) — prose extracted from real writeup pages
  (`~/.local/share/writeup/engineering/` and `writeup/`) with
  `extractTextFromHtml()` from `bin/lib/text.mjs`, chosen for a spread of
  lengths (about 1,100 to 10,400 characters). Only the text is kept;
  product, company, and personal names were replaced with generic nouns and
  URLs were elided. These pages are neither "good" nor "bad" labels — they
  are the genre the kit lints, and they are what the Python original and the
  kit were compared on.
- `ctrl-*.txt` (10) — hand-written controls. `ctrl-good-*` is natural,
  varied Japanese that should pass; `ctrl-bad-*` is written to trip one
  detector each.

## Files

| File | What it is | Expected |
|---|---|---|
| ctrl-good-01-minutes.txt | Short meeting minutes, conclusions first, numbers | no findings |
| ctrl-good-02-essay.txt | Essay with mixed sentence lengths, some 体言止め | no findings |
| ctrl-good-03-techmemo.txt | Tech memo with measured numbers and a trade-off | no findings |
| ctrl-good-04-long-report.txt | ~4,600-char report; passes the 4,000-char lexical-diversity gate | only `low_lexical_diversity_ttr` (documented as non-separating: the original fires it too, TTR 0.383) |
| ctrl-good-05-decision.txt | Decision record in the `.wu-decision` shape | no findings |
| ctrl-bad-01-lead-repeat.txt | 11 sentences opening with the same two morphemes | `repeated_sentence_lead` |
| ctrl-bad-02-low-lexdiv.txt | ~4,100 chars cycling the same ~20 content words | `low_lexical_diversity_ttr`, `low_lexical_diversity_mtld` |
| ctrl-bad-03-low-specificity.txt | Abstract nouns only, no names, numbers, or examples | `low_specificity` (3 paragraphs) |
| ctrl-bad-04-uniform-rhythm.txt | 8 sentences of near-identical mora length | `low_burstiness` |
| ctrl-bad-05-ai-flavored.txt | Cliché openers, 〜することができる, 3-sentence paragraphs | `forbidden_phrase`, `translationese_morph` |
| store-01-impl-note.txt | Implementation note (writeup/) | — |
| store-02-devflow-index.txt | Dev-flow index page | — |
| store-03-owasp.txt | Web security overview | — |
| store-04-locking.txt | Optimistic vs pessimistic locking | — |
| store-05-race.txt | Race conditions | — |
| store-06-kanban-scrum.txt | Kanban vs Scrum | — |
| store-07-ddd-trilemma.txt | Domain-model trilemma | — |
| store-08-virtual-dom.txt | Virtual DOM | — |
| store-09-hash-mac.txt | Hashes and MACs | — |
| store-10-postmortem.txt | Incident postmortems | — |
| store-11-design-decisions.txt | Writeup design decisions (writeup/) | — |
| store-12-clean-arch.txt | Clean architecture | — |
| store-13-retry-breaker.txt | Timeouts, retries, circuit breakers | — |
| store-14-session-cookie.txt | Sessions and cookies | — |
| store-15-tcp.txt | TCP | — |

## Reproducing the comparison

The Python original (`personal/skills/natural-japanese/scripts/lint.py`,
Sudachi SplitMode.C) runs with `uv run … --json --experimental <file>` as
documented in that skill. The kit side is `node bin/lint.mjs --json
--experimental <file>`. Both emit `stats.rhythm.burstiness`,
`stats.lexical_diversity` / `stats.lexicalDiversity`, `stats.ngram`, and
`stats.low_specificity` / `stats.lowSpecificity`, which is what the
numbers in `morph.mjs` were read from.
