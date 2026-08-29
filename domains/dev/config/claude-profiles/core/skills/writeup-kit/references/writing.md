# Writing guide — design first, then write

Read by the writeup, grilling, eli5 and show-me skills before they draft Japanese body text for a page. Examples are Japanese; the rules apply to any language the page is written in. `bin/lint.mjs` checks the mechanical part afterwards; this guide is what keeps its findings from appearing in the first place.

## 1. Decide before drafting

1. **Reader and the one takeaway.** The reader is defined by behaviour, never by age or level. Write for someone who must get it in one read even when tired (疲れていても一読で分かる); who meets every term defined at its first use (初出で全用語を定義する); who is shown why the other options lost, not only what won (なぜ他案でないかを示す); and who is told the weak points by the author, not left to find them (弱点を自己申告する). Then name the single sentence they must still remember a week later. If that sentence cannot be written, the material is missing — collect names, numbers, and examples before writing prose.
2. **Skeleton of conclusions.** Write the headings first and make each one a claim, not a label. Read the headings top to bottom: if the argument does not follow from headings alone, fix the headings before the body. Mix the forms (`前提: …`, a plain claim, a question); a page where every heading is `ラベル: 結論` reads as a template.
3. **Weight plan.** Decide which section gets the numbers and the example and which gets one line. Equal thickness everywhere is the tell of writing that had nothing to say; "この節に特筆すべき点はない" is an acceptable sentence.
4. **Kind and components.** Pick the page kind (`references/kinds.md`) and the components the kind allows; that fixes where `.wu-summary` and `.wu-terms` go, and whether a decision is an `h3` with prose (a 決定記録) or a `.wu-decision` card (a design doc with one or two decisions — §7).

## 2. Sentence rules

- **One idea per sentence.** If a sentence carries a cause and its effect, or two parallel claims, split it and make the link explicit (`そのため` / `ただし`). Reader effort comes from held-open clauses, not from character count alone.
- **Length.** No measured threshold for readability is available in this kit, so the rule is qualitative: a sentence the reader cannot hold in one breath is too long. The lint flags sentences over 80 characters (`long_sentence`, warn) and over 120 (error); those are the gate values of `page-contract.md` §5, not a readability measurement.
- **Subject close to predicate; long modifiers first.** Japanese predicates come last, so the distance from `〜は` to the verb is what the reader carries. Put long modifying clauses before short ones and place commas at the clause boundary, not for breath.
- **No nested parentheses.** One parenthetical note per sentence at most; a second one becomes a `.wu-terms` entry or its own sentence. The lint's `nested_parentheses` fires at two in one sentence.
- **Concrete nouns over abstract ones.** `側面・観点・重要性・可能性・要素・状況・あり方` and their kin are what `low_specificity` counts. Test a paragraph by deleting every name, number, and example: if the meaning survives, the paragraph is not yet saying anything.
- **Vary the openings and the length.** Six sentences starting with the same two morphemes is the `repeated_sentence_lead` threshold; three in a row is already worth breaking with a 体言止め, a question, or a quotation. Put a short sentence next to a long one.
- **Do not hedge with the sentence ending.** Mark uncertainty with a label (`【要確認】`, `〜と推定する`) and state the rest plainly. Facts carry a source; opinions carry `筆者は`.
- **One register per page.** `です・ます` or `である`, not both.

## 3. Prohibitions

Each of these is a shape the reader recognises before reading a word of it, and once recognised, the content behind it is skimmed or skipped. Sources: the points on which the reference skills agree (参照 skill の一致点), and the redundancy and seductive-details findings of the learning-science literature (Ayres & Sweller; Sundararajan & Adesope).

- **A repeated generic label with a colon** — `<p><strong>決定:</strong> …` on item after item. Why: the label restates what the line already is, and three of them read as a form being filled in (参照 skill の一致点). Put what the label names into the heading or the prose. self-check `label-repeat` warns at three of the same label.
- **Groups of exactly three used as a template** — three reasons, three examples, three bullets, every time. Why: three reads as a mould filling itself, not as a count that came from the material (参照 skill の一致点). Use the number the material has.
- **Summary signal phrases** — `結論から言うと`, `まとめると`, `以下に示す`, `本節では`. Why: the phrase announces a summary instead of being one; the first sentence of the paragraph should already be the summary (参照 skill の一致点). lint `forbidden_phrase` warns on each.
- **The same sentence mould three times in a row** — `X は Y である。A は B である。C は D である。` Why: the reader stops parsing after the second and reads the third as noise (参照 skill の一致点). Break the run with a 体言止め, a question, or a different length.
- **Prose that restates a figure** — a paragraph walking through what the diagram already shows. Why: text that duplicates a picture costs attention twice and lowers comprehension (Ayres & Sweller, redundancy effect). Let the figure carry it; write only what the figure cannot say.
- **Decorative figures** — a diagram placed because the section looked bare. Why: a figure with no mechanism to show pulls attention away from the argument (seductive details). Draw a figure only where a type fits — see `kinds.md`, 図が効く場面.

