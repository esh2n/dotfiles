---
name: natural-japanese
description: Skill for writing and revising Japanese business documents so they read easily and clearly. Use for creating or proofreading business writing — meeting minutes (including turning a transcript into minutes), research and analysis reports, internal guides and manuals, research memos, discussion papers, proposals, plans, reports, email, and slide outlines — and for any instruction such as 「結論から書いて」「論旨を明確に」「見出しを端的に」「専門用語をわかりやすく説明して」. Also handles removing AI smell (direct, indirect or colloquial complaints such as 「AIっぽい」「AI臭い」「機械翻訳っぽい」「不自然」「もっと自然な日本語に」「機械っぽい」「人間っぽくして」「単調」「〜することができる、と言えるだろう、のような言い回し」, or the user was told / suspected of writing with AI), requests to improve hard-to-read or unclear text (odd word order, overlong sentences, unclear point, misplaced commas, etc.), writing new note articles, blog posts or essays (including writing any topic from scratch), rewriting and polishing existing text, diagnosing or scoring AI smell (「この文章AIが書いた？」「AI臭さをスコアで出して」「どれくらいAIっぽいか判定して」 — requests without a rewrite), and requests to learn or profile the user's own style (including reading their past writing to write like them). Out of scope: chapter structure of technical documents and Markdown formatting itself (one sentence per line, blockquotes, footnote syntax, etc.) — that belongs to another skill; this skill is dedicated to naturalness, readability and clarity of the prose.
license: MIT
argument-hint: "[write|score] [quick|full|exp] [対象ファイルや依頼内容]"
metadata:
  namespaces: [doc]
---

# natural-japanese

A skill for writing Japanese business prose that reads easily and clearly. From business documents — minutes, research reports, internal guides, research memos, slides — to note, blog and essay pieces. Removing AI smell is built into the process as one of its steps. The documents produced are Japanese; the instructions below are in English.

## Design philosophy

Two axes. First, "detection by machine, judgment by AI". An AI has trouble recognizing its own habits, so suspicion is detected deterministically by a machine, and whether to fix it is judged by the AI (you) in context. Second, "constraints at generation time over fixing afterwards". Preventing the smell through design before writing and constraints while writing beats scrubbing it out afterwards. The process runs in the order "design → write → inspect → converge".

## Execution modes — quick and full

The same process runs in two modes that differ in effort. Measured time as a guide: quick takes about 30 seconds on a short document (a meeting memo) and about 3 minutes even on a long one (around 10,000 characters). Full takes about 7 minutes on a short document and 15–20 minutes at 10,000 characters. When starting full, tell the user this estimate in one line before beginning.

