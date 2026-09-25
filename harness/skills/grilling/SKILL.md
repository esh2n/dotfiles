---
name: grilling
description: Relentless design interview that grills a plan, spec, or decision until you and the user reach shared understanding. Use when the user types /grilling, says "grill me", "詰めて", "この決定を深掘りして", "設計を詰めたい", "プランの穴を突いて", "この判断をストレステストして", or hands over a draft design and asks what is missing. Not for writing the document itself — a 決定記録 or any page that is kept and revisited belongs to writeup, even when the request says 決定記録, a quick in-chat view (use show-me), or a beginner picture explainer (use eli5).
metadata:
  namespaces: [practice]
---

# grilling

Target: $ARGUMENTS

## 1. Purpose

Grill a plan / design / decision until shared understanding is reached.

Do not move to implementation or planning until the user explicitly confirms
"共通理解に達した" (shared understanding reached). Moving on with a half-formed
agreement is this skill's only failure mode.

## 2. Input

- **Target** — text or a file path. When omitted, use the design discussed most recently in the conversation.
- `--out <path>` — where the decision record is written. sdd's `spec/requirements.md`, any md in a product's own SDD, or omitted (= chat only).
- `--hints "..."` — angles passed by a calling skill. Use them as the initial seed of the frontier.

## 3. Design tree and frontier

Hold the target as a **decision tree**. Node = something to decide; edge = "B cannot be decided until A is".

- **frontier** = nodes whose prerequisites are all resolved and which are still undecided. Every question you ask must come from the frontier.
- On an answer, mark the node `decided` and add the new open nodes that answer created as its children.
- **Depth first.** Dig one branch until the insight runs out, then move to the next. Do not hop between topics.
- Record the tree in every round document (§8).

## 4. Facts are investigated, not asked

Whatever can be learned by reading code, environment, config, or docs, **do not ask the user**.

- Delegate investigation to subagents (`Explore` or `general-purpose`, model sonnet). Bundle several questions into one parallel batch.
- Pull questions that depend on a fact still under investigation off the frontier until the result is back.
- Ask the user **only for decisions that involve a choice or trade-off**. Not "what do you want?" but "which of A and B do you give up?".
- Push back on soft or vague answers: "which of the two do you mean?", "what breaks if that assumption fails?", "where does that number come from?". Do not agree and move on.
- When a frontier node touches external calls, queues/topics, metrics, or health checks, have the investigating subagent `ls` `~/.claude/skills/*/references/review-checklist.md`, then read the `## trade-offs` section of each one that exists and the SKILL.md sections it points to. Build the question's options and gains/losses from those sections and cite them in the form `~/.claude/skills/resilience-patterns/SKILL.md § Circuit breaker` (follow §5's internal-document citation format). Skip this step when no checklist exists.

## 5. Sources

- When a recommendation cites external literature (official docs, papers, authoritative design guides), have a sonnet subagent WebFetch it and confirm **the URL exists and the passage says what is claimed** before citing.
- Never write a source you could not verify. A quote from memory is not a source.
- **When an external document (an internal wiki page, a ticket, meeting minutes) is
  the basis, never reference it by identifier alone.** Assume the reader does not
  know the document, and write inside the question: the URL, who wrote it (in what
  role) and when, what it says (2–3 plain lines), and why it matters to this
  question (what it contradicts / what it decides). A bare number or abbreviation
  plus "it says so in ..." leaves the reader unable to judge.
- When the other side's document and your own decision conflict, state that fact
  in the question body and draw "where they conflict" in the diagram.
- Cite evidence inside the repo as `path:line`, down to the line number.

## 6. Channels

Where the questions go. `local` and `artifact` both put out **one page per round**
(**3–6** frontier questions). In both, the main session writes **only the round
document**; HTML generation is delegated to a **sonnet subagent**. Never hand-write
HTML or SVG.

The renderer lives outside the skill at `$DOTFILES_ROOT/harness/tools/grilling-render/`
(below, `<render>` = `${DOTFILES_ROOT:-$HOME/dotfiles}/harness/tools/grilling-render`).
`<render>` picks the round's HTML design on its own: when writeup-kit exists in the
sibling directory (`$DOTFILES_ROOT/harness/tools/writeup-kit`) it rides on
that page design and its diagram checks (`bin/lib/verify-diagram.mjs`); otherwise it
falls back to grilling's own `template/style.css` and `lib/diagram.mjs`. The caller
need not care which is in use (see `<render>/README.md`).

Fallback order is **local → artifact → chat**. On any machine with a browser,
including when called from codex, always local. artifact only when the user wants to
share, answer from another device, or asks for it. chat is the last resort when
rendering is unavailable.

