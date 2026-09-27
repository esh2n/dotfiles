---
question: "現行世代（2026-06 以降）のモデルを使う名の知れた実践者は、自分のハーネスの context window を実際にいくつに設定しているか — 200K か 1M か、それとも既定のままか。設定した結果どうなったか"
date: 2026-09-27
verdict: "実測された設定値は 200K〜1,050,000 に割れる。名の知れた実践者で 1M 級を明示的に設定しているのは 2 名（Nick Nisi = pi で 1,050,000、Jellydn = Codex の 1M プロファイル 1,050,000）で、どちらも「既定ではない追加プロファイル／上書き」として置いている。逆に 1M 級モデルを明示的に 200,000 へ切り下げている実践者もいる（Matt Silverlock = opencode の Opus 4.6 を 200,000、コメント「compaction at 200k tokens」）。Claude Code 側で最も強い一次証拠は Anthropic 自身の 200,000（Lydia Hallie, 2026-04-02）で、これは旧世代。個人の設定値は「モデルの公称上限」ではなく「圧縮をいつ発火させたいか」で決まっており、Codex 系の 1M 設定は 794,000〜900,000 の圧縮点とセットで現れる。設定した結果の報告は 4 件中 3 件が失敗（ハーネスが黙って切り詰める、圧縮が発火しない、statusline が新しい値を映さない）。しかも設定値は実効値ではない — Codex は `min(設定, 同梱カタログ) × 0.95` で頭打ちにし（同じ `1000000` が 258,400 と 828,400 に割れた）、OpenAI 自身が 2026-07-18 に同梱既定を 372,000→272,000 へ下げ、Cline は圧縮点を窓の 0.81 倍に溶接し、窓を上げた利用者への実際の処方は窓を 250,000 へ下げることであった（§3b）"
unverified:
  - "Matt Silverlock の pi 設定（.pi/models.json の contextWindow: 1000000）は自作プロバイダ定義のカタログであり、彼が pi の圧縮予算として実際に使い続けている値かは未確認。同じ人物の opencode 側は同じ Opus 4.6 を明示的に 200,000 へ切り下げている（両立しない可能性がある）"
  - "Nick Nisi の 1,050,000 は 2026-09-16 のコミットで追加されたが、その後の 2026-09-21 コミット以降も維持されているかは最新ツリーで再確認していない"
  - "mycall の `model_context_window = 27000` / `model_auto_compact_token_limit = 17000` は投稿どおりの字面。270000/170000 の誤記の可能性を排除できない"
  - "HumanLayer（Dex Horthy / Kyle）の設定値はこの記録では一次取得していない（既存記録 2026-09-27-practitioner-context-management.md の引用に依拠）"
  - "2026-06-01 以降に公開された、名前の通った実践者の Claude Code 設定ファイル実物（settings.json）は発見できなかった。Claude Code 側の現行世代の設定値はすべて HN のハンドル発言か GitHub issue 経由"
  - "§3b の推論（Jellydn の Codex 1M プロファイルが同梱カタログ 272,000 × 0.95 = 258,400 で不活性になっている可能性）は二つの記録の算術を合成したもので未観測。`codex --profile 1m` の実効窓を読むまで確定しない [INFERENCE]"
sources_note: "web_search はこのセッションの egress で全プロバイダ失敗（startpage / duckduckgo / ecosia / google / mojeek）。代わりに (1) `read` による直接URL取得、(2) 認証済み `gh api`（repos/contents raw・commits・issues・search/code。code search は 10 req/分 の別枠）、(3) HN Algolia API、(4) api.fxtwitter.com（X の投稿本文を JSON で返す。親からの伝聞で今セッションで動作確認）を使った。匿名リポジトリの code search ヒットは証拠として数えていない（末尾に非証拠として列挙）"
---

# Configured context-window values among named practitioners, 2026-06 → 2026-09

Scope note. This record answers one narrow question: **when a named practitioner sets the context
window for their own agent, what number do they set?** It is not about how full anyone runs the
window, and it is not a re-survey of harness defaults (those live in
`2026-09-27-compaction-defaults-across-harnesses.md`). Where a practitioner publishes no value, that
is recorded as a finding with the harness default named.

Evidence rule applied: only named practitioners — the roster in
`2026-09-27-practitioner-context-management.md` (Huntley, Horthy/Kyle, Zechner, Vincent, Willison,
Hashimoto, Yegge, Breunig) or people equally identifiable by name. Anonymous repos found by code
search are not evidence. Identifiable-but-pseudonymous HN/GitHub handles appear in a separate tier
and are labelled as such.

## 0. Method and legend

- **DIRECT** — the primary artefact (raw config file, GitHub issue/comment API, tweet JSON) was
  fetched in this session and the quoted text is verbatim from that fetch.
