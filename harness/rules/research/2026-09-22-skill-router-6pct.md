---
question: "jig skill router — why is the skill-injection follow rate only 6%, and should skills be hidden behind an external judgment-service router at this catalog size?"
date: 2026-09-22
verdict: "The surveyed evidence does not support hiding skills behind an external judgment-service router at 54-88 skills: scale mismatch (4,462 tokens, zero truncated, well under every vendor's native listing budget), no vendor recommends it, the practitioners who tested this exact design reversed it, the one rigorous measurement produced no usable number, and it is structurally close to the opposite of the strongest pro-large-library result (Tool Search Tool)."
unverified: []
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# jig skill router — why the follow rate is 6%

Investigation date: 2026-09-22. Read-only: no config, transcript or repo file was modified.
Window: last 30 days (2026-08-15 → 2026-09-22). All numbers reproduced locally.

---

## Part 1 — Are skills hidden from Claude Code's listing?

### Conclusion (stated first)

**No. All 54 routable skills are listed to the model, with full descriptions, in every
session.** The design intent — "skills are NOT listed, jev picks one per prompt" — is not
implemented on this machine. The router's injection is therefore an *addition* to a listing
that was never removed, not a replacement for it.

The strongest single piece of evidence is first-hand: the session that ran this
investigation received a skill listing containing `writeup`, `eli5`, `show-me`,
`code-review-discipline`, `systematic-debugging`, `natural-japanese`, `cost-tracking`,
`code-graph-exploration` and every other skill in the catalog, each with its full
description text. The model can see them; it does not need the router to know they exist.

### Local facts

| Fact | Value | How established |
|---|---|---|
| `~/.claude/skills` | symlink → `~/.claude/.skills-merged` | `ls -la ~/.claude` |
| Entries in `.skills-merged` | 57 directories | `ls -d */ \| wc -l` |
| Of those, valid routable skills | **54** | jig `readSkillCatalog`; report header says `skills (54)` |
| Excluded: `disable-model-invocation: true` | **2** — `prompt-save`, `workday-input` | frontmatter scan |
| Excluded: no `SKILL.md` | 1 — `synced` | frontmatter scan |
| Skills setting `user-invocable:` | **0** | `grep -rn "^user-invocable" */SKILL.md` → no matches |
| `skillOverrides` in `~/.claude/settings.json` | **absent** | top-level keys are `env, enabledPlugins, hooks, cleanupPeriodDays, model, language, theme, effortLevel, preferredNotifChannel, skipWorkflowUsageWarning, agentPushNotifEnabled, switchModelsOnFlag, statusLine, extraKnownMarketplaces, permissions, mcpServers, autoMode` — no `skillOverrides` |
| Approx. listing cost (these 54 only) | **17,848 chars ≈ 4,462 tokens/session** | sum of name + `description` + `when_to_use`, 1,536-char cap applied |
| Largest listing entries | `writeup` 772 ch, `eli5` 768, `natural-japanese` 705, `css-cascade` 569 | same scan |
| Descriptions exceeding the 1,536-char cap | 0 | none of the 54 are truncated |

Note the "88" in the brief counts everything the session lists — 54 personal skills **plus**
plugin skills (`claude-mem:*`, `anthropic-skills:*`, `crit:*`), Anthropic's bundled skills
(`artifact-design`, `dataviz`, `code-review`, `run`, …) and slash commands. jig's router only
ever sees and routes the 54 under `~/.claude/skills`. The plugin and bundled skills are
outside the router entirely, and per the docs `skillOverrides` cannot touch plugin skills at
all ("Plugin skills are not affected by `skillOverrides`. Manage those through `/plugin`").

### Doc evidence (https://code.claude.com/docs/en/skills.md, fetched 2026-09-22)

The sentence that settles it:

> "In a regular session, skill descriptions are loaded into context so Claude knows what's
> available, but full skill content only loads when invoked."

And the frontmatter table, which shows the *only* two frontmatter switches and what each does:

| Frontmatter | You can invoke | Claude can invoke | When loaded into context |
|---|---|---|---|
| `disable-model-invocation: true` | Yes | No | **Description not in context**, full skill loads when you invoke |
| `user-invocable: false` | No | Yes | **Description always in context**, full skill loads when invoked |

> "**Hide individual skills** by adding `disable-model-invocation: true` to their
> frontmatter. This removes the skill from Claude's context entirely."

So `disable-model-invocation: true` is the switch that implements the owner's intent — and it
is set on exactly 2 of 56 skills, neither of which the router routes (both are excluded from
the catalog *because* they set it).

The settings-side switch, `skillOverrides`:

> "The `skillOverrides` setting controls skill visibility from your settings instead of the
> skill's own frontmatter."

| Value | Listed to Claude | In `/` menu |
|---|---|---|
| `"on"` | Name and description | Yes |
| `"name-only"` | Name only | Yes |
| `"user-invocable-only"` | **Hidden** | Yes |
| `"off"` | **Hidden** | Hidden |

> "A skill that is absent from `skillOverrides` is treated as `"on"`."

`settings.json` has no `skillOverrides` key, so all 54 are `"on"` — name **and** description.