## 4. List, table, figure, or prose

| Use | When | Not when |
|---|---|---|
| Prose | The items are linked by cause, sequence, or contrast — anything you would connect with `そのため` or `だが` | Three or more independent items with identical shape |
| List | Items are truly parallel: same grammar, same abstraction level, no relation between them worth a sentence (decisions with owner and date, steps) | Explaining why something happened |
| Table | Two or more attributes per item, and the reader will compare across rows (`.wu-compare`, up to 4 columns). A comparison table of options only when there are 3 or more options and 3 or more criteria; below that, name the rejected option in the prose | A single column of text — that is a list |
| Figure | Parts and the routes between them, state transitions, a before/after of a structure | Wording, numbers, or anything a sentence says faster |

## 5. Terminology

- Explain the mechanism first, then hand over the name: `GPS で現在地を取り、最寄りの避難所までの経路を音声で案内する。この機能を「避難誘導モード」と呼ぶ。`
- Define each term once, in `.wu-terms` (`<dt>` name, `<dd>` one line), when three or more terms appear for the first time. Then use exactly that spelling everywhere — no switching between `リトライ` / `再試行` / `retry` on the same page.
- Do not paraphrase body text into `.wu-terms`; it holds definitions only.
- Keep engineering loanwords the way engineers say them — katakana or English: バージョン, トレードオフ, スコープ, コントラスト, レンダラー, シングルソースオブトゥルース, タイプ (of a figure). Do not "translate" them into kanji (版, 正本, 索引, 型, 走査): the reader then has to translate them back. Native Japanese words are fine where they are the everyday word (決定, 根拠, 却下).

## 6. `.wu-summary`

Three to five lines, conclusions first. Line 1 is the decision or finding; line 2 the number or fact that supports it; the rest give scope and what is still open. No preamble (`本稿では〜`), no signal phrase (§3), no restating the title.

```html
<div class="wu-summary">
  <p>通知はポーリングをやめ、サーバー送信イベントで配信する。
  現行方式は毎分 1,200 回の問い合わせのうち 98% が「変化なし」を返していた（8 月 12 日計測）。
  WebSocket は双方向が不要なため見送り。6 タブ以上での接続上限は 9 月の実装時に確認する。</p>
</div>
```

## 7. A decision

In a 決定記録 a decision is not a card. It is an `h3` whose text is the decision itself, then a first paragraph that is one unlabeled summary sentence, then prose, then a `.wu-meta` line (`kinds.md` has the full skeleton).

- **The summary sentence** follows the Y shape — 局面 / 選んだ / 捨てた / 得る / 受け入れる — in natural Japanese: `障害時に再試行が集中する局面で、固定間隔ではなく指数バックオフを選び、負荷の分散を得て、実装コストの増加を受け入れる。` It may be two sentences when one would pass 80 characters. No label in front of it.
- **The prose** says why the chosen option wins and names the rejected option inside the sentence (`固定間隔は…だが、…`), not in a separate labelled line and not in a table unless §4's 3 × 3 condition holds.
- **The basis** is a `.wu-meta` line: a path, a URL, or an agreement date (`2026-08-12 合意`). A claim without one is an opinion and goes back to the prose with `筆者は`.

```html
<h3 id="d2">通知の配信はサーバー送信イベントにする</h3>
<p>ポーリングの 98% が空振りする局面で、WebSocket ではなくサーバー送信イベントを選び、サーバーの空回りを減らし、プロキシ設定の変更を受け入れる。</p>
<p>WebSocket は双方向通信が要る場面には向くが、通知は一方向で足りる。…</p>
<p class="wu-meta">docs/measure/2026-08-12-polling.md / 2026-08-14 設計会で合意</p>
```

The `.wu-decision` card (決定 / 重視したトレードオフ / 根拠・補足, `components.md`) stays for a design doc that records one or two decisions in passing, and for comparable parallel items. Never use it for the list of decisions in a 決定記録 — self-check `decision-cards` warns at three.

## 8. Before / after

Before (one sentence, nested parentheses, abstract nouns, hedged ending):

> 本機能の重要性を踏まえ、さまざまな観点（性能（特に応答時間）や保守性など）から検討した結果、現行方式には課題があると考えられるため、方式の見直しが必要になる可能性があると思われます。

After (conclusion first, one idea per sentence, a number, a label for the unknown):

> 通知の配信方式を変える。現行のポーリングは毎分 1,200 回の問い合わせの 98% が空振りだった（8 月 12 日計測）。応答時間への影響は【要確認】で、9 月の実装時に測る。

## 9. Before publishing

Read only the headings and the first sentence of each paragraph. The argument must hold from that alone. Then run `node bin/lint.mjs <file>` and decide each finding: fix it, or keep it with a reason in `.writeup.toml` `[[allow]]`.