- **TRANSCRIBED** — the quote was obtained through a third party page; the canonical URL is given.
- **NON-EVIDENCE** — an anonymous repo hit, listed for completeness and excluded from the verdict.
- **NOT CURRENT-GENERATION** — published before 2026-06-01. Included where it is the vendor's own
  recommended value, always labelled.

Retrieval that failed, recorded as such: `web_search` on every provider; `ghuntley.com/rss/` returns
posts with titles stripped; `https://simonwillison.net/search/?q=context+window&year=2026` → HTTP 403.

Retrieval that worked and is worth reusing: `api.fxtwitter.com/<screen_name>/status/<id>` returns a
tweet as JSON (text, author, `created_at`, and the quoted tweet inline) with no auth. Used here for
`lydiahallie/status/2039800718371307603` (2026-04-02, the `200000` recommendation) and
`bcherny/status/2043163965648515234` (2026-04-12) and `bcherny/status/2098217573276131577`
(2026-09-11). The last of the three is in-window and was checked specifically for a window value:
**it contains none** — Boris Cherny's in-window public guidance names models, effort levels,
`CLAUDE.md` and skills, and never a context-window number. There is no fxtwitter search endpoint, so
IDs must come from elsewhere; that is why this path yielded only the two IDs already known from HN
and the issue tracker.

Note on sibling paths. The four sibling records this contract names are on branch
`feat/omarchy-look-in-dotfiles`; the working tree at write time was mid-rebase onto a tree that does
not carry them. They were therefore read from their commits with read-only `git show` —
`4daeeb68:harness/rules/research/2026-09-27-practitioner-context-management.md`,
`4daeeb68:…-context-management-lab-guidance.md`, `4daeeb68:…-compaction-defaults-across-harnesses.md`,
and `11751d80:…-japanese-practitioner-context-practice.md`. Their verdicts are quoted verbatim in
§5, so the comparison below is against the records themselves and not against memory of them. The
`INDEX.md` in the working tree is another session's copy and was not used as an index.

## 1. The direct answer — literal configured values, one named person at a time

| # | Person (identifiable by name) | Harness | Key and literal value | File / source | Committed / posted | Legend |
|---|---|---|---|---|---|---|
| 1 | **Nick Nisi** | pi | `"modelOverrides": { "gpt-6-astra": {"contextWindow": 1050000}, "gpt-5.6-sol": …, "gpt-5.6-terra": …, "gpt-5.6-luna": … }` + `"compaction": {"enabled": true, "reserveTokens": 16384, "keepRecentTokens": 30000}` | `nicknisi/dotfiles` → `home/.pi/agent/models.json`, `home/.pi/agent/settings.json` | commit `2026-09-16T05:11:21Z` — *"fix(pi): opt openai-codex models into the 1.05M context window"* | DIRECT |
| 2 | **Matt Silverlock** (`elithrar`) | opencode | `"claude-opus-4-6": { "limit": { "context": 200000, "output": 128000 } }` under the comment *"Override context limits to trigger built-in compaction at 200k tokens"*; also `gpt-5.5 → 200000`, `gpt-5.2` / `gpt-5.1-codex*` / `gpt-5.1 → 272000` | `elithrar/dotfiles` → `.config/opencode/opencode.jsonc` | last commit `2026-07-12T20:22:43Z` | DIRECT |
| 3 | **Matt Silverlock** (`elithrar`) | pi | `cloudflare-opencode` provider: `claude-opus-4-6` / `4-7` / `4-8` → `"contextWindow": 1000000`; `claude-sonnet-4-6` → `1000000`; `claude-sonnet-4` / `4-5` → `200000`; `gpt-5.5` → `272000`; `gpt-5.5-pro` → `1050000` | `elithrar/dotfiles` → `.pi/models.json` | `2026-06-30T00:37:23Z` | DIRECT |
| 4 | **Jellydn (Vinh Le)** | Codex CLI | optional profile: `model = "gpt-5.6-sol"`, `model_context_window = 1050000`, `model_auto_compact_token_limit = 794000` | `jellydn/my-ai-tools` → `configs/codex/1m.config.toml` | `2026-08-21T07:34:01Z` — *"feat(codex): enable 1M context window for GPT-5.6 Sol (#363)"* | DIRECT |
| 5 | **Jellydn (Vinh Le)** | Codex CLI | default profile: `model = "gpt-6-astra"` and **no `model_context_window` key at all** | `jellydn/my-ai-tools` → `configs/codex/config.toml` | `2026-09-20T14:30:36Z` | DIRECT |
| 6 | **Mic92 (Jörg Thalheim)** | pi | local models: `"contextWindow": 262144` (qwen3.8-27b), `65536` (gemma-4-31B, Qwen3.5-35B-A3B), `32768` (Ministral-3-14B) | `Mic92/dotfiles` → `home/.pi/agent/models.json` | `2026-09-02T08:46:07Z` | DIRECT |
| 7 | **Kevin Deldycke** | pi | local mlx models: `"contextWindow": 262144` | `kdeldycke/dotfiles` → `dotfiles/.pi/agent/models.json` | `2026-08-09T13:31:11Z` — *"Add pi config"* | DIRECT |
| 8 | **Lydia Hallie** (Anthropic, Claude Code) | Claude Code | the value she tells users to set: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` | `x.com/lydiahallie/status/2039800718371307603` | `2026-04-02T20:22:43Z` | DIRECT — **NOT CURRENT-GENERATION** |
| 9 | **Boris Cherny** (Claude Code lead) | Claude Code | *"we are investigating defaulting to 400k context instead, with an option to configure your context window to up to 1M if preferred. To experiment with this now, try: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000 claude`"* | `anthropics/claude-code#45756`, comment by `bcherny` | `2026-04-12T14:51:49Z` | DIRECT — **NOT CURRENT-GENERATION** |