On the listing budget (relevant to the router's stated motive):

> "The listing always contains every skill name, but if you have many skills, Claude Code
> shortens descriptions to fit the listing's character budget… The budget scales at 1% of the
> model's context window. When the listing overflows, Claude Code drops descriptions starting
> with the skills you invoke least, so the skills you use most keep their full text."

> "each entry's combined text is capped at 1,536 characters regardless of budget"

At 17,848 chars for the 54 personal skills, **no description is truncated** (0 entries hit
the 1,536-char cap, and nothing is being dropped), so on this machine the specific
degradation the docs describe — "Claude Code shortens descriptions to fit the listing's
character budget, which can strip the keywords Claude needs to match your request" — is not
currently occurring for these skills. This figure excludes plugin and bundled skills, which
also occupy the listing and were not measured.

### pi and Codex

- **pi** — `~/.agents/skills` exists and holds **53** symlinks to the same repo skill
  directories. jig's own report confirms pi is live (191 pi turns in the window, 6 followed,
  1 ignored, 4 unscouted), and the router writes a `custom_message` with
  `customType: "jig-skill-router"` for pi. Whether pi loads all 53 descriptions at session
  start was **not** established from pi's own docs in this investigation — see "what the data
  cannot tell".
- **Codex** — also reads `~/.agents/skills` (same 53). The 2% / 8,000-character budget and
  auto-shortening were not verified against a Codex primary source here; that verification is
  in Part 4.

### `/skill-doctor`

Not run. The docs say it "requires Claude Code v2.1.252 or later", opens in the `/plugin`
manager's **Stats** tab interactively, and in non-interactive mode prints as text under
`claude -p`. Running `claude -p` is barred by standing instruction (metered-billing
concern), and the interactive path needs a live session. **Skipped; stated as skipped.**
Its numbers would be the closest native analogue to jig's report and are the obvious
cross-check if it can be run by hand.

---

## Part 2 — What happens on the 209 injected turns

### Reproduction

`bun src/cli/jig.ts report skills --days 30`:

```
turns read: 7972 (2026-08-15 08:17 → 2026-09-22 13:54), 3406 session files
  turns                   7972  100%
  followed an injection     12    0%
  ignored the injection    203    3%
  opened another skill       0    0%
  opened one unscouted      69    1%
  no skill involved       7688   96%
by harness: pi 191 (6 followed, 1 ignored, 4 unscouted) / claude 7781 (6 followed, 202 ignored, 65 unscouted)
```

An independent re-implementation of `parseSkillTurns` over `~/.claude/projects/**/*.jsonl`
only (Claude Code, no pi) reproduces the Claude half: 7,803 turns, **209 injected**, 6
followed, 203 ignored, 65 unscouted. The parser is faithful; the numbers are not a bug in
the report's arithmetic.

### How "followed" is defined (`src/domain/skills/usage.ts`, `src/infra/transcripts/transcript.ts`)

- A turn is `followed` when **every** injected skill name appears in `turn.read`.
- `turn.read` is built **only** from `Read` tool calls whose `file_path` resolves to a known
  skill directory (`readPathsOf`: `if (call.name !== "Read") continue`). pi's equivalent is
  the `read` tool.