If company traces are found (an internal-domain remote, an internal org, internal
tool names, internal jargon), **do not use artifact** (it publishes to an external
service). local renders locally and sends no data out, so it is fine even with
company traces. When unsure, **ask once**.

### local (default; any machine with a browser)

Finish these two before serving. Both are spots that actually got stuck in a sandbox.

1. **Materialize the renderer.** If `<render>/node_modules` is missing,
   `pnpm install` is needed, but when `~/.claude/skills` is a symlink into dotfiles
   the target is not writable and it fails with `EPERM` (same with a `!` prefix).
   In that case copy the whole `<render>` into the scratchpad, `pnpm install` there,
   and use the copy's `render.mjs` from then on. Do not ask to lift the sandbox.
2. **Render and validate without serving.** Confirm
   `node <render>/render.mjs <round.md> -o <scratchpad>/round-<n>.html`
   exits 0 before serving. Exit 2 is a schema violation; the typical case is a
   diagram label containing `: ` written bare, such as `A: push`
   (YAML reads it as a nested mapping). Always quote labels containing `: `.
   Handing serve to a subagent without validating first leaves only a hanging
   wait: even if it exits immediately, the result never comes back.

Serve with `node <render>/render.mjs serve <round.md> --no-open`.
Inside a sandbox `open` never reaches the browser, so do not rely on auto-open;
relay the URL from stderr to the user right away (the reliable way is a
`run_in_background` Bash in the main session that dumps stderr to a scratchpad file
and reads it. Delegated to a subagent, the URL comes back only after every
question is submitted).

**Keep the URL the same across rounds.** The user wants to reopen one URL and keep
answering, not receive a different port each round. With `--port` omitted, `serve`
uses a **fixed port derived from the slug** (40000–49999), so rounds with the same
slug always get the same URL. Only when that port is taken by another process does
it fall back to a free one, and it says so on stderr. A different grilling has a
different slug and therefore a different port, so running them concurrently does
not collide.

serve **does not return until every question is submitted**. Copy its returned
summary (`q1: A — …`) verbatim into the `answer:` lines. Answers also persist in
`<same directory as round.md>/answers.jsonl` (last line wins).

### artifact (sharing, answering from another device, or user request)

- Run `render.mjs <round.md> --fragment -o <scratchpad>/round-<n>.html` and
  pass the returned path to the Artifact tool.
- **Pass the same file path every round** to keep the URL (1 slug = 1 artifact).
  Add `capabilities: {artifact: {}}` so input is saved and the session is notified.
- Collect answers by re-reading the artifact (`action: "read"`). Take each `.answer`'s
  `data-choice` and `textarea` value and write them back into the round document as `answer:` lines.
- Once every question has an answer, go to the next round. Overwrite the same artifact.

### chat (fallback)

Ask **one question at a time** in the §7 format and wait for the answer. No page is made.

## 7. Format of one question (chat)

Always use this Markdown. **Do not use AskUserQuestion** (to lay out a reason per option and allow free-text answers). The template labels are Japanese because the page is owner-facing.

```
### ❓ Q[n]: [質問]
**なぜ今この判断か** — 1〜2行
**抽象** — 何を決める問いか（1行）／ **具体** — 実コード・実ファイルの引用 `path:line`
- **A** — 選択肢 — 得るもの／失うもの
- **B** — …
**推奨: [A]** — 重視したトレードオフ: …。根拠: [出典 or path:line]
```

One chat question is **25 lines or fewer**. 2–4 options.

"なぜ今この判断か" (why this decision now) **starts from a concrete example, one
fact per sentence**. Order: "the user specified X. Then Y happened. Under the current
mechanism Z runs. What to do with X at that point is undecided", one event per
sentence. Do not paste wording from other documents; restate in your own words. Two
issues (e.g. two points of conflict) get separate sentences, one point each.

## 8. Round document

Whatever the channel, **at the same time** as asking, write the same content to
`.claude/.cache/grilling/<slug>/round-<n>.md`. Round documents are owner-facing: write their prose in Japanese.