Verbatim, item 1 (the most decision-relevant in-window entry) — `nicknisi/dotfiles`,
`home/.pi/agent/models.json`:

```json
{
 "modelOverrides": {
  "gpt-6-astra": { "contextWindow": 1050000 },
  "gpt-5.6-sol": { "contextWindow": 1050000 },
  "gpt-5.6-terra": { "contextWindow": 1050000 },
  "gpt-5.6-luna": { "contextWindow": 1050000 }
 }
}
```

and `home/.pi/agent/settings.json`:

```json
"compaction": {
  "enabled": true,
  "reserveTokens": 16384,
  "keepRecentTokens": 30000
},
```

pi compacts when `contextTokens > contextWindow − reserveTokens`, so his firing point is
`1050000 − 16384 = 1,033,616` tokens — **98.4% of the configured window**. The commit message is
explicit that the 1.05M figure is an *opt-in*: *"opt openai-codex models into the 1.05M context
window"*.

Verbatim, item 2 — `elithrar/dotfiles`, `.config/opencode/opencode.jsonc`:

```jsonc
// Override context limits to trigger built-in compaction at 200k tokens
"provider": {
  "anthropic": {
    "models": {
      "claude-opus-4-6": {
        "limit": { "context": 200000, "output": 128000 },
      },
    },
  },
```

Verbatim, item 4 — `jellydn/my-ai-tools`, `configs/codex/1m.config.toml` (the whole file):

```toml
# Optional Codex profile for the full GPT-5.6 Sol context budget.
# Select with: codex --profile 1m
#
# gpt-5.6-sol: 1,050,000 window, 922,000 max input, 128,000 max output.
# Compact at 794000 (922000 - 128000) so a full reply still fits under the input cap.
# Prompts over 272K input tokens are billed at 2x input and 1.5x output for the request.
model = "gpt-5.6-sol"
model_context_window = 1050000
model_auto_compact_token_limit = 794000
```

Two structural facts fall out of this table and matter more than any single number:

