---
name: grilling
description: Design interview that grills a plan / design / decision until shared understanding is reached. Use when the user says "詰めて", "深掘りして", "設計を詰めたい", "プランの穴を突いて", or hands over a draft design and asks what is missing. Asks only about decisions that involve trade-offs; facts that can be looked up are investigated, not asked.
argument-hint: "<対象> [--out <path>] [--hints \"...\"]"
---

# grilling

Target: $ARGUMENTS (when omitted, the design discussed most recently in the conversation). `--out <path>` is where the decision record is written; `--hints "..."` is the initial seed of angles.

## Role

- Do not move to implementation or planning until the user explicitly says "共通理解に達した" (shared understanding reached). Moving on with a half-formed agreement is the only failure mode.
- Hold the target as a **decision tree**. Node = something to decide; edge = "B cannot be decided until A is".
- **frontier** = undecided nodes whose prerequisites are all resolved. Always pick questions from the frontier. On an answer, mark that node `decided` and add the open nodes it created as children.
- **Depth first.** Dig one branch until the insight runs out, then move to the next. Do not hop between topics.
- Whatever can be learned by reading code, environment, config, or docs: **do not ask, investigate it yourself**. Pull questions that depend on a fact under investigation off the frontier until the result is in.
- Ask the user **only for decisions that involve trade-offs**. Not "what do you want?" but "which of A and B do you give up?".
- Push back on soft answers: "which do you mean?", "what breaks if that assumption fails?", "where does that number come from?". Do not agree and move on.
- Cite sources **only after confirming they exist**. Never write a source you could not verify. A quote from memory is not a source. Cite repo evidence as `path:line`, down to the line number.

## Procedure

1. At start, run `find .claude/.cache/grilling -mindepth 1 -maxdepth 1 -type d -mtime +60 -exec rm -rf {} +` and say in one line what was deleted.
2. Write the round document to `.claude/.cache/grilling/<slug>/round-<n>.md` (`<slug>` is lowercase kebab-case derived from the target; outside a git repo, write under a temporary directory). Round documents are owner-facing: write their prose in Japanese. **Read**
   `${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/harness/skills/grilling/references/round-format.md`
   (`DOTFILES_ROOT` is where dotfiles is checked out)
   first, then follow it. Write both the prose and the machine-readable YAML blocks, and keep them consistent. One round = 3–6 frontier questions. Draw a ```diagram for questions that compare structure (where placement or routes are at stake); one sentence suffices for the rest.
3. Run `node "${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/tools/grilling-render/render.mjs" serve <round.md>`.
   A page opens and the command **does not return until every question is submitted**. Wait for it to finish.
4. Copy the stdout summary (`q1: A — メモ`) verbatim into the round document's `answer:` lines and set `status: answered`. Answers also persist in `answers.jsonl` in the same directory (last line wins).
5. Update the tree and go to the next round. Once the frontier is empty and no important branch has an implicit assumption left, ask "共通理解に達しましたか" (have we reached shared understanding?).
6. If 2–3 options are still standing side by side, present a comparison table (案 / 得るもの / 失うもの / 向く状況). Present the decision record in sections of 200–300 characters, confirming at the end of each. On a mismatch, go back to the tree and re-dig that branch.
7. Write the decision record to the `--out` file (update `## 決定記録` if present, otherwise append). It is owner-facing, in Japanese.

## Channels

- **local (default)** — the `render.mjs serve` above. Use it on any machine with a browser.
  The page design rides on writeup-kit when it exists at `$DOTFILES_ROOT/domains/dev/llm/tools/writeup-kit`,
  otherwise it falls back to grilling's own design
  (the caller need not care).
- **chat (fallback)** — ask one question at a time in the format below and wait for the answer. No page is made. 25 lines max per question, 2–4 options.

```
### ❓ Q[n]: [質問]
**なぜ今この判断か** — 1〜2行
**抽象** — 何を決める問いか（1行）／ **具体** — 実コード・実ファイルの引用 `path:line`
- **A** — 選択肢 — 得るもの／失うもの
- **B** — …
**推奨: [A]** — 重視したトレードオフ: …。根拠: [出典 or path:line]
```

If company traces are found (an internal-domain remote, an internal org, internal tool names, internal jargon), use chat. When unsure, ask once.

## Decision record format

Under `## 決定記録` write `### 決まったこと` (decision — one line on the trade-off prioritized) / `### 検討して却下した案` (option — reason rejected) / `### 未決・前提` (remaining assumptions and the impact if they fail) / `### 推奨アプローチ` / `### 出典` (URL or path:line) / `### 次のステップ` / `### 元ラウンド` (`.claude/.cache/grilling/<slug>/transcript.md`).
Hard to reverse, not obvious, a real trade-off — propose an ADR only for decisions that meet **all three** (never write one unasked).

When the user wants it saved, run `node "${DOTFILES_ROOT:-$HOME/dotfiles}/domains/dev/llm/tools/grilling-render/decision-page.mjs" <--out のファイル> --out <path>.html` to
convert it into a writeup-kit `kind: 決定記録` page and hand it to writeup's save procedure (placement in the store, commit).
grilling itself never writes into the store.

## Lifetime of records

- Do not keep the HTML (`serve` only distributes, never writes a file).
- When the decision record is written, concatenate the rounds in order into `transcript.md` and delete the `round-<n>.md` files.
- Clean up slug directories older than 60 days at start (step 1). Never commit to the repository.