- **The `Skill` tool is not counted at all.** Neither is a shell read (the module comment
  says so explicitly: "A body read through a shell (`cat`, `sed`, `grep`) is not a tool call,
  so it is not counted").

### What the injection actually looks like

From `src/cli/hooks/user-prompt-submit.ts::reminder()`:

```
jig skill router: 1 skill matches this request (judgment confidence 0.91).
Read and follow these before doing the work:
- "writeup": ~/.claude/.skills-merged/writeup/SKILL.md
```

It arrives as `hookSpecificOutput.additionalContext` and is recorded in the transcript as an
`attachment` entry of type `hook_additional_context`. **All 209** injected turns have
non-empty injection text present in the transcript. Mean size **207 characters**.

### The finding that explains the rate: 80% of routed "prompts" are not user prompts

Classifying the 209 injected turns by what the prompt actually was:

| Prompt provenance | Turns | Followed | Ignored | Follow rate |
|---|---:|---:|---:|---:|
| Hook-event feed (`[MESSAGE FROM NON-USER SOURCE - NOT USER INPUT]`, tool-event replay) | 82 | 0 | 82 | **0.0%** |
| Agent-to-agent message (`Another Claude session sent a message` / `[Subagent hand-back]`) | 48 | 1 | 47 | 2.1% |
| **Real user prompt** | **42** | **5** | **37** | **11.9%** |
| Compaction / session summary (`Below is a conversation log…`, `This session is being continued…`) | 36 | 0 | 36 | **0.0%** |
| A skill body replayed as a prompt (`Base directory for this skill: …`) | 1 | 0 | 1 | 0.0% |
| **Total** | **209** | **6** | **203** | 2.9% |

**167 of 209 (80%) of the router's injections landed on machine-generated text**, most of
which cannot follow anything — a compaction summarization pass has no tool loop, and a
hook-event replay is a notification, not a request. The headline 6% is a denominator
artifact as much as a behaviour finding.

On the 42 genuine user prompts the follow rate is **5/42 = 11.9%** (6/42 = 14.3% if the
`Skill` tool is counted). Still low, but four times the headline.

The single worst case: `writeup` was injected 103 times and ignored 100 times. A large share
of those are compaction prompts — the judgment model reads *"Below is a conversation log from
a Claude Code coding session. Create a summary…"*, correctly notices "create a summary", and
fires the `writeup` skill (confidence 0.80–0.91) at Claude Code's internal compactor.

### Sample table

**All 6 followed turns (Claude Code):**

| When | Skill | Conf | Prompt (≤105 chars, redacted) | What happened |
|---|---|---|---|---|
| 09-20 04:06 | cost-tracking | 1.00 | これまでにかかったコストをモデル別に見せて | Read the SKILL.md, then Bash |
| 09-20 05:22 | strategic-compact | 0.98 | ストラテジックコンパクトをしましょう。 | Read + Edit |
| 09-20 08:02 | cost-tracking | 0.97 | いや、私は費用の数字そのものも見たいですよ。…損益分岐点も見たいです | Read, Agent, Edit, SendMessage |
| 09-20 08:12 | code-review-discipline | 0.89 | (pasted) 1. 何を決めようとしているのか …「モデルに毎回見せているスキルの一覧をやめて…」 | Read + Bash + Edit |
| 09-21 08:46 | code-review-discipline | 0.82 | `[Subagent hand-back]` report relay | Read + Agent |
| 09-22 03:41 | writeup | 0.91 | いくつか調査したと思うので結果をまとめて htmlで。 | Read + Bash + Write |

Pattern: **every followed turn is a short, explicit, single-intent user request** — and in 5
of 6 the request names the skill's own subject matter almost literally ("コスト", "ストラテジ
ックコンパクト", "まとめて html で").

**35 ignored turns, spread across the window** (prompt truncated to ~105 chars, personal
content redacted; `tools` = distinct tools used in the turn):

| When | Injected | Conf | Prompt | Model's next move |
|---|---|---|---|---|
| 09-20 04:10 | cost-tracking | 1.00 | ルーター計測マーカー778899。これまでにかかったコストをモデル別に見せて | **`Skill(cost-tracking)`** — obeyed, uncounted |
| 09-20 05:29 | strategic-compact | 0.83 | `[NON-USER SOURCE]` memory-agent note | **`Skill(strategic-compact)`** — obeyed, uncounted |
| 09-20 04:06 | cost-tracking | 0.99 | `Base directory for this skill: …/cost-tracking` (skill body as prompt) | Monitor, ToolSearch |
| 09-20 07:55 | systematic-debugging | 0.81 | `[NON-USER SOURCE]` Bash event replay | no tools |
| 09-20 12:02 | writeup | 0.92 | `[NON-USER SOURCE]` Agent event replay | no tools |
| 09-20 12:07 | writeup | 0.80 | `<task-notification>` subagent completion | SendMessage |
| 09-20 12:53 | skill-stocktake | 0.80 | 以前ローカルモデルの比較のため…推奨してくれたモデル何でしたっけ | no tools (recall question) |
| 09-20 14:05 | code-review-discipline, writeup | 0.91 | (pasted) 調べた範囲 cc の外も含めて5方向… | no tools |
| 09-20 14:22 | writeup | 0.87 | `Below is a conversation log…Create a summary` | **compaction** — no tools |
| 09-20 14:37 | natural-japanese | 0.85 | (pasted) [床] ハーネス自前の床… | no tools |
| 09-20 14:42 | writeup | 0.82 | 説明が下手…設計ドキュメントをもとに肉付けして | Edit, Write (did the work, no skill) |
| 09-21 05:11 | natural-japanese | 0.80 | 「薄い壁」変に訳すなよ | no tools (answered in prose) |
| 09-21 05:54 | systematic-debugging | 0.82 | (pasted) shell transcript of a failing command | no tools |
| 09-21 06:03 | systematic-debugging | 0.80 | (pasted) `sbx run` output | no tools |
| 09-21 06:32 | code-review-discipline | 0.86 | 良きが正しいという前提はやめて…ジグの正しさで考えて | no tools |
| 09-21 08:24 | writeup | 0.84 | `[NON-USER SOURCE]` Bash event | no tools |
| 09-21 08:48 | writeup | 0.84 | `[Subagent hand-back]` relay | Artifact, Bash |
| 09-21 08:52 | writeup | 0.86 | `[NON-USER SOURCE]` Bash event | no tools |
| 09-21 10:48 | writeup | 0.89 | `Below is a conversation log…` | **compaction** — no tools |
| 09-21 10:54 | golang-testing | 0.86 | `[NON-USER SOURCE]` Write event | no tools |
| 09-21 11:06 | writeup | 0.91 | `Below is a conversation log…` | **compaction** — no tools |
| 09-21 11:10 | go-concurrency | 0.82 | `[NON-USER SOURCE]` SubagentHandback event | no tools |
| 09-21 11:20 | code-review-discipline | 0.85 | Mc2Discordでもいいよ軽くならこっちの方が良さそう | Bash, Edit |
| 09-21 11:24 | systematic-debugging | 0.85 | `[NON-USER SOURCE]` Bash event | no tools |
| 09-21 11:26 | systematic-debugging | 0.88 | `[NON-USER SOURCE]` Bash event | no tools |
| 09-21 11:36 | systematic-debugging | 0.83 | `[Image: …CleanShot…]` screenshot paste | no tools |
| 09-21 15:03 | natural-japanese | 0.87 | 日本語にするとわかりにくいです | no tools |
| 09-21 16:03 | writeup, code-review-discipline | 0.84 | `<task-notification>` | no tools |
| 09-21 16:08 | code-graph-exploration | 0.85 | rulesyncはよんでます？？関数レベルまで | Agent (delegated instead) |
| 09-21 16:30 | writeup | 0.83 | ワークフローだけじゃないよ | no tools |
| 09-22 02:32 | writeup | 0.88 | `[NON-USER SOURCE]` Agent event | no tools |
| 09-22 02:45 | writeup | 0.89 | `Below is a conversation log…` | **compaction** — no tools |
| 09-22 02:50 | writeup | 0.80 | `[NON-USER SOURCE]` MODE SWITCH: PROGRESS SUMMARY | no tools |
| 09-22 02:57 | golang-testing | 0.90 | `[NON-USER SOURCE]` Write event | no tools |
| 09-22 03:06 | systematic-debugging | 0.86 | `[Subagent hand-back]` relay | Bash, Read |
| 09-22 03:08 | code-review-discipline | 0.84 | `[NON-USER SOURCE]` SubagentHandback event | no tools |
| 09-22 04:28 | writeup | 0.80 | `[NON-USER SOURCE]` Bash event | no tools |
| 09-22 04:37 | writeup | 0.81 | `[Subagent hand-back]` relay | AskUserQuestion |
| 09-22 05:56 | writeup | 0.80 | `[NON-USER SOURCE]` WebFetch event | no tools |
| 09-22 06:27 | writeup | 0.89 | `Below is a conversation log…` | **compaction** — no tools |

Tool usage across all 203 ignored turns (turn-distinct): no tools at all **144**; Bash 30,
Read 21, Agent 11, Write 9, Edit 8, ToolSearch 5, SendMessage 5, **Skill 3**, Artifact 2,
AskUserQuestion 2, Monitor 1, ScheduleWakeup 1.

Of the 144 no-tool ignored turns, 135 do have at least one assistant entry and 128 have a
non-empty assistant text block — so they are genuine prose-only replies, not truncated
records. Only **9** turns have no assistant entry at all (interrupted / no reply).

### Hypothesis verdicts

**H1 — the injection is not reaching the model.** **REFUTED.**
209/209 injected turns carry a non-empty `hook_additional_context` attachment in the
transcript, which is the model-visible carrier. Mean length 207 chars, none truncated. The
3 turns where the model called `Skill(<the injected skill>)` immediately after the injection
are positive proof it was read and acted on. The hook output is reaching the model.

**H2 — the injected text doesn't tell the model how to open the skill.** **REFUTED as
stated, but with a real defect underneath.**
209/209 injections contain an absolute filesystem path
(`- "writeup": ~/.claude/.skills-merged/writeup/SKILL.md`), so "it can't follow"
is false. **However, 0/209 name the `Skill` tool** — and the `Skill` tool is the harness's
own, cheaper, native way to load a skill. The reminder steers the model toward `Read`, which
is the only thing the report counts; 3 turns show the model preferring `Skill` anyway and
being scored as a miss for it. So the wording is *consistent* with the metric but not with
the harness. This is a measurement/wording mismatch, not a delivery failure.

**H3 — the chosen skill is wrong for the prompt.** **SUPPORTED for the machine-generated
majority; UNDETERMINED for real user prompts.**
167/209 (80%) of injections fired on text that is not a user request: 82 hook-event replays,
48 agent-to-agent relays, 36 compaction prompts, 1 skill body echoed back. On those the pick
is wrong *by construction* — there is no request to match. The clearest case is `writeup` at
0.80–0.91 confidence on Claude Code's own compaction prompt ("Create a summary to help the
next session"), 36 times. On the 42 real user prompts the picks read as plausible by eye
(`natural-japanese` on 「日本語にするとわかりにくいです」, `systematic-debugging` on a pasted
failing shell transcript) — plausible, but this investigation has no ground-truth label for
"the right skill here", so plausibility is not a measurement. Undetermined on that slice.

**H4 — the model judged the skill unnecessary for a small task.** **SUPPORTED, and it is the
second-largest effect.**
144/203 ignored turns used **no tools at all**, and 128 of those produced a normal prose
reply. These are turns the model answered by talking — an opinion, a short correction, a
notification acknowledgement. Reading a 1–15 KB SKILL.md to write two sentences is a cost the
model declined.

But this effect is **mostly an artifact of H3, and it largely does not survive the
denominator fix**: restricted to the 42 real user prompts, only **13 of the 37** ignored
turns (35%) used no tools. The other 24 real-user ignored turns did real work — Bash, Edit,
Write, Agent — and simply did not open the skill they were told to open. So "the task was too
small" explains the machine-prompt bulk, not the real-user misses. On real user prompts the
dominant ignored shape is *the model did the work its own way*, which none of H1–H5 names.

**H5 — "followed" is under-counted by the report's definition.** **SUPPORTED, but small —
it explains 3 turns, not 198.**
Three sub-tests:
- *Skill tool instead of Read*: `readPathsOf` only counts `name === "Read"`. Across the whole
  transcript tree there are **1,208 `Skill` tool invocations, of which the report counts
  zero**. But within the 209 injected turns only **3** used `Skill`, and all 3 matched the
  injected skill. Recounting with `Skill` + shell reads moves the totals from
  6 followed / 203 ignored to **9 followed / 200 ignored** — from 2.9% to 4.3%. Real, tiny.
- *Opened in a later turn*: **22/203** ignored turns had their injected skill opened later in
  the same session. If a delayed open counts as following, follow rises to 28/209 = 13%. This
  is generous — a later open may be unrelated — so treat 22 as an upper bound.
- *Overall skill-usage undercount*: counting `Skill` calls moves `unrouted` from 65 to 150,
  i.e. **85 turns where the model used a skill entirely through the `Skill` tool and the
  report saw nothing**. The report substantially understates how much skills are used on this
  machine, even though it barely changes the follow rate.

**Summary of hypothesis accounting on the 203 ignored turns (categories overlap):**

| Cause | Turns | Share |
|---|---:|---:|
| Fired on machine-generated text (H3) | 166 | 82% |
| Model answered without tools (H4) | 144 | 71% |
| — of which also machine-generated | 131 | 65% |
| Real user prompt, model did the work its own way without the skill (unnamed by H1–H5) | 24 | 12% |
| Injected skill opened later in session (H5b) | 22 | 11% |
| Obeyed via the `Skill` tool, uncounted (H5a) | 3 | 1.5% |
| Injection missing/truncated (H1) | 0 | 0% |
| Injection lacked a path (H2) | 0 | 0% |

### Cost of the router over 30 days

| Measure | Value |
|---|---|
| Prompts the router judged (router log, 30d) | **1,708** |
| Of those, something was injected | 282 (17%) — 209 land in Claude Code transcripts |
| Total injected characters (Claude transcripts) | **43,456** |
| Approx. injected tokens (chars/4) | **~10,864 over 30 days** |
| Mean per injection | 207 chars ≈ **52 tokens** |
| Spent on machine-generated prompts | 34,611 chars ≈ **8,652 tokens (80%)** |
| Spent on real user prompts | 8,845 chars ≈ **2,211 tokens (20%)** |
| Tokens per turn actually followed (6) | ~1,811 tokens/success |

For scale: the native skill listing this router was built to replace costs **~4,462 tokens
per session** — and it is still being paid, because Part 1 shows it was never removed. Over
3,392 session files in the window the listing dominates the router's ~10.9k tokens by orders
of magnitude. **The router's direct token cost is negligible; its problem is that it is
additive to a listing that was never switched off.**

Judgment-service cost (the jev calls) is a separate, unmeasured line: 1,708 prompts × 54
yes/no questions each = **~92,000 judgment questions in 30 days**, billed to the judgment
model. The log does not record cost or token counts for these.

### Router latency

**Not recorded.** The 1,708 log entries carry only
`at, harness, promptHash, promptChars, candidates, skills, passed, confidence, source, skill,
front, error`. Zero entries have any latency/duration field. Latency cannot be measured from
this log. (`src/app/routing/select-skills.ts`'s header comment cites a one-off 2026-09-20
hand measurement of 230–560 ms per judgment, but that is a code comment, not data.)

### Router decision distribution (30d, from `skill-router.jsonl`)

- 1,708 prompts judged; **282 (17%)** produced an injection.
- `source`: `decided` 958, `fallback` 749 (**44% of prompts had a yes that missed the 0.8
  gate**), 1 null.
- `passed` (candidates clearing the gate, before the cap of 3):
  0 → 1,163; 1 → 179; 2 → 20; 3 → 7; 4 → 1; 5 → 1.
  The batch is **not** over-eager — the cap almost never binds, which is what the module
  comment predicted.
- Confidence (n=1,037 recorded): min 0.18, median **0.71**, max 1.00. The median prompt's
  best candidate sits *below* the 0.8 gate.

---

## Part 3 — The same data against Claude Code's native mechanism

### The decisive comparison

| | Router | Native listing |
|---|---:|---:|
| Turns where a skill was correctly brought to bear (Claude Code, 30d) | **6** followed | **62** unscouted opens on a plain user prompt |

There were **65 unscouted opens**. Classified by prompt provenance:

- **62** — a plain user prompt where the router injected **nothing**, and the model opened a
  skill anyway.
- 3 — a skill body replayed as a prompt.
- **0** — an explicit slash-command invocation.

Since Part 1 establishes that all 54 descriptions are in context, those 62 opens *are* native
auto-invocation working. On the same 30 days, on the same machine, the native mechanism
selected a skill correctly ten times more often than the router did.

Skills opened unscouted, with whether native selection is the plausible cause:

| Skill | Unscouted opens | Router injected it | Native would have found it? |
|---|---:|---:|---|
| `writeup-kit` | 21 | 0 | **No — and neither would the router.** Its own description says "Not invoked directly by users"; it is read *by* `writeup`/`grilling`/`eli5`/`show-me` as a sub-reference. Not a selection event at all. |
| `yoki-artifact` | 16 | 0 | Yes — listed with a description full of trigger phrases (「共有して」「URL にして」). Router never picked it once. |
| `writeup` | 15 | 103 | Yes — the model reached it unaided 15 times while the router's 103 injections yielded 3 follows. |
| `ui-capture` | 7 | 0 | Yes |
| `continuous-learning-v2` | 6 | 0 | Yes |
| `yoki-graph` | 5 | 0 | Yes |
| `css-modern` | 4 | 0 | Yes |
| `defensive-css` | 4 | 0 | Yes |
| `css-cascade` | 3 | 0 | Yes |
| `skill-stocktake` | 3 | 2 | Yes |
| `writing-skills` | 3 | 0 | Yes |
| `grilling` | 3 | 0 | Yes |
| others (`retrospective-codify`, `e2e-testing`, `fastapi-patterns`, `sdd`, `golang-testing`, `python-testing`, `go-modern`, `ai-regression-testing`, …) | 1–2 each | 0–13 | Yes |

The sharpest fact in the table: **the router injected 0 times for `yoki-artifact`,
`ui-capture`, `yoki-graph`, `continuous-learning-v2`, `writing-skills`, `grilling`,
`css-modern`, `defensive-css` and `css-cascade` — 48 unscouted opens' worth of skills it
never once selected** — while spending 103 injections on `writeup`, 100 of which were ignored.
Whatever the router is selecting on, it is concentrated on a handful of skills and blind to
the ones the model actually reaches for.

Caveat, stated plainly: an unscouted open is an upper bound on router misses. The router
declines silently, so "nothing injected" and "the router was never consulted" look identical
in a transcript. But the router log gives the missing half — 1,163 of 1,708 prompts had zero
candidates clear the gate — so most of these were genuine declines, not absences.

### `/skill-doctor`

Skipped — needs an interactive session or `claude -p`, both unavailable here. See Part 1.

---

## What the data cannot tell

1. **Whether the router's picks are *correct* on real user prompts.** There is no
   ground-truth label for "the right skill for this request". The 42-prompt real-user slice
   is small and was judged by eye only. H3 stays undetermined on that slice.
2. **The counterfactual.** Nothing here measures what would have happened with the router
   off. The 62 unscouted opens show native selection works, but not that it would have
   covered the 6 turns the router won, nor that turning the router off changes anything.
3. **Whether the model read the skill and chose not to act on it.** A read is not compliance;
   a non-read is not defiance. "Followed" only ever meant "opened the file".
4. **Reads through a shell.** `cat`/`sed`/`grep` of a SKILL.md is not a tool call. 30 of the
   203 ignored turns used Bash; some fraction may have read a skill invisibly. This
   understates usage in an unknown, non-zero amount.
5. **Router latency and judgment cost.** Not recorded in the log. The ~92,000 judgment
   questions per 30 days have no measured token or dollar figure attached.
6. **pi's and Codex's listing behaviour — now answered in Part 4, but not measured locally.**
   Part 4 establishes from primary docs that pi and Codex both load all skill names and
   descriptions at session start (pi caps each at 1,024 chars; Codex at 2% of context or
   8,000 chars with auto-shortening), so the 53 skills under `~/.agents/skills` are listed
   there too. What is still unmeasured is the local token cost in each and whether either
   harness is hitting its budget. pi's 191 turns (6 followed, 4 unscouted) are too few to
   separate the mechanisms empirically.
7. **Plugin and bundled skills.** The 34 or so plugin/bundled skills in the session listing
   are outside the router entirely and outside `skillOverrides`. Any "hide the listing" plan
   cannot reach them, and their context cost is not in the 4,400-token figure.
8. **Why 80% of prompts are machine-generated.** The hook fires on every `UserPromptSubmit`
   including hook-event replays, compaction passes and agent relays. Whether that is
   intentional was not investigated; it is simply what the data shows.

---

## Part 4 — Industry practice: how the field selects among many skills (2026)

Researched by a delegated agent, 2026-09-22. Two coverage caveats it flagged up front:
WebSearch quota was exhausted before it started, so Lens 1–3 rest on direct `WebFetch` of
primary URLs plus the HN Algolia JSON API; HN quotes are Algolia-summarized, not hand-verified
against the live threads. `omp` could not be located publicly and is reported as a gap, not a
negative finding.

### Lens 1 — Vendors

**Anthropic / Claude Code** (https://code.claude.com/docs/en/skills.md) — matches the Part 1
fetch exactly: descriptions always in context; 1,536-char combined cap on
`description` + `when_to_use`; `disable-model-invocation: true` removes the description from
context; `user-invocable: false` keeps it; `skillOverrides` in settings gives four visibility
states; `/skills` cycles them with Space; `paths:` gates auto-loading by glob; `/skill-doctor`
(v2.1.252+) reports per-skill cost and usage frequency.

**Anthropic engineering**, *Equipping agents for the real world with Agent Skills*:
> "At startup, the agent pre-loads the `name` and `description` of every installed skill into
> its system prompt."

**OpenAI Codex** (https://learn.chatgpt.com/docs/build-skills — `developers.openai.com/codex/skills` 308-redirects here):
> "ChatGPT and Codex start with each skill's name and description, then load the full
> `SKILL.md` instructions when they decide to use that skill."
> "To avoid crowding out the rest of the prompt, this list uses at most 2% of the model's
> context window, or 8,000 characters when the context window is unknown."
> "If many skills are installed, Codex shortens skill descriptions first. For large skill
> sets, Codex may omit some skills from the initial list and show a warning."

Both figures from the brief (2%, 8,000 chars) are **confirmed against the primary source**.

**pi** (`earendil-works/pi`, `packages/coding-agent/docs/skills.md`, main, fetched via `gh api`):
scans skill locations at startup, puts names and descriptions in the system prompt as XML;
"only descriptions are always in context, full instructions load on-demand". Description cap
is **1,024 chars** — stricter than Claude Code's 1,536. `disable-model-invocation` is
supported with the same meaning ("skill is hidden from system prompt"). pi implements the
cross-vendor Agent Skills standard (agentskills.io) and can load `~/.claude/skills` and
`~/.codex/skills` directly.

This answers the Part 1 gap for pi: **pi does list all skill descriptions at session start**,
so the 53 skills under `~/.agents/skills` are visible to pi too, by the same logic as Claude
Code.

pi's docs contain the one vendor admission that cuts the other way:
> "models don't always do this; use prompting or `/skill:name` to force it"

— and pi's prescribed fix is a **manual force-invoke slash command, not an external router**.

**No vendor ships or recommends an external pre-selector/router for skills.** All three
verified vendors converge on the same three-part native answer: list everything at startup,
truncate or auto-shorten under budget pressure, and give the user a manual force-invoke
escape hatch.

### Lens 2 — Practitioners

- **meanllbrl/dreamcontext** — the most directly relevant finding. A team that built a
  UserPromptSubmit skill gate that pre-selected skills, then reversed it after four
  iterations (entry dated **2026-05-31**):
  > "Context gate must show full skill catalog, never pre-select... UserPromptSubmit skill
  > gate must NOT list a top-3 pre-selected subset of relevant skills. The agent sees the
  > full skill catalog already; pre-picking arbitrary top-3 constrains which skills get
  > invoked."

  Their surviving design uses a cheap check to decide **whether** to fire a reminder at all —
  never **which** skills to show. This is a reversal of very nearly jig's exact design
  (top-3 cap included).
- **TheWayWithin/agent-11** — field manual, explicit anti-pattern:
  > "Do not write a 'router skill' or `using-skills` meta-skill. The Skill tool's
  > description-matching is the router. A handwritten router would duplicate it and fight
  > for control."
- **Matt Pocock** (`mattpocock/skills`) — does use a "thin router skill" pattern, and an
  `ask-matt` skill described as "a 'skill router'" — **but it is itself a Skill, invoked
  through the native Skill tool**, not a hook or external judgment service. (The summarizing
  source claimed "220k+ stars" for the repo; the researcher flagged that as implausible and
  unverified.)
- **NVIDIA**, quoted via `blueif16/hermes-skill-system`: "all the skills are not always in
  context… a very, very strong skill manager… to explicitly avoid this" — framing
  progressive disclosure itself, not an external router, as the answer to bloat.
- HN sample (Algolia-summarized, dates from `created_at`): `cruz101` (2026-07-26) "I think if
  you need a router for skills, there's something else wrong"; `kingkongjaffa` (2026-01-07)
  built router skills but "the core problem is still How to Make Claude Code Skills Activate
  Reliably"; `mahboi` (2026-09-18) "if you have too many skills, it can get confused and
  start reading all them and cloud the context".
- "Skill bloat" is a named 2025-2026 phenomenon across 20+ repos, and the prescribed fix in
  that family of tools is consistently **pruning/curation, not routing** — including the
  user's own `config-gc` skill.

### Lens 3 — Measured

**Anthropic Tool Search Tool** (https://www.anthropic.com/engineering/advanced-tool-use,
dated **2025-11-24**) — numbers verified exact:
> "Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1% with Tool
> Search Tool enabled."

Context: internal MCP evaluations over 50+ MCP tools across GitHub, Slack, Sentry, Grafana,
Splunk and Jira. Token cost: ~55,000 tokens of tool definitions without, ~8,700 with.

**Does it transfer to skills? The researcher's judgment: mostly no, for structural reasons.**

- *Same*: many named candidates with short descriptions competing for one selection decision;
  accuracy falls as the pool grows; both mitigated by progressive disclosure.
- *Different, materially*:
  1. **Weight per item.** MCP tool schemas averaged ~1,100 tokens each in the cited case.
     Skill descriptions are capped at 1,536 chars (~400 tokens). This machine's 54 skills cost
     ~4,462 tokens total (measured in Part 2) — an order of magnitude below the 55,000-token
     pressure that motivated Tool Search Tool.
  2. **Selection mechanics.** A tool call is a discrete, schema-validated, one-shot structured
     output. A skill "selection" is the model choosing to open a file — softer, reversible,
     and self-correcting within the same turn.
  3. **Mechanism mismatch, and this is the sharpest point.** Tool Search Tool is a tool *the
     model itself calls* to search a large index on demand — it **expands** what the model can
     reach, on the model's initiative. jig's router is the inverse: an external hook that
     pre-filters and hides the catalog **before** the model gets a turn. Tool Search Tool is
     evidence for "give the model an active search capability over a big index," not for
     "hide the index and push 1–3 pre-picks at the model."
- **Retrieval-over-instructions numbers**: none found with concrete accuracy figures. The
  closest scale marker is `hbmartin/ratchet` (June 2026), whose retrieval pipeline is
  explicitly scoped to *"a library of >10k items"* — two to three orders of magnitude past
  54–88.
- **The one rigorous router measurement**: `bordenet/superpowers-plus`'s
  `tools/router-precision.py` defines precision as "top suggestions followed by invocation of
  that skill in the same user turn / all evaluable top suggestions", calibrated over a
  12-skill regression corpus and a **118-skill installed corpus** — almost exactly this scale.
  Its own docs report the pipeline silently broke:
  > "the INSTALLED hook... can be an older copy that writes fewer fields... Precision reports
  > 'n/a' forever — indistinguishable from 'not enough data yet' unless you know to look for it."

  The project that tried hardest to measure a follow rate at this scale could not produce one.

### Lens 4 — In the wild (`gh search code`, 2026-09-22)

- `'UserPromptSubmit skill'` → ~45 distinct repos at the 50-result cap. `'"skill router"'` →
  50+ distinct repos/files at cap. The pattern is genuinely common and the term is widely used.
- **ChrisWiles/claude-code-showcase** — created 2026-01-06, 6,070★/577 forks, pushed once.
  Ships a real `UserPromptSubmit` hook (`skill-eval.js` + `skill-rules.json`) scoring skills by
  keyword/regex/path/directory rules (`minConfidenceScore: 3`, `maxSkillsToShow: 5`).
  **A deterministic scorer, not an LLM judgment service — and it injects a suggestion on top of
  the native listing rather than hiding the catalog.** No follow rate published.
- **mobasak/fabrik** — T05 skill-router hook, receipts dated 2026-08-07, merged `8e11cc5a`.
  Two-tier: deterministic bilingual regex map first; an LLM classifier **only on regex miss**,
  ≤8s timeout, fail-open. Its "123 tests" are unit tests of the hook's logic, not a measured
  production follow rate.
- **bordenet/superpowers-plus**, **meanllbrl/dreamcontext** — see above.
- Dozens more ship a UserPromptSubmit skill-suggestion variant, but **the overwhelming
  majority are cheap deterministic keyword/regex/BM25 matchers running locally**, and where an
  LLM tier exists it is a timeout-bounded, fail-open fallback to a deterministic first pass —
  not the primary mechanism, as it is in jig.
- **Follow rate published by anyone: zero.** One repo has a defined methodology; none report a
  number.

### Negative evidence (searched with equal effort)

dreamcontext's reversal and agent-11's anti-pattern warning are the clearest "tried it, walked
it back" and "don't do this" data points. HN sentiment skews skeptical, including from people
who built routers.

The researcher explicitly searched ~8 phrasings across two independent full-text surfaces
(GitHub code search, HN Algolia) for "router removed/abandoned" and "the model ignores injected
context" and found **zero hits**. Its own reading of that absence, which is worth keeping:

> "This is a genuine absence, and I think the more likely explanation is under-measurement,
> not universal success... most in-the-wild routers are simple keyword matchers whose
> 'success' is just 'it fired,' never checked against whether the model actually obeyed it."

Note this cuts both ways: pi's own docs admit native listing-based invocation is *also*
imperfect, so "native listing always works" is not established either.

### Verdict

**The surveyed evidence does not support hiding skills behind an external judgment-service
router at 54–88 skills.** Five grounds:

1. **Scale mismatch.** 54–88 skills sits inside every vendor's native listing budget. This
   machine measures 4,462 tokens with zero descriptions truncated (Part 1). The scale marker
   for when retrieval-augmentation becomes standard is ">10k items".
2. **No vendor recommends it.** Three independently-verified vendors converged on list +
   truncate + manual escape hatch. None document an external pre-selector.
3. **The practitioners who tested this exact design reversed it.** dreamcontext banned
   top-3 pre-selection by name after four iterations; agent-11 calls it a platform-duplicating
   anti-pattern.
4. **The one rigorous measurement at this scale produced no usable number**, which should
   lower confidence in confident claims in *either* direction.
5. **Structural mismatch with the strongest pro-large-library result.** Tool Search Tool is the
   model searching an index on its own initiative; jig's router hides the index and decides for
   it. These are close to opposites.

**Testable conditions under which a router could beat native listing** (falsifiable, none
currently demonstrated at this scale):

- **A** — Native listing consumes a problematic fraction of context *after* vendor truncation,
  measured on this corpus. Currently 4,462 tokens, 0 truncated. Not met.
- **B** — Transcript evidence that native selection accuracy degrades as *this* catalog grows.
  Part 3 shows the opposite direction: 62 correct unaided opens vs the router's 6.
- **C** — The router's own precision measured high. Currently 5/42 = 11.9% on real user
  prompts. Not met.
- **D** — The failure being fixed is false-positive (wrong skill invoked), not false-negative
  (right skill under-invoked). A pre-filtering router cannot fix under-invocation of a skill it
  chose not to show — dreamcontext's reversal is direct evidence hiding makes this worse.
- **E** — The router fails safe no worse than doing nothing. jig fails open (returns "" on any
  error), which is correct — but with the listing hidden, fail-open would mean the model sees
  *nothing*, which is worse than the status quo of seeing everything.

Condition E is the one that matters most for the open decision: the router currently looks
harmless because the listing was never removed. Removing the listing is what would make its
11.9% precision and its fail-open behaviour load-bearing.