- **Nobody's 1M is "the provider maximum".** The three in-window 1M-class settings are
  1,050,000 (a model's stated budget, not a round 1M) and each carries an explicit compaction point
  (1,033,616 / 794,000 / 900,000). A configured window without a paired trigger does not appear in
  any named practitioner's file.
- **The opt-in/opt-out framing is the norm, not the exception.** Jellydn ships 1M as a *separate
  profile* while his default profile states no window at all; Nick Nisi's 1.05M arrives as a
  `modelOverrides` patch on a base config; Matt Silverlock *caps down* rather than up.

### 1b. Identifiable but pseudonymous accounts (secondary tier)

These are HN/GitHub handles, not people named in the sibling records. They are listed separately and
carry less weight: they are identifiable, they are not the sibling roster.

| Handle | Harness | Literal value | Source | Date | In window? |
|---|---|---|---|---|---|
| `swingboy` | Codex | `model_context_window = 1000000`, `model_auto_compact_token_limit = 900000` — *"I believe it does consume your usage a bit faster though."* | `news.ycombinator.com/item?id=49559154` | 2026-09-04 | yes |
| `raysarno` | Claude Code | Opus on a 1M window with `autoCompactWindow: 400000` (equivalently `/autocompact 400k`) | `anthropics/claude-code#96467` | 2026-09-23 | yes |
| `walthamstow` | Claude Code | *"There's an env var you can set in Claude Code to bring the autocompact threshold down, effectively setting your own max context window. I have it at 400k."* | `news.ycombinator.com/item?id=48525205` | 2026-06-14 | yes |
| `conception` | Claude Code | *"You can change your compaction token limit to 400k if you want. CLAUDE_AUTOCOMPACT_PCT_OVERRIDE And CLAUDE_CODE_AUTO_COMPACT_WINDOW"* | `news.ycombinator.com/item?id=48475494` | 2026-06-10 | yes |
| `mycall` | Codex | `model_context_window = 27000`, `model_auto_compact_token_limit = 17000`, `model_auto_compact_token_limit_scope = "total"` — presented as a way to *postpone* compaction | `news.ycombinator.com/item?id=48969162`-thread, story `48965850` | 2026-07-19 | yes |
| `BiraIgnacio` | Claude Code | full `settings.json` env block including `"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "60"` and `"CLAUDE_CODE_AUTO_COMPACT_WINDOW": "200000"` | `news.ycombinator.com/item?id=48243622` | 2026-05-23 | no |
| `naasking` | Claude Code | the entire comment body is `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` | `news.ycombinator.com/item?id=47751125` | 2026-04-13 | no |
| `pchalasani` | Claude Code | keeps auto-compact off entirely and never compacts; *"work until 95%+ context usage"* | `news.ycombinator.com/item?id=46631348` | 2026-01-15 | no |

Note on the Claude Code column: every literal `CLAUDE_CODE_AUTO_COMPACT_WINDOW` value found on HN
is either 200000 or 400000. No HN poster reported setting it to 1,000,000.

## 2. Named practitioners who publish no configured value

Recorded as the reframe requires: *leaves the harness default*.

| Person | What their public config actually contains | Last commit | Finding |
|---|---|---|---|
| **Jesse Vincent** (`obra`) | `obra/dotfiles` `.claude/` = `CLAUDE.md`, `commands/`, `skills/`, `statusline-command.sh`; `.codex/` = `AGENTS.md`, `skills/`; `.config/opencode/opencode.json` = `{"$schema": …, "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]}` only | `.claude` 2026-08-11, `.codex` 2026-07-05, `.config/opencode` 2026-06-07 | No window value in any harness. `statusline-command.sh` only *reads* `context_window.context_window_size`; it never sets it. |
| **Geoffrey Huntley** | `ghuntley/ghuntley` `.claude/` contains only `agents/` — no `settings.json`; `ghuntley/dotfiles-coder` last pushed 2023-04-04 | repo pushed 2026-02-04 | No public configured value. |
| **Simon Willison** | `simonw/dotfiles` → 404; `simonw/simonw` is a project index; newest gists 2025-12 | — | No public configured value. |
| **Mitchell Hashimoto** | `mitchellh/dotfiles` → 404 | — | No public configured value. |
| **Mario Zechner** (`badlogic`) | public repos are `pi`, `pi-*` extensions, `pibot`, `pi-skills` — no personal harness config | `pi-skills` 2026-06-06 | No public configured value. |
| **Steve Yegge / Drew Breunig / Tobi Lütke** | no dotfiles repo found for any of the three | — | No public configured value. |

This is a real and reportable result: **of the eight people the sibling practitioner record names,
not one publishes a context-window value in a public config repository.** The values in §1 come from
a different set of people — pi/Codex/opencode users who happen to keep their agent configs in public
dotfiles — plus Anthropic's own staff recommending a number to users.

## 3. What happened when someone changed their own value

Of the fifteen configured values recorded in §1 and §1b, four have a reported outcome, and **three of the four are
failures**.

1. **Set to 1M, silently cut to ~258k.** `openai/codex#19185` (opened 2026-04-23T19:11:33Z, closed
   2026-04-24T22:22:09Z as `not_planned`). The reporter's config, verbatim:
   `model = "gpt-5.5"`, `model_context_window = 960000`, `model_auto_compact_token_limit = 800000`.
   Outcome, verbatim: *"After setting a large context window, for example around `1M`, Codex still
   automatically reports/uses about `258k` instead. This makes it impossible to control the
   effective context window from the config file."* The maintainers closed it without a fix.
   → A configured 960,000 was overridden by the harness. **NOT CURRENT-GENERATION** in
   origin (April), but the close date is in-window and the behaviour is the reason the 1M Codex
   configs in §1 pair 1,050,000 with a 794,000 trigger.
2. **Set the compaction percentage, autocompact never fired.** `anthropics/claude-code#52390`
   (opened 2026-04-23T13:22:49Z, closed 2026-08-31T22:24:30Z). Reporter's
   `~/.claude/settings.json` sets `"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"` against *"Claude Code
   v2.1.118, Sonnet 4.6 (200k context)"*. Verbatim: *"Autocompact never fires. Context reaches 100%
   regardless of the configured threshold."* Closed in-window.
3. **Set `autoCompactWindow: 400000` on a 1M window, and the UI did not show it.**
   `anthropics/claude-code#96467` (opened 2026-09-23T18:41:58Z, open). Verbatim: *"Example: Opus on a
   1M window with `autoCompactWindow: 400000`. At 392k tokens, the status line shows 39% used.
   Compaction is about 8k tokens away."* and *"Each session resolves its window once at startup, from
   `--autocompact`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, or `autoCompactWindow` in settings."*
   → the configured value works; observing it does not.
4. **The harness changed the default under people.** `SyneRyder`, HN comment 2026-06-26, verbatim:
   *"EDIT: Found a solution, seems Claude Code 2.1.193 (or an earlier version I didn't notice)
   changed default settings, so that if you have Autocompact turned on it occurs at 50% of the
   context window. If you turn off Autocompact, the full 1 Million context window is restored.
   Another example of Claude Code quietly changing default settings sigh"*
   (`news.ycombinator.com/item?id=48689659`). → In-window, the effective configured window moved to
   500,000 without the user setting anything.

Reversions and self-imposed ceilings (all in-window, all HN, all identifiable handles):

- `schipperai`, 2026-06-14 — the clearest reversion: *"Working in the era of 200k context window
  meant I had to narrowly scope tasks… 1M context windows and the promise that the latest models are
  'better at long running tasks' made me lazy in how I scope tasks and quality got worse. I now went
  back to narrow-scoping one session per task and zero compaction, trying not to go past 400k
  context window."* (`item?id=48528322`). Configured-and-abandoned 1M → self-imposed 400k.
- `throwatdem12311`, 2026-07-19 — *"1M context sound great but it quickly degrades once you start
  hitting the 50% mark. I usually just /clear once I hit between 30 and 40 percent context"*
  (`item?id=48969614`). An operating band 300–400k on a 1M window.
- `ilc`, 2026-07-19 — *"Yeah, it can be a little fuzzy at 600-700k, I prefer it 400K and under in
  general. But, I've had usable sessions to 850k."*
- `PeterStuer`, 2026-07-20 — *"in Claude Code with the '1M context' models I am reluctant to push
  past 30%."*
- Counter-testimony, `daishi55`, 2026-06-14 — *"I use opus 1m context all day every day at work and I
  simply have never encountered this. I don't even think about context windows anymore I just let it
  do what it wants re compaction."* One anecdote on the other side; §3's reversion is one anecdote
  too, so neither settles the question.

Degradation onset per model generation — `pdantix`, 2026-06-14, the only in-window report that
tracks the onset moving (`item?id=…`, story `48524620`): *"opus 4.5 would start failing tool calls
when approaching its 200k limit, opus 4.6 could get to ~300k before getting confused, opus 4.7 i
could stretch to around 400k the dumb zone started, with opus 4.8 i've had sessions get over 500k
comfortably. admittedly we only had limited time with fable, but i had a couple sessions get into
800-900k just fine."* This is the single datum that argues the *reason* for a 200K budget is
generational and may be weaker now.

### 3b. The configured value is not the value the harness enforces

Cross-referenced, not re-collected: `2026-09-27-current-long-context-coding-measurements.md` owns the
measurement lens, and the following of its findings directly bound every number above.

- **Codex clamps the user's number**: `min(model_context_window, bundled catalog context_window) ×
  effective_context_window_percent`, the percent being **95**. The *same* literal `1000000` in two
  different reports produced **258,400** and **828,400**, and the reporter cannot tell in advance
  which. That is the mechanism behind item 1 above, and it means the 960,000 in that issue was never
  the operative number.
- **OpenAI lowered its own shipped default in-window.** PR #33972 (author `sayan-oai`) merged
  **2026-07-18** and moved `codex-rs/models-manager/models.json` for `gpt-5.6-sol` / `-terra` /
  `-luna` from `context_window=372000` to `272000`. Users reported it as *"a 95,000-token, ~26.9%
  reduction"* (`openai/codex#34619`, 2026-07-21). A vendor that ships 272,000 while its flagship
  configuration story is 1,050,000 is the strongest single argument against reading any vendor
  window number as a budget.
- **Cline's compaction point is welded to the window**, at `0.9 × 0.9 = 0.81 × window`: ~162k on a
  200K window, ~810k on a 1M window. Raising the window therefore does not move compaction
  proportionally, it effectively disables it.
- **The remedy a maintainer chose was to lower the window, not raise it.** In `cline/cline#14329`
  (2026-09-20) the fix was to set the window to **250,000**; the reporter's one-task cost was
  **$49.63** with a **12% cache hit against a 98% control** for the same model. That record flags the
  confound (the reporter also ran `git init` and switched models), so the dollar figure is not
  cleanly attributable to the window alone.
- **Production traces, not anecdotes.** `arXiv 2608.00101` (2026-07-30, Copilot fleet: 13M sessions,
  95T tokens) measured cache hit rate falling **90% → 55% across turns** with invalidation by
  compaction, and compaction accounting for **44.2% of all tokens** across 7.8% of sessions.

**Consequence for §1, and one inference.** Every configured 1M-class value in this record should be
read as *a request*. For Nick Nisi's pi setting the conversion is a fixed subtraction, so 1,033,616
is derivable and real. For Jellydn the conversion is the Codex clamp above, which implies
`min(1050000, 272000) × 0.95 = 258,400` for `gpt-5.6-sol` — i.e. his 1M profile would be **inert** on
a shipped catalog whose entry is 272,000. **[INFERENCE, cross-record]** Reached by composing this
record's §1 item 4 with the other record's clamp arithmetic; it is explicitly not observed. The test
is cheap and belongs with the harness-default survey: run `codex --profile 1m` and read the effective
window the harness reports. This is the single most decision-relevant thing to check next, because if
it holds, the one named practitioner who deliberately configured 1,050,000 on Codex got 258,400.

## 4. The cost arithmetic that produces these numbers

The 200K camp is not arguing about quality; it is arguing about cache reads.

- `wgjordan`, 2026-07-18 (`item?id=48960581`), verbatim: *"Only if money is no object. Cache reads
  are cheap (10% of uncached input costs) but definitely not free, and cached reads dominate session
  costs at long context lengths. A prompt at 20k context with $0.01 in cached reads would cost $0.40
  in cached reads at 800k context"*. Same author, `item?id=48972376`: *"I think the stronger claim is:
  there is no reason for a single task to require a 1m context window."*
- `reissbaker`, 2026-05-01 (`item?id=47981831`): *"Even at cached input prices, cost scales
  near-linearly with context length: if you 2x your context length, you'll roughly ~2x your cost."*
  **Contradicted** by the next two, which describe quadratic growth in whole-session cost; the
  difference is whether turn count is held fixed.
- `chaos_emergent`, 2026-07-20 (`story 48965850`): *"A larger pre-compaction context window means that
  a greater number of cache tokens are used per turn, and a larger number of turns are completed
  before compaction runs. So you get a cumulative cost that grows quadratically until the compaction
  event."*
- `srcreigh`, 2026-09-02 (`item?id=49532116`), with numbers: *"assuming the agent takes 75 turns per
  200k context, with deepseek v4 flash it costs around $2.57 to reach 1M context in 375 turns. Cached
  input costs scale quadratically with # of agent turns. Considering that I hit the 1M compaction
  multiple times per day with codex, it would definitely cost at least $5-8/day to use deepseek how I
  normally use codex."*
- Jellydn's own config comment states the price step that makes large windows a deliberate choice:
  *"Prompts over 272K input tokens are billed at 2x input and 1.5x output for the request."*
- `gatio`, 2026-08-22 (`item?id=49397503`): *"I believe the 1M context window can be configured in
  Codex (config file edit). The price per token increases when >256k though, but it can be useful
  when compaction at-that-moment would be detrimental."* — the clearest statement of *why* someone
  pays for a big window: avoiding an ill-timed compaction, not long tasks.
- Armin Ronacher, 2026-09-07, `lucumr.pocoo.org/2026/9/7/astra-why/` (in-window), a cost incident with
  numbers: *"the slop machine was running for 35 hours until I turned it off. In that time it produced
  a net addition of 75k lines of code… In the 35 hours it burned around 1B tokens for a total of
  around 1200 USD in raw API costs"*, and *"It was free to manage its own context and could maintain
  its own records in an `agent-notes` folder."* He also writes the same post's verdict: *"I honestly
  do not need an agent to run for 35 hours on a single prompt."* Note: the same post separately says
  *"I burned a full reset's worth of ChatGPT tokens on this which appears to be around 4 billion
  tokens"*, which is inconsistent with the 1B-token figure as stated. Both are quoted, neither is
  reconciled. His answer to context cost is an `agent-notes` folder, **not a window setting**.

## 5. Contradictions and agreements with the sibling records

1. **Agreement, and a shifted reason, against `2026-09-27-compaction-defaults-across-harnesses.md`.**
   That record's verdict, verbatim: *"保守的。見つかった全ベンダーの既定トリガーは窓の 50〜98% にあり、
   200K を強制するベンダーは無い。ベンダーが窓を 200K に落とす唯一の場面は「1M を検証できない」
   ゲートウェイのフォールバックである。数値で作業予算を推奨する一次情報は無く、どの測定も 200K を
   最適点として支持しないが、200K では足りないとも言っていない。"* The configured-value evidence
   confirms the default half (no vendor forces 200K) and adds the missing half: the 200,000 and
   400,000 values practitioners *do* set are chosen to make compaction fire early for **cache-cost**
   reasons, not because anyone is under-filling a window. Anthropic's own staff recommendation
   (§1 item 8) is literally `200000`, and Claude Code's in-window default moved to 50% of whatever
   window you have (SyneRyder, 2026-06-26) — the harness moved *toward* the house default, not away
   from it.
2. **Agreement, and a distinct class of evidence, against
   `2026-09-27-practitioner-context-management.md`.** That record's verdict, verbatim: *"保守的ではない。
   数字を言う実践者は 25K〜170K の絶対値に収まり（Huntley 170K 上限・実効 clipping 147〜152K、
   HumanLayer 75K smart zone / 100K 警告、Zechner 100K 劣化点、Vincent の長い仕事 100K、Gauthier
   25〜30K）、割合で語るのは HumanLayer の 40〜60% だけ。170K 発火はこの帯の最上位 1 名と同水準で、
   数字を言う他の全員より遅い。共通機構は「窓を広げる」ではなく「ディスク上の引き継ぎ成果物 +
   セッション / subagent の隔離」"* — and its own `unverified` list already contains the negative this
   record independently reproduces: *"200K 予算 + 170K 発火という組み合わせを公表している実践者は
   （この組み合わせを書いた一次記事は見つからず）"*. The distinction to keep is **operating budget
   versus configured value**: that record's numbers are budgets inferred from prose; this record's
   §1 numbers are literals in config files. Neither record found a named practitioner publishing
   *both* halves (a 200K-class budget and a 170K-class trigger). The one configured value inside
   that roster is HumanLayer's warning threshold, changed to a fixed 100,000 absolute and described
   as *"For opus 1m this is only 10% of the context window"* — TRANSCRIBED via that sibling, not
   re-verified here.
3. **Agreement with `2026-09-27-context-management-lab-guidance.md`.** Its verdict, verbatim:
   *"絶対トークン予算を人間向けの言葉で公表しているのは Amp（Sourcegraph）だけで、答えは「200k
   tokens is plenty」… Google は Gemini CLI の設定既定として 150,000 で切って 40,000 を残す絶対値を
   公表し、OpenAI は compaction ガイドの全 SDK 例で `compact_threshold: 200_000` をコーディングモデル
   に対して書く。Anthropic の絶対値は 100,000 …と 200,000 …"* Every lab absolute value in that set is
   in the same 100,000–200,000 band as the values practitioners set for themselves, which is why the
   house's 200K reads as *supported* rather than idiosyncratic — and why the 400,000 that
   practitioners converge on is **above every published lab recommendation**, including Amp's.
4. **Agreement with `2026-09-27-japanese-practitioner-context-practice.md`, including its negative.**
   Its verdict, verbatim: *"clear / compact の『数値』を出している日本語圏の実践者は実在するが、その
   数値は本人の判断基準ではなく道具側の自動発火点の実測である — 705 回の圧縮を実測して『圧縮前→後
   168,635 → 14,296 tok』…『閾値が16万〜18万トークンなら…』（Tsutomu_eng）、200K 窓の 80%＝160,000
   （pnd、`contextSize * 0.8`）… 人間が自分で先回りする基準を割合で示したのは toshi772 の『体感50〜60%
   を超えたあたりから、こまめに /compact』だけ"*. Japanese practice therefore also yields **no
   configured window value** — the 160,000/168,635 figures are *measured auto-fire points*, and the
   only human-chosen criterion is a percentage (50–60%), which lands at 100–120k on a 200K window and
   at 500–600k on a 1M window. Its `unverified` list also records the Speaker Deck corpus as
   metadata-only, so that corpus cannot enter this record as a configured value either.
5. **A contradiction inside one person.** Matt Silverlock sets Opus 4.6 to `context: 200000` in
   opencode with an explicit cost-motivated comment, and `contextWindow: 1000000` for the same model
   in his pi model catalogue. Both files are his, both within three weeks of each other. Whether the
   pi file is a mechanical catalogue dump or his operating budget is unresolved — see `unverified`.
   Reporting either alone would misrepresent him.

6. **Agreement with `2026-09-27-current-long-context-coding-measurements.md`, which supplies the
   arithmetic this record lacks.** Its verdict, verbatim: *"設定した窓を操作変数にした統制比較は
   2026-06〜09 に一件も存在しない。代わりに三種の測定が揃う。(1) 設定値→実効値の変換率 — Codex は
   利用者が `model_context_window` に何を書いても、同梱 models.json の `context_window` と
   `effective_context_window_percent`=95 の積で頭打ちになり、1,000,000 や 1,050,000 を書いた報告は
   すべて 258,400〜272,000 に着地する。OpenAI 自身が 2026-07-18 の PR #33972 で GPT-5.6 の同梱既定を
   372,000 から 272,000 へ下げている（ファイル差分で直接確認）。(2) コスト — 窓を上げると 1
   リクエストあたりの cache read が膨らむ。Cline #14329 は圧縮点が 0.81×窓 に連動する…"* The two
   records agree that no named practitioner has published both halves of a working configuration
   (a window and its effective value), and this record adds the reason: the effective value is only
   ever disclosed through bug reports. See §3b.

## 6. No precedent found

- **No named practitioner's public Claude Code `settings.json` containing a window value** was found
  in-window. Every in-window Claude Code value is an HN handle or a GitHub issue reporter.
- **No named practitioner publishes an omp config with `contextWindow` or `maxContextWindow`.** A
  GitHub code search for `maxContextWindow` restricted to YAML returned 2 hits, both anonymous repos
  (see below). Jellydn, the only named person here who ships an omp config
  (`configs/omp/config.yml`, 2026-08-05), sets only `modelRoles`, `theme`, `statusLine` and similar —
  no window key. → For omp specifically, "leaves the harness default" is the universal finding.
- **No named practitioner publishes an aider `max-chat-tokens` value.**
  `gh api search/code?q=max-chat-tokens+filename:.aider.conf.yml` returned `total_count: 0`.
- **No first-person report of running a session at a configured 1,000,000 with a trigger above
  900,000.** The highest configured trigger found is `swingboy`'s 900,000 (pseudonymous) and Nick
  Nisi's implied 1,033,616 (named, but the trigger is `reserveTokens: 16384` rather than an
  absolute).