- `<slug>` is lowercase kebab-case derived from the target. Create the directory if missing.
- Outside a project (not a git repo), write under the scratchpad.
- Follow `references/round-format.md`. Write **both** the prose and the machine-readable YAML blocks, and keep them consistent.
- Besides the questions, a round document carries **`## 前提` (that round's context)** and a
  **```diagram block** per question. The renderer (`<render>`) turns both straight into figures and panels.
- **Write for a reader who has not read this conversation.** That includes yourself days
  later and other members. In `## 前提`, start from how the target works — "what, where,
  how it flows" — and define the terms the questions use (subscription, queue, version, etc.) there.
  **Never use** ad-hoc labels coined during the conversation ("案B", "パターン2"). Spell out the content at every reference.
- **`## 前提` is a dictionary to look things up in, not prose to read through.** Do not bury
  terms in long paragraphs (they go unread). Fix the shape to these three:
  1. One lead paragraph (3 lines max): what the target is and what this round decides
  2. A `**用語**` bullet list: one term per line, "name — what it is", 2 lines max. Only terms
     that appear in this round's questions. `path:line` sources go in each question's
     **具体**, not here
  3. A `**決まっていること**` bullet list: one decision per line
  If the whole thing exceeds one screen (25 lines), cut. If it cannot be cut, it is not
  context but something the question itself must explain.
- **When the reader lacks background for a question, write the explanation inside the question.**
  Paragraphs placed after the "なぜ今この判断か" and "抽象／具体" lines render as prose on the
  page. Put there: (1) what the mechanisms involved are, (2) what each party claims,
  (3) a comparison of the options on the same criteria, (4) which trade-off you took to
  reach the recommendation, (5) when another option should be chosen. The premise
  dictionary (above) is for term lookup and does not serve as decision material. Explanation
  written only in chat and left off the page makes a page-only reader defer with
  "no context given" (this has happened).
- **Explanation is not reading material. Structure it into an "explanation".** A stack of
  paragraphs gets deferred with "too long to read; keep the information, structure it"
  (this has happened). Rules: one block is 3 lines max. Separate (1)–(5) with `####`
  subheadings. Comparisons are always GFM tables (row = option, column = same criterion).
  Steps and enumerations are `- ` bullets. Only the core of the judgment gets `**bold**`.
  Split mechanism explanations into one figure per concept (2–3 figures per question is
  fine, e.g. current platform flow / new component structure / route per option). Prose is
  one fact per sentence; no long sentences chained with conjunctions.
- **Limit what one question carries.** Volume and the number of concepts are the main
  causes of confusion. At most one new concept per question. When listing data items,
  give the **purpose** (what it is needed for) first in one line, and drop items with no
  purpose. Do not coin a collective name for several items; write the item names as they
  are. Label options with verbs that let the reader picture them: "hold X / put it in Y /
  translate via Z".
- **Where tables belong.** For comparing several options on the same criteria, or laying
  out how a value changes per situation (row = option or situation, column = criterion).
  Not for explaining one concept or a procedure; use a sentence or bullets. Tables have
  4 columns max, one line per cell. Precede each table with one sentence saying what it compares.
- **Write options as three things: what is built, what passes through where, and what results.**
  "Add a dedicated subscription" alone gives the reader no picture. Only when the component
  built, the route taken, and the consequences for latency and behavior are written does the
  difference between A and B show.
- **Diagrams are the default; omitting one is the exception.** Any question where "what
  passes through where" differs per option — routes, placement, composition, state
  transitions, queues — must have a ```diagram. The reader chooses from the page alone, so a
  structure explained in prose but not drawn is a missing explanation. Omit only for questions
  such as permissions or naming that **fit in one sentence and gain nothing from a picture**,
  and then write that sentence in the prose.
- **Self-check before handing to serve**: for each question ask "if the options were drawn
  side by side, would the difference be visible?"; if yes and it is not drawn, fix it as a
  defect. One figure per question, with the options' difference visible **within the same
  picture** (A's route and B's route as edge labels).
- **Cite earlier rounds' decisions by content, not by number.** "As decided in Q60" means
  nothing to the reader. grep the decision record or round documents for the passage and quote
  the decision sentence verbatim in `## 前提`. The user's memory may differ, so verify the
  user's own statements against the record before putting them in the premise.
  When a decision's premise later changes, state "the premise is gone" and re-ask.
- **Do not turn decided matters into questions.** "Shall we go with this shape?" is a request
  for approval with nothing weighed against anything. Phrase questions as "X or Y?", and open
  each with one line of "what I need decided". Decided content goes in the premise.
- **Questions about design (domain model, DDL, procedures) show code in code blocks.** Go
  structures as real ```go, DDL as real ```sql statements, with the intent per field (why it
  exists, why this name) in a comment on each line. Do not add a separate "intent of names"
  section below (it forces the reader to scroll). Keep domain model and DDL apart as different
  things (DB-only columns, e.g. a tenant id, are not in the domain). Write primary keys,
  indexes, and idempotency keys too.
- **Options say "when to pick this" too.** Under the gains/losses table, put bullets
  "A を取るとき: …" / "B を取るとき: …". The reader maps their situation onto one and chooses.
- **Keep diagrams small.** 6 nodes max per figure, one-line labels. Split long flows by concept.
  A figure that needs horizontal scrolling is a failure.
- **The "具体" line states facts.** A run of `path:line` is where evidence lives, not an
  explanation. Write one sentence on what that line does, e.g. "the current line always carries
  page_id", then append the `path:line`.
- Append the user's answer to the same file as `answer:` and set `status` to `answered`.
- **Do not commit to the repository.** Check that the target project's `.gitignore` contains
  `.claude/.cache/`; if not, add it or tell the user.

## 9. Lifetime of records

- **HTML** — goes to the scratchpad. **Not kept** (`serve` only distributes, never writes a file).
- **Round documents / `answers.jsonl`** — `.claude/.cache/grilling/<slug>/`.
  Only for the duration of the grilling. `answers.jsonl` is spent once copied into `answer:` lines.
- **When the decision record is written**, concatenate the rounds in order into
  `transcript.md` in the same directory and delete the `round-<n>.md` files. The decision
  record's "元ラウンド" points at `transcript.md`.
- **At skill start**, delete slug directories directly under `.claude/.cache/grilling/`
  whose mtime is older than 60 days, and say so in **one line**.

  ```sh
  find .claude/.cache/grilling -mindepth 1 -maxdepth 1 -type d -mtime +60 -exec rm -rf {} +
  ```

- **grilling never writes directly into writeup's store (`~/.local/share/writeup/`).**
  When a decision record is to be kept, always go through the §12 writeup route
  (`decision-page.mjs` → `writeup`'s save flow). grilling itself never places files under the store.

## 10. Ending

Once the frontier is empty and no important branch has an implicit assumption left,
ask "共通理解に達しましたか" (have we reached shared understanding?).

- If asked to continue, add the pointed-out items to the tree as nodes and resume digging.
- Even if told "もう十分" (enough), list any remaining undecided assumptions in one line each before ending.

## 11. Wrap-up phase

1. If 2–3 options are still standing side by side, present a **comparison table** (columns: 案 / 得るもの / 失うもの / 向く状況).
2. Split the decision record into **sections of 200–300 characters** and present them in order. At the end of each, confirm "ここまで合っていますか" (correct so far?).
3. On a mismatch, go back to the §3 tree and re-dig that branch.

## 12. Decision record format

Write to the `--out` file. If the file already has `## 決定記録`, update it; otherwise append. The record is owner-facing and written in Japanese, with these headings verbatim.

```markdown
## 決定記録
### 決まったこと
- [決定] — 重視したトレードオフ: [1行]
### 検討して却下した案
- [案] — 却下理由
### 未決・前提
- [残っている前提と、それが崩れたときの影響]
### 推奨アプローチ
### 出典
- [URL or path:line]
### 次のステップ
### 元ラウンド
`.claude/.cache/grilling/<slug>/transcript.md`
```

**ADR promotion criteria**: hard to reverse / not obvious / a real trade-off — propose a separate ADR only for decisions that meet **all three** (never write one unasked).

### Keeping the decision record (when the user wants it saved)

When the user says they want the `--out` decision record kept as a page, run the following.
grilling itself does not touch the store — from here on it is writeup's procedure.

```sh
node <render>/decision-page.mjs <--out のファイル> --out <scratchpad>/decision.html
```

`decision-page.mjs` converts the `## 決定記録` block (決まったこと / 検討して却下した案 /
未決・前提 / 推奨アプローチ / 出典 / 次のステップ / 元ラウンド) into a writeup-kit
`kind: 決定記録` page and, right after writing it, runs the kit's
`bin/self-check.mjs --write-meta` and reports the result (where writeup-kit is absent, just
say it cannot run). self-check findings (long sentences, nested parentheses, etc.) are
content problems, so trim the decision record's wording if needed and regenerate.

Saving follows writeup's procedure: place it at `<store>/<folder>/<date>-<slug>.html` and go
through `writeup`'s build / commit. grilling stops at producing the `--out` file and
`decision.html`; placing it in the store and committing is writeup's responsibility.

## 13. Use from other skills

Just call `grilling <対象> --out <path> --hints "..."`.

Example (sdd clarify):

```
grilling "spec/requirements.md の要件" --out spec/requirements.md \
  --hints "入出力の形式 / エッジケース / 非機能要件 / 既存コードとの統合点 / スコープ境界"
```

The caller proceeds to the next phase only after grilling reports "共通理解に達した".

From Codex, use `@grilling` (or the /skills menu). `codex/SKILL.md` references the same round-format and render.

## References

- `references/round-format.md` — round document format (the machine-readable source of truth)
- `$DOTFILES_ROOT/harness/tools/grilling-render/README.md` — the renderer that turns a round document into a one-page HTML (including the design used when writeup-kit is present)
- `$DOTFILES_ROOT/harness/tools/grilling-render/decision-page.mjs` — converts a decision-record Markdown into a writeup `kind: 決定記録` page
- Matt Pocock, `grilling` skill — https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling
- ryonakae, `dig` skill — https://github.com/ryonakae/dotfiles/blob/master/config/.agents/skills/dig/SKILL.md