**Quick (default)**: for everyday documents. No subagents; finish in place. The only extra file to read is the one doctype template that applies (the §2 summary of the writing constitution is enough; open the other references only when a lint finding leaves you unsure). Do the design (§1) — reader, main message, headings — in your head. Inspection is one lint run (the kit version if present, otherwise the uv version) plus your own skeleton read-through. Do not skip lint even for a short document (the statistical detectors go quiet on short text, but forbidden words and translationese are detected from a single sentence. It is a few seconds of insurance, and skipping it voids quick's quality guarantee). The convergence loop stops after one pass if no new findings appear; finish with the final-pass read-through. The skill should add only tens of seconds; if you find yourself reading references beyond that, you are doing full-mode work.

**Full**: when the user says 「しっかり」「ちゃんと」「時間をかけていい」, when the cost of failure is high (external or executive audience), or when the document is long (over about 10,000 characters). Once full is chosen (or the user specifies it), do not skip steps even for a small document. Besides lint (kit version if present, otherwise uv), run outline / terms too, and always perform the three reviews of inspection (§4) — structure review, readability review, doctype check — in parallel subagents (each returns findings; merging into the decision ledger and the "fix / keep" judgment are always done by the parent. Never split the writing itself — density, consistent metaphors and connections between sections cannot be kept without seeing the whole document). Converge until the state condition (§5) is met. Even if it feels "excessive for this document", do not thin the process on your own; propose switching to quick to the user. Note that measurements confirm runs with a low thinking budget (effort) tend to rationalize away full's steps. Where effort is selectable, high is recommended for full (low is enough for quick).

When torn, finish in quick first and add one line telling the user "it can be polished again in full".

## Invocation — write / score / mode

When the skill is called as a command with arguments, interpret these forms.

- `/natural-japanese [quick|full] <対象>` — write or revise (default). Decide from the target whether it is new writing or a rewrite
- `/natural-japanese write [quick|full] <お題や素材>` — **explicitly new writing**. Starting with no source text, write through the whole process: §1 design (reader, main message, skeleton, density, material gathering) → §2 writing → inspection → convergence. If material is thin, gather it first via §1-4 or ask the user
- `/natural-japanese score [quick|full|exp] <ファイル>` — **diagnosis only**. Without rewriting, return a naturalness score (0–100, higher = more natural = less AI smell) with reasons. quick = lint only (30 seconds), full = with structure and readability reviews, exp = with semantic.py deep detection (about 1GB download on first run). **Always read `references/diagnose.md` first.** The score formula, bands and output format are defined there; returning transcribed lint findings without reading it is not diagnosis-mode work. You may propose a rewrite after diagnosing, but do not fix until asked

Without a mode, choose one yourself by the execution-mode criteria. Natural language works the same (「〇〇について書いて」 → write, 「この文章AIっぽい？」「AI臭さを採点して」 → score).

## 1. Design — decide before writing

### 1-1. Reader, purpose, document type

Identify who reads it and what should happen after they read it (ask the user if unclear). Once the document type is settled, read the matching template:

- 議事録 (minutes) → `references/doctypes/minutes.md`
- 調査レポート・分析レポート (research / analysis report) → `references/doctypes/report.md`
- 社内ガイド・マニュアル (internal guide / manual) → `references/doctypes/guide.md`
- リサーチメモ・ディスカッションペーパー・企画書 (research memo / discussion paper / proposal) → `references/doctypes/memo.md`
- スライド構成 (slide outline) → `references/doctypes/slide.md`

Documents that fit no template (note, blog, essay, etc.) may skip this section.

### 1-2. Main message and skeleton

Before the body, write the main message in one sentence. If you cannot, the material is insufficient — not a writing problem (→ 1-4). Next, build the heading skeleton. Each heading is a message that contains a conclusion, not a label like 「背景」「まとめ」. Confirm the argument holds when reading only the headings in order, then proceed to the body.

### 1-3. Density design

Writing every section with the same heat and thickness is itself an "over-tidy unnaturalness". Deliberately design unevenness: important sections thick, light sections honestly light. Procedure: 「濃淡設計」 in `references/revision-guide.md`.

### 1-4. Material gathering — optional, for new writing

Starting to write with few proper nouns, numbers or real examples at hand leaves nothing to fix when you later notice "this only says generalities". The procedure for gathering material by alternating reasoning and search, the criteria for "enough", and how to ask the user for material where web search is unavailable: 「素材集め」 in `references/revision-guide.md`.

### 1-5. Style profile — optional

If `style-profile.md` (at the project root or a user-specified place) already exists, read it and build on its habits of viewpoint, vocabulary and rhythm. Otherwise proceed in generic mode. Only when the user asks to have their own style learned, extract the characteristics of 3–5 past pieces following `assets/style-profile-template.md` and write out the profile (hedge with 「傾向として」 rather than asserting).

## 2. Writing — under the writing constitution

Write the body under the 12 articles of `references/writing-constitution.md` as constraints. In brief: lead with the conclusion and write no preamble; headings are messages; explain in running prose, with bullets only for truly parallel compression; explain jargon inline in the order "function → name"; ground with proper nouns and numbers; bold only the one core phrase in the text; vary density; never repeat the same mold three times; 「〜ではなく」 only for a genuine correction of a misunderstanding; disclose limits and estimates with explicit labels; separate fact from opinion; close by re-integrating, and for reports reach the So What.

At this stage do not fuss over forbidden words or rhythm; get the content out within the constitution. The inspection step catches the details.

## 3. Inspection (1) — static detection

Call the scripts by absolute path (**cwd-independent**):

```bash
SK="$HOME/.claude/skills/natural-japanese"
# fall back to the dotfiles checkout when the symlink is broken
[ -d "$SK/scripts" ] || SK="${DOTFILES_ROOT:-$HOME/dotfiles}/harness/skills/natural-japanese"

uv run "$SK/scripts/lint.py" --json <file>
```

### Which lint

`uv run scripts/lint.py` is the default but not the only implementation. Priority: (1) if `writeup-kit`'s Node lint exists (`${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/tools/writeup-kit/bin/lint.mjs`; it does not resolve from a path relative to the skill), prefer `node <kit>/bin/lint.mjs <file> --json`. The JSON shape (category/severity/excerpt/span/message/suggestion) is the same, `--baseline` works too, and `--config` auto-discovers `.writeup.toml`. (2) Without the kit, `uv run scripts/lint.py` as before. (3) Where `uv` is unavailable either, check by hand with `references/manual-checklist.md`.

Both implementations share the detectors and the forbidden-word / translationese vocabularies (13 detectors in total) but use different morphological analyzers (kit = IPADIC, uv = Sudachi C). So counts from the ngram / lexical_diversity / low_specificity detectors may differ slightly — treat either number as indicative and defer judgment to the visual review in §4.

It mechanically detects forbidden words, translationese, repeated negative-positive contrast, uniform sentence length, noun-ending rate, paragraph-initial conjunction rate, lexical diversity, suspected English syntax, and more. The exit code is 0 regardless of the count (it is a lint; it never fails CI on count). Exit code 1 only on input error.

When the document's genre is clear, pass `--genre essay|tech|business`. It switches to a corpus-calibrated threshold profile and reduces false positives. Per-genre differences in judgment: `references/genre-notes.md`.

In the convergence loop (4–5), passing the previous `--json` output as `--baseline` sorts findings into resolved / new / persisting automatically. Where `uv` is unavailable (Claude.ai etc.), trace the same points by hand with `references/manual-checklist.md`.

There is also an EXPERIMENTAL semantic detector, `scripts/semantic.py`. It measures the rise and fall of similarity between adjacent sentences via sentence embeddings (flatness of topic); being heavyweight — torch + sentence-transformers, ~1GB model download on first run — it is not built into lint.py but kept as a separate opt-in entry. Only in the full process or when the environment allows, additionally run `uv run "$SK/scripts/semantic.py" --json <file>` and put its findings on the decision ledger like lint's.

## 4. Inspection (2) — the decision ledger and two reviews

lint findings are suspicions, not an order to fix everything mechanically. Re-read the section of `references/revision-guide.md` for each category that was hit and decide "fix / do not fix" in context. Record the decision for each finding as you go — "fixed" or "kept (reason)" (ledger format: 「判断台帳」 in that file).

If you need a term catalog: forbidden words → `references/forbidden-patterns.md`, translationese → `references/translationese.md`. To check whether jargon is explained at first use, run `uv run "$SK/scripts/terms.py" <file>`. It lists katakana compounds, ASCII abbreviations and likely proper nouns with the line of first use, occurrence count and whether an explanation marker is present (whether it is actually explained is judged by the AI/human, not the machine).

### Structure review — skeleton read-through

lint sees only the sentence-level surface. Especially in bullet-heavy minutes and slides, lint passes almost everything, so the structure review takes the lead. Extract only the headings and the first sentence of each paragraph from the finished body, read them, and check the following (`uv run "$SK/scripts/outline.py" <file>` extracts headings, each paragraph's first sentence and bullet placeholders with line numbers):

1. Does the argument hold (can the story be followed from the skeleton alone)?
2. Is each heading a message?
3. Is the same mold repeated (definition-sentence pattern, internal section structure, opening sentence pattern)?
4. Is there density variation (are all sections the same thickness)?
5. Does the close connect to the So What (report types)?

When the document type is settled, also check the doctype's 「必須要素」 (required elements) and 「AIがやりがちな失敗」 (typical AI failures).

### Readability review

Word order, comma placement, one idea per sentence, subject-predicate distance, overuse of demonstratives, and redundancy are judgment areas proven not to threshold mechanically. Judge them visually every pass, referring to `references/readability-principles.md` (general principles) and `references/readability-antipatterns.md` (24 bad-writing patterns).

Problems found in the structure and readability reviews also go on the decision ledger as one line each, like lint findings.

When a paragraph says only generalities (no proper nouns, numbers, real examples), it is usually a material problem, not a writing one. See 「素材不足の分岐」 in `references/revision-guide.md` to decide whether to go back to gathering information.

## 5. Convergence

After applying the ledger's "fixed" items, re-run lint and check for new findings. Repeat 3–4 until every finding on the ledger is sorted and the fixes produce no new findings. If the same finding recurs two passes in a row, see 「発散ガード」 in `references/revision-guide.md`.

When rewriting an existing document, applying the same kind of fix uniformly to every item (turning headings into conclusions, bullets into prose, etc.) erases the document's natural density and increases AI smell instead. The principle of fixing only where it adds value: 「改稿を一律に適用しない」 in `references/revision-guide.md`.

## 6. Final pass — self-check loop

Even once lint and the ledger converge, that only means the known patterns are gone. At the end, always read through as a first-time reader and check the rhythm as if reading aloud. Procedure: 「自己点検ループ」 in `references/revision-guide.md`. If something feels off, put it on the ledger and return to 5; when nothing does, finish.

## 7. Cleanup

When done, delete every intermediate file created during the work (ledger, lint JSON, draft backups, etc.). The only things that may remain in the user's project are the finished document and, only when the user explicitly wanted it, `style-profile.md`. Details: 「作業ファイルの扱い」 in `references/revision-guide.md`.

## Examples

For concrete before/after examples, see `references/examples.md`.

When asked to remove AI smell from English text, refer to `references/patterns-en.md` (a catalog of English AI-writing patterns).