- **No named practitioner publishes an LM Studio / llama.cpp `n_ctx`.** The local-runner values found
  are pi `contextWindow` fields (Mic92, Deldycke) at 262,144 / 65,536 / 32,768 — the local-model
  ceiling, not a chosen budget.
- **`anthropics/claude-code#45756`'s root cause is still open** (60 comments, opened 2026-04-09,
  state `open`). The incident that produced the 400k recommendation was never closed out.

- **No named practitioner reports the *effective* window their setting produced.** Every effective
  value found (258,400 / 828,400 / 1,033,616 / 250,000-after-fix) arrives either through a bug report
  or through arithmetic on a fixed reserve. Nobody published "I set X and the harness gave me Y" as a
  deliberate measurement. See §3b.

### Anonymous code-search hits, excluded as evidence

Recorded so the search is not repeated: `jellydn/my-ai-tools` was found via code search and *is*
usable (a named person's published toolkit). The following were found the same way and are **not**
evidence: `neomjs/neo`, `yutkat/dotfiles`, `fcakyon/claude-codex-settings`, `feiskyer/codex-settings`,
`serpro69/kotlin-faker`, `m-xlsea/ruoyi-plus-soybean`, `serpro69/claude-toolbox`, `tkersey/dotfiles`,
`makezur/agenticSTAR`, `jeremyckahn/dotfiles`, `ChrisTitusTech/titus-ai`,
`CAZAMA1/Codex-app-with-deepseek-perfectly`, `Jamie-BitFlight/claude_skills`,
`frozenpepper/deepseek-and-destroy`, `akitaonrails/ai-usagebar`, `j5ik2o/oni-comb-rs`,
`skanehira/dotfiles`, `btuckerc/boilerplate` (omp `private_models.yml`),
`scottgal/LLMApi`.

## 結論（一段落）

現行世代の名の知れた実践者が実際に設定している窓の値を並べると、答えは「200K か 1M か」の二択ではなく **「モデルの公称上限」と「圧縮をいつ撃ちたいか」の二層**である。1M 級を明示的に設定している例は 2 名あり、Nick Nisi（pi、1,050,000、`reserveTokens: 16384` で実質 1,033,616 発火、2026-09-16 に「1.05M へ opt in」と明記）と Jellydn（Codex、任意プロファイルで `model_context_window = 1050000` / `model_auto_compact_token_limit = 794000`、2026-08-21）だが、どちらも**既定を変えるのではなく追加のプロファイル／上書きとして**置いており、Jellydn の既定プロファイルは窓キーを一切持たない。逆方向は Matt Silverlock で、1M 級の Opus 4.6 を opencode の設定で明示的に `context: 200000` へ切り下げ、その理由を設定ファイルのコメントに「compaction at 200k tokens」と書いている。ベンダー側の一次証拠は Anthropic の Lydia Hallie が 2026-04-02 に利用者へ配った `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` と、Claude Code 責任者 bcherny が 2026-04-12 に「既定を 400k にし、1M まで設定可能にすることを検討中」と書いた issue コメントで、いずれも 2026-06-01 前＝**現行世代ではない**。設定を変えた結果の報告は 4 件中 3 件が失敗（Codex が 960,000 を黙って約 258K に切る `#19185`、`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` が発火しない `#52390`、`autoCompactWindow: 400000` が statusline に反映されない `#96473` 相当の `#96467`）で、成功例は Nick Nisi の pi だけである。したがってこの家の `contextWindow: 200000` + 1M 拡張窓という二層構造は業界の型と整合するが、**「200,000 という予算」を自分で選んで公開している名の知れた実践者はこの調査では 1 名（しかも切り下げ方向）しかおらず、個人が自分で決めた上限は 400,000 に集まっている**。次に動かすなら 200K ではなく 400K が候補であり、そのときも絶対トークンの圧縮点を必ず添えるべきである。ただし忘れてはならないのは、**設定した値は必ずしも効く値ではない**という点で、Codex は同梱カタログとの積で頭打ちにし、Cline は圧縮点を窓に連動させ、OpenAI は 2026-07-18 に自分の既定を 372,000 から 272,000 へ下げている。この家で 1M を名乗る設定を採るなら、`codex --profile 1m` などで実効窓を実測してからにするべきである。
