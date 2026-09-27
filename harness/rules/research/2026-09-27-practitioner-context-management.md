---
question: "著名な実践者は coding agent のコンテキスト窓をどう管理しているか — 何トークンまで許し、いつ compaction / clear / 新セッションへの引き継ぎを行い、subagent を隔離するか。この家の 200K 予算・170K 発火（200K 窓の 85%）は保守的なのか"
date: 2026-09-27
verdict: "保守的ではない。数字を言う実践者は 25K〜170K の絶対値に収まり（Huntley 170K 上限・実効 clipping 147〜152K、HumanLayer 75K smart zone / 100K 警告、Zechner 100K 劣化点、Vincent の長い仕事 100K、Gauthier 25〜30K）、割合で語るのは HumanLayer の 40〜60% だけ。170K 発火はこの帯の最上位 1 名と同水準で、数字を言う他の全員より遅い。共通機構は「窓を広げる」ではなく「ディスク上の引き継ぎ成果物 + セッション / subagent の隔離」"
unverified:
  - "Karpathy が context window を RAM や資源制約として語った一次発言（x.com は egress 遮断、nitter の該当 tweet は 404。RAM の比喩で到達できたのは Huntley の IBM 8086 XT のみ）"
  - "HumanLayer の smart zone / dumb zone の一次動画（youtu.be/rmvDxxNubIg）— 75K は同社ブログ本文の記述としてのみ確認"
  - "HumanLayer の自社警告しきい値の算術（168K の 40% が約 100K と書くが 168K×0.4 = 67K。分母の説明なし）"
  - "Armin Ronacher が subagent を context 隔離に使うという記述の canonical URL（取得した本人の 2 記事には無い）"
  - "200K 予算 + 170K 発火という組み合わせを公表している実践者（この組み合わせを書いた一次記事は見つからず）"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Do named practitioners keep an agent's context window small, and at what number?

## 方法と検証凡例

- **DIRECT** — この調査セッションで一次ページを直接取得し、返答に verbatim 引用が含まれる。
- **TRANSCRIBED** — 引用を第三者ページ経由で取得（そのページ自体は DIRECT）。canonical URL を併記する。
- **UNREACHABLE** — 取得できなかった。「見つからない」は「到達不能」を意味し、不存在の証明ではない。
- 本文は英語、frontmatter は日本語（`2026-09-27-practitioner-agent-approval-practice.md` と同じ理由 — 引用を原文のまま保つため）。
- `web_search` はこの egress の全プロバイダで遮断。X は `nitter.tiekoetter.com` の tweet ページのみ到達可（プロフィール/タイムラインは 404、`xcancel.com` 451、`nitter.privacyredirect.com` は bot-check）。`r.jina.ai` 経由の検索はクエリにより CAPTCHA で落ちる。
- **担当範囲**: 実践者の自己申告（four lenses の 2 番目）。ベンダーの既定トリガーと劣化測定（RULER / NoLiMa / Chroma / arXiv 2605.12366）は `2026-09-27-compaction-defaults-across-harnesses.md` が既に扱っており、本記録は再導出しない。承認 / 実行ゲートは `2026-09-27-practitioner-agent-approval-practice.md` と `2026-09-27-code-execution-gating-across-agents.md`。
- 商業利害は各名の節に明記する。「無し」は「その製品の収益が context policy に依存しない、または販売物が見つからなかった」の意味。

## 問いの形

この家は omp を `contextWindow: 200000`、圧縮発火 170,000 で走らせている（`rules/decisions/2026-09-24-context-window-budget-200k-extended-1m.md`）。すなわち**窓の 85% まで詰めてから圧縮する**。外の実践者がこの 85% をどう見るかが問い。

## 見出し表 — 数字を言った実践者だけを並べる

| 名前 | 述べた運用 | 数値（絶対トークン） | 窓に対する比 | 日付 | 凡例 |
|---|---|---|---|---|---|
| Geoffrey Huntley | ループごとに新しい文脈。主窓はスケジューラ、実作業は subagent | **約 170K が上限** | 200K の 85% | 2025-07-14 | DIRECT |
| Geoffrey Huntley | 200K 公称窓での実効頭打ち | **147K〜152K で品質が clipping** | 200K の 74〜76% | 2025-04-13 | DIRECT |
| Dex Horthy (HumanLayer) | frequent intentional compaction。作業中の利用率目標 | **窓の 40〜60%** | 40〜60% | 2025-08-29 | DIRECT |
| Dex Horthy (HumanLayer) | claude 系で留まるべき帯 | **約 75K の smart zone** | 200K の 38% | 2025-12-09 | DIRECT |
| Kyle (HumanLayer) | ツールの警告は 1M モデルでも絶対値 | **100K で警告**（旧: 168K 窓の 40%） | 1M の 10% | 2026-03-23 | DIRECT |
| Mario Zechner (pi) | 崩れ始めの実感点。圧縮を積まずに数百往復 | **約 100K で崩れる** | 200K の 50% | 2025-06-02 | DIRECT |
| Jesse Vincent (obra) | 計画→実装の長い chat の総量 | **100K**（引き継ぎ doc は 2K 未満） | — | 2025-10 | TRANSCRIBED |
| Paul Gauthier (aider) | コーディングでは大きな窓は役に立たない | **約 25〜30K で混乱** | — | 2025-01-26 | TRANSCRIBED |
| Workaccount2（HN、偽名） | context rot の onset | **約 100K** | Gemini 2.5 | 2025-06-18 | TRANSCRIBED |
| Dex Horthy | subagent の設計単位（数字ではなくステップ数） | 3〜10、最大 20 ステップ | — | 2025-04-03 | DIRECT |

数字を一切言わないが運用を明示した実践者: Mitchell Hashimoto（計画と実行のセッション分割、subagent 不要、圧縮機構には触れない）、Steve Yegge（memory decay 型の圧縮、`bd remember` で 1 段落だけ全セッションに押し込む）、Drew Breunig（失敗 4 型と対策 6 種。自分では数値を推さない）、Mario Zechner（MCP ツール定義が窓の 7〜9% を食う、システムプロンプト＋ツール定義で 1,000 トークン未満）。

---

## 1. Geoffrey Huntley — 170K の出所、そして 147K での clipping

商業利害: 独立（製品の販売なし）。記事と OSS のみ。`ghuntley.com/ralph/`（2025-07-14 公開、ページは 2026-02-19 更新）DIRECT、節 "one item per loop":

> The name of the game is that you only have approximately 170k of context window to work with. So it's essential to use as little of it as possible. The more you use the context window, the worse the outcomes you'll get. Yes, this is wasteful because you're effectively burning the allocation of the specifications every loop and not reusing the allocation.

同じページの節 "extend the context window":

> Ralph requires a mindset of not allocating to the primary context window. Instead, what you should do is spawn subagents. Your primary context window should operate as a scheduler, scheduling other subagents to perform expensive allocation-type work, such as summarising whether your test suite worked.

`ghuntley.com/subagents/`（2025-04-13）DIRECT:

> Claude 3.7's advertised context window is 200k, but I've noticed that the quality of output clips at the 147k-152k mark. Regardless of which agent is used, when clipping occurs, tool call to tool call invocation starts to fail

> The short version is that we are in another era of "640kb should be enough for anyone," and folks need to start thinking about how the current generation of context windows is similar to RAM on a computer in the 1980s until such time that `DOS=HIGH,UMB` becomes a thing...

> However, I've been thinking: What if an agent could spawn a new agent and clone the context window? If such a thing were possible, it would enable an agent to spawn a sub-agent. The main agent would pause, wait for the sub-agent to burn through its own context window (ie. SWAP), and then provide concrete next steps for the primary agent.

**日付の注意（重要）**: 両記事は 2025-04（subagents）と 2025-07（ralph）で、Karpathy が「コーディングエージェントは 12 月以前は実質動かず、以後は動く」と述べたとされる capability step より**前**。170K を引用する第三者は多いが、数値そのものは 2025 年前半の Claude 3.7 期の実測である。

**この 170K を「上限」として読む理由**: Huntley は 170K を「使ってよい枠」ではなく「使える余地はこれしかない」として提示し、直後に "as little of it as possible" と言う。この家の 170K は同じ数字だが向きが逆（170K まで使ってから圧縮）。

## 2. Dex Horthy と Kyle（HumanLayer） — 数値が最も揃っている、最も厳しい一群

商業利害: **HumanLayer は coding agent の control plane / SDK を売る会社**（記事末尾で codelayer の private beta を宣伝、2026-01-06 時点で「近日新製品」）。Dex は 12-factor agents の共著者、Kyle は同社。彼らの結論（窓を小さく保て）は自社製品の価値提案と一致する。この方向のバイアスは差し引いて読む必要がある。

### 2a. 40〜60% — `advanced-context-engineering`（Dex、2025-08-29）DIRECT

> Again, this is all built around a workflow we call frequent intentional compaction - essentially designing your entire development process around context management, keeping utilization in the 40-60% range, and building in high-leverage human review at exactly the right points.

> **Compaction** is simply distilling them into structured artifacts.

手動 compaction の実 prompt（そのまま使える形で載っている）:

> "Write everything we did so far to progress.md, ensure to note the end goal, the approach we're taking, the steps we've done so far, and the current failure we're working on"

> Subagents are not about playing house and anthropomorphizing roles. Subagents are about context control.

> You should optimize your context window for:
> 1. Correctness
> 2. Completeness
> 3. Size
> 4. Trajectory
>
> Put another way, the worst things that can happen to your context window, in order, are:
> 1. Incorrect Information
> 2. Missing Information
> 3. Too much Noise

「やめて、セッションを捨ててやり直す」も明示されている（自動圧縮より優先）:

> A slightly smarter way is to just start over when you get off track, discarding your session and starting a new one, perhaps with a little more steering in the prompt.

同ページは Huntley の 170K を引用する（TRANSCRIBED、canonical `https://ghuntley.com/ralph/`）。独立した二度目の実測ではなく、同一出典の再掲である。

### 2b. 約 75K の smart zone — `context-efficient-backpressure`（Dex、2025-12-09）DIRECT

> You should try hard to stay in the [~75k token "smart zone"](https://youtu.be/rmvDxxNubIg?si=bbPvQb6-etG5wD_I&t=347) for claude models - every line of `PASS src/utils/helper.test.ts` is waste.

> Or worse, if all tests are passing, you just threw away 2-3% of your context window for an "all good" result you could have conveyed in less than 10 tokens.

> You're **wasting context** - every token you use is diminishing the results and moves you closer to "need to clear or compact to get back to the smart zone".

実装は `run_silent()`（成功時は `✓` 一行、失敗時のみ全出力）。「テスト 1 回で窓の 2〜3%」は 200K 窓で 4,000〜6,000 トークンであり、170K までに何回ツールを回せるかの見積りに直結する。

同記事は「モデル側が最近 context を恐れすぎている」という**逆向きの証言**も含む（`/dev/null` へ捨てる、`| head -n 50` で長いテストを再実行させる）:

> In this trivial example, the guardrails actually use MORE TOKENS

### 2c. 100K で警告 — `long-context-isnt-the-answer`（Kyle、2026-03-23）DIRECT

**この記事はこの家の問い（1M 窓に対してどう予算を取るか）に最も直接に答える一次情報である。**

> Anthropic just switched the default model in Claude Code to Opus 4.6 with a 1M context window. We tried it when it launched. But now we're switching back to Opus 4.5

> While the context window is dramatically larger, we noticed over the course of a couple of weeks that instruction adherence was dramatically degraded, and not just at longer context lengths.
>
> Even well-within what we would consider the smart zone of a 200k-context frontier model, the model was less precise. It would ignore design documents and other inputs when writing a plan file. It would make trivial mistakes, or misunderstand simple instructions - or worse, directly disobey them.
>
> At longer context lengths, the degradation was even steeper - like the user instructions were getting drowned out by the intermediate tool results and mass of accumulated context.

機構の説明（拡張窓は「より大きいモデル」ではない）:

> This means that while the context window size increases, the instruction budget remains the same. You can fit more context and more instructions in the context window, but the model isn't actually better at attending to those instructions over the context length.

> Now imagine we increase the size of the haystack by 500% - but the size of the needle remains the same. Unless our ability to find the needle also increases by 500%, we will have a dramatically harder time finding it. The extra context isn't really helping us - it's just digging us deeper into the dumb zone.

**自社ツールの警告しきい値（実装として世に出ている数字）**:

> We have had a feature in the tool for a while that warns the user when they're context is getting high. We used to set this at around %40 of sonnets 168k token window (200k - 32k reserved for output). This came out to about 100k tokens.
>
> To help users maximize instruction adherence and intelligence on hard codebase problems, we've updated our context warnings for long-context models to trigger at the 100k token mark instead of 40% of the usable context. For opus 1m this is only 10% of the context window.

（算術の不整合: 168K の 40% は 67K であり 100K にならない。分母の定義は本文で説明されていない。数値はそのまま記録する。）

TL;DR（そのまま）:

> 1. Long-context models degrade at all context lengths, not just long ones.
> 2. More context isn't more capability - the instruction budget doesn't scale with the context window.
> 3. Context isolation beats context expansion. Sub-agents, progressive disclosure, and context-efficient backpressure keep each context window small, focused, and in the smart zone.

同記事が載せる subagent 強制 skill の文面（そのまま流用できる形）:

> This skill provides you with **CRITICAL** instructions that will help you to maintain coherency in long-horizon context-heavy tasks.
> [...]
> All non-trivial operations should be delegated to sub-agents.

また Codex 立ち上げに関わった Calvin French-Owen（YC Lightcone、TRANSCRIBED 同ページ内）の比喩を引く:

> ...imagine you're a college student. You're taking an exam. In the first five minutes of that exam, you're like, "Oh, I have all the time in the world. I'll do a great job. I'll think through each of these problems."
>
> Let's say you have like five minutes left and you still have half the exam left. You're like, "Oh man, I just got to do whatever I can." Like, that's the LLM with a context window

### 2d. subagent = context firewall — `skill-issue-harness-engineering-for-coding-agents`（Kyle、2026-03-12）DIRECT

> After months of solving hard problems in complex brownfield enterprise-scale codebases, we have found that sub-agents are a particularly powerful lever. When working on hard problems that require many, many context windows to solve, **sub-agents are the key to maintaining coherency across many sessions**. Sub-agents **function as a "context firewall"** that ensures discrete tasks can run in isolated context windows so none of the intermediate noise accumulates in your parent thread which is responsible for orchestration, and you can maintain coherency for much, much longer.

> Breaking work up into discrete tasks and delegating it to sub-agents is how we keep our primary coding agent thread in the "smart zone."

> We've seen this firsthand: plug too many MCP tools into your agent, and the context window fills up with tool descriptions, pushing you into the dumb zone much faster

同記事は ETH Zurich の agentfile 研究（arXiv:2602.11988）を引用し、常時ロードされる指示そのものが窓を食うことを数値で示す:

> - that LLM-generated ones actually *hurt* performance while costing 20%+ more
> - human-written ones only helped about 4%.
> - Agents spent 14-22% more reasoning tokens processing context file instructions, took more steps to complete tasks, ran more tools — all without improving resolution rates.

> Our CLAUDE.md is under 60 lines.

### 2e. 巻き戻しで窓を救う — `context-forking-to-save-time-trouble-and-tokens`（Kyle、2026-05-15）DIRECT

> I like to conceptualize agent context windows as [downwards-growing stacks](https://wiki.osdev.org/Stack), inspired by stacks from operating systems

> Like a stack, coding agent context windows usually **prevent random access**. You can push things to the end of it by sending a user message, and you can pop (remove) things from the end.

> 4. Context forking can be used to restore a context window to a state before a large volume of low-quality context was added.

→ これは承認（`2026-09-27-practitioner-agent-approval-practice.md`）とは別物で、**圧縮より前に窓を戻す**という第三の機構。

### 2f. ループ型でも「小分け」が本体 — `brief-history-of-ralph`（Dex、2026-01-06）DIRECT

> Beyond that, it misses the key point of ralph which is not "run forever" but in "carve off small bits of work into independent context windows".

> **Lesson** - for existing codebases, make the change set manageable - we have since set up any ralph-ish desired state loops to once ONCE on a cron overnight, and merge small iterations over time.

## 3. Mario Zechner（pi の作者） — 「窓を広げる」ではなく「窓に入れない」

商業利害: pi は OSS（`badlogic`）。彼自身がハーネス作者であり、「既存ハーネスは context engineering をさせてくれない」という主張は自製品の差別化と一致する。context policy そのものを売っているわけではない。

`mariozechner.at/posts/2025-06-02-prompts-are-code/`（2025-06-02）DIRECT:

> Then there's context degradation. As your session progresses and pulls in more files, tool outputs, and other data, things start falling apart around 100k tokens. Benchmarks be damned. Whatever tricks LLM providers use to achieve those massive context windows don't work in practice. The model loses track of important details buried in the middle of all that context.

> **State** evolves as the program runs. Some lives in the context, but we treat that as ephemeral: compaction will eventually wipe it (trololo). Plus, you'll quickly hit context limits with any substantial state. So we serialize to disk using formats LLMs handle well: JSON ... Markdown ... The payoff? You can resume from any point with a fresh context, sidestepping the dreaded compaction issue entirely.

`mariozechner.at/posts/2025-11-30-pi-coding-agent/`（2025-11-30）DIRECT — 実測トークン数が入っている:

> Popular MCP servers like Playwright MCP (21 tools, 13.7k tokens) or Chrome DevTools MCP (26 tools, 18k tokens) dump their entire tool descriptions into your context on every session. That's 7-9% of your context window gone before you even start working.

> pi's system prompt and tool definitions together come in below 1000 tokens.

> Twitter is full of context engineering posts and blogs, but I feel like none of the harnesses we currently have actually let you do context engineering.

**subagent を意図的に持たない、という少数派の立場**（この家の omp は pi 系であり、この判断は直接関係する）:

> pi does not have a dedicated sub-agent tool. [...]
>
> But more importantly: fix your workflow, at least the ones that are all about context gathering. People use sub-agents within a session thinking they're saving context space, which is true. But that's the wrong way to think about sub-agents. Using a sub-agent mid-session for context gathering is a sign you didn't plan ahead. If you need to gather context, do that first in its own session. Create an artifact that you can later use in a fresh session to give your agent all the context it needs without polluting its context window with tool outputs. That artifact can be useful for the next feature too, and you get full observability and steerability, which is important during context gathering.

> Spawning multiple sub-agents to implement various features in parallel is an anti-pattern in my book and doesn't work, unless you don't care if your codebase devolves into a pile of garbage.

**そして圧縮自体を否定する**（2025-11-30 時点）:

> There are a few more features I'd like to add, like compaction or tool result streaming, but I don't think there's much more I'll personally need. Missing compaction hasn't been a problem for me personally. For some reason, I'm able to cram hundreds of exchanges between me and the agent into a single session, which I couldn't do with Claude Code without compaction.

> In earlier Claude Code versions, the agent forgot about all its background processes after context compaction and had no way to query them.

**実地の裏取り（このセッションで `gh api` 直接）**: `earendil-works/pi` issue #92 "Context compaction for long sessions" は 2025-11-30 に立てられ、本文は "See packages/coding-agent/docs/compaction.md for research on how Claude Code, Codex CLI, OpenCode, and Amp handle this."、**2025-12-04 に `state_reason: completed` でクローズ**（author `badlogic`、「Implemented in v0.12.7」）。

→ **重要な日付事実**: pi にネイティブ圧縮が入ったのは **2025 年 12 月**。11-30 の「数百往復を 1 セッションに収められる」証言は、その機能を持たないハーネス上での証言である。pi の **subagent を持たない**設計判断（2025-11-30）はそれより前で、その後変わった証拠は見つからなかった。

## 4. Jesse Vincent（obra） — compact せず clear する

商業利害: `obra/superpowers` などの OSS 作者（`obra/superpowers` は **292,067 stars**、2026-09-27 02:37 UTC に push — このセッションで `gh api` 直接）。製品の販売なし。

`blog.fsck.com/2025/10/05/how-im-using-coding-agents-in-september-2025.md`（2025-10-05）**このセッションで再取得して verbatim 確認**:

> And then,  I don't `*/compact*`. Instead I `*/clear*` the implementer and start the conversation over. Telling it that it's starting with task 4.

> When it's done with the next chunk of work, I flip back to the architect. I typically double-`ESC` to reset the architect to a previous checkpoint and tell it to review up to the now-current checkpoint. This reduces context bloat for the architect and gets it to look at again without any biases from the previous implementation.

2 セッション構成そのもの（同一 worktree で別タブ）:

> Next up, I open a *new tab* or window in the same working directory and fire up another copy of claude.

「fresh eyes」派との対立も明示される（自分が多数派でないことに本人が言及）:

> (I have friends who, instead of using multiple sessions, swear that just asking the implementer to look at their most recent work `with fresh eyes` is good enough. And indeed, using that magic phrase seems to be pretty powerful. I still think that having two different actors is better.)

計画書が「詰まった文脈」の運搬体であることも書いている:

> This results in a plan that breaks everything down into tiny little steps with clear instructions and tightly packed context for each step. That means that at execution time, I usually don't need to provide tight step by step oversight.

Vincent の自己申告する総量（TRANSCRIBED、Simon Willison の `sub-agents` タグページ内で引用、canonical `https://bsky.app/profile/s.ly/post/3m2srmkergc2p`）:

> The core of it is VERY token light. It pulls in one doc of fewer than 2k tokens. ... The long end to end chat for the planning and implementation process for that todo list app was 100k tokens.
>
> It uses subagents to manage token-heavy stuff, including all the actual implementation.

## 5. Simon Willison — 数字を出して subagent を測った唯一の実践者

商業利害: 個人ブログ（スポンサー枠あり。2026-09-03 の記事では Greptile がスポンサー表記）。製品的利害なし。

- `simonwillison.net/tags/sub-agents/` DIRECT — タグ自体の定義が「別の LLM エージェントを **fresh token context** で走らせる」。2025-10-11 に**意図的に subagent を発火させた実験**を公開し、各 subagent のトークン数を個別に記録している（86.4K / 55.4K / 85.2K / 78.7K / 116.1K）。本調査で見つかった**唯一の subagent 単位トークン会計**。
- 同じページで Anthropic の multi-agent 研究を引用（TRANSCRIBED）: "agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats"。**タスク種別は研究/調査でありコーディングではない。**
- `simonwillison.net/2025/Jun/18/context-rot/` DIRECT — "context rot" という語を広めた HN 投稿を引用（TRANSCRIBED、canonical HN permalink は同ページ内）:

> Even with good context the rot will start to become apparent around 100k tokens (with Gemini 2.5).

> Right now I work around it by regularly making summaries of instances, and then spinning up a new instance with fresh context and feed in the summary of the previous instance.

（投稿者は偽名 Workaccount2。**「名の知れた実践者」の数値ではない**が、100K という同じ数字が別の系から独立に現れる点で記録に値する。）
- `simonwillison.net/tags/long-context/` DIRECT — aider 作者 Paul Gauthier の HN 発言を引用（TRANSCRIBED）:

> In my experience with AI coding, very large context windows aren't useful in practice. Every model seems to get confused when you feed them more than ~25-30k tokens. ... It's perhaps the #1 problem users have, so I created a dedicated help page.

- `simonwillison.net/2026/Sep/3/gpt6-astra/` DIRECT（このセッションで取得）— **逆向きの最新証拠**:

> It's also better at long context: on OpenAI's eight-needle benchmark it got 100% at 256K-512K tokens and 96.3% at 512K-1M tokens. OpenAI may have vanquished one of the ongoing challenges with long context processing.

→ 2026-09 時点で「長文脈は不得意」という前提そのものが揺れている可能性を示す唯一の項目。ただし needle-in-a-haystack 型であり、エージェントのコーディング作業ではない（Chroma の context rot 研究を引用して HumanLayer 自身が "which is admittedly quite different from agentic coding" と断っているのと同じ限定）。

## 6. Mitchell Hashimoto — 数字を持たないが、いちばん近い「実務の型」

商業利害: **無し**。本人の明言あり（`mitchellh.com/writing/my-ai-adoption-journey`、2026-02-05、DIRECT）:

> I don't work for, invest in, or advise any AI companies.

同記事（DIRECT）:

> 1. Break down sessions into separate clear, actionable tasks. Don't try to 'draw the owl' in one mega session. 2. For vague requests, split the work into separate planning vs. execution sessions.

> **Very important at this stage: turn off agent desktop notifications.** Context switching is very expensive...

> To be clear, I did not go as far as others went to have agents running in loops all night.

> **I'm not [yet?] running multiple agents, and currently don't really want to.**

ハーネス工学の定義（HumanLayer が引用、canonical は本人のページ）:

> [...] is the idea that anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again.

**この記録にとっての意味**: 「セッションを分ける」「計画と実行を分ける」は数値なしで一致するが、**トークン予算も圧縮機構も `/clear` も述べていない**（明示的負例、後述）。

## 7. Steve Yegge — 月間消費は語るが、セッション窓の予算は語らない

商業利害: Gas Town / Beads（`gastownhall/beads`、27,467 stars、2026-09-27 10:59 UTC に push — このセッションで `gh api` 直接）。OSS だが本人のブランドと結びつく。

`raw.githubusercontent.com/steveyegge/beads/main/README.md` DIRECT:

> Compaction: Semantic 'memory decay' summarizes old closed tasks to save context window.

`yegge.ai/essays/the-shape-of-things-to-come/` DIRECT（Wyvern's Brain 表）: `brain/`（月〜年、必要時に引く）、`doc/`（システムの寿命）、Beads issue は担当者のみロード、`bd remember` で **1 段落以下**を毎セッションに押し込む、`.claude/skills/` はタスク一致時に自動ロード。本人の言葉:

> I've accumulated about 30 Skills so far. And my project brain is about 100 markdown files

> private Skills are quite useful for encoding organizational know-how, which helps reduce token spend when agents are priming for a job

数字は**コスト側にだけ**ある: $87k/月、7 月に 69B トークン、cache hit 96%、Max アカウントを 12 本追加、list price 換算の約 30 倍、自腹 $2,800/月、12,000 commits/日、18 名の named agent。**セッションあたりの窓予算は一度も述べていない。**

混同の禁止: `beads` の `bd admin compact` / `docs/cli-reference/compact.md`（`--days` 既定 30）は **Dolt のストレージ compaction** でありコンテキスト圧縮ではない。コンテキスト側は `examples/compaction/README.md`（closed issue の semantic compaction、`auto-compact.sh --threshold 50`、cron 月次）である。

## 8. Drew Breunig — 語彙を提供したが、数字は推さない

商業利害: ブログのみ（製品なし）。

`dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html` および `.../2025/06/26/how-to-fix-your-context.html` DIRECT。失敗 4 型:

> Context Poisoning / Context Distraction / Context Confusion / Context Clash

閉じの主張:

> The key insight across all the above tactics is that *context is not free*. Every token in the context influences the model's behavior, for better or worse. The massive context windows of modern LLMs are a powerful capability, but they're not an excuse to be sloppy with information management.

対策 6 種は **RAG / Tool Loadout / Context Quarantine / Context Pruning / Context Summarization / Context Offloading**。**数値はすべて第三者から引いたもの**（Provence が記事の 95% を削る、ツール 30 未満で精度 3 倍、46→19 ツールで失敗が成功に反転、Llama 3.1 8b で +44%、think-tool で最大 54%）。**彼自身の推奨トークン数は無い**（明示的負例）。

## 9. その他の名 — 明示的負例つき

- **Tobi Lütke**（`nitter.tiekoetter.com/tobi/status/1935533422589399127`、2025-06-19、DIRECT）: "context engineering" の語を広めた発言のみ。**予算・圧縮・subagent の記述なし**。商業利害: Shopify CEO（モデルベンダーではないが AI 製品の売り手）。
- **Boris Cherny**（Claude Code 責任者、Anthropic）: `nitter.tiekoetter.com/bcherny/status/2098217573276131577`（2026-09-11、DIRECT）は本番品質のガードレールと "Increase effort to high or xhigh" の話。**コンテキスト予算・圧縮の方針は述べていない**。商業利害: ベンダー側。Ronacher が引用する "I don't prompt Claude anymore. I have loops running that prompt Claude..." はループの話で、窓の話ではない（TRANSCRIBED）。
- **Armin Ronacher**: `lucumr.pocoo.org/2025/6/12/agentic-coding/` と `.../2026/6/23/the-coming-loop/` を取得。**どちらにもトークン予算の記述なし**。商業利害: 無関係（勤務先は Sentry）。
- **Thorsten Ball**: `registerspill.thorstenball.com/archive` と `thorstenball.com/` を取得。**コンテキスト管理の記述は見つからず**（アーカイブは Joy & Curiosity の週報のみ）。商業利害: Amp 関係者（vendor-adjacent）。
- **Salvatore Sanfilippo (antirez)**: `flux2.c` の implementation notes を**直接取得しようとして HTTP 404**（`raw.githubusercontent.com/antirez/flux2.c/main/IMPLEMENTATION_NOTES.md`）。ただし Simon Willison の 2026-01-18 記事内の引用は TRANSCRIBED で得られている:

> this project was possible only once I started to tell Opus that it needed to take a file with all the implementation notes... the file had clear instructions to be taken updated, and to be processed ASAP after context compaction.

（**この記録で見つかった唯一の「圧縮直後に処理せよ」という明示指示。**ただし canonical なページ URL は取得できていない。）
- **Andrej Karpathy**: 「compacting」を列挙に含む context engineering の tweet（`nitter.tiekoetter.com/karpathy/status/1937902205765607626`、2025-06-25、DIRECT、2,400,017 views）は確認済みだが、**窓管理の運用（何トークンまで、いつ圧縮）は述べていない**。`nitter.tiekoetter.com/karpathy/status/1976082963382272334`（2025-10-09、DIRECT）は例外処理の話で context とは無関係。RAM の比喩は **Huntley のもの**（IBM 8086 XT）であり、Karpathy に帰属させる根拠は得られなかった。

## ベンダー（この記録では追加のみ）

`2026-09-27-compaction-defaults-across-harnesses.md` が既定トリガー（Claude Code 約 967K、pi `contextWindow - reserveTokens`、Cline `max(contextWindow-40_000, contextWindow*0.8)` 等）を既に扱っている。ここでは**実践者の数字と直接比較するために必要な点だけ**追加する:

- Anthropic 自身の long-context プロンプティング指針（`simonwillison.net/tags/long-context/` 経由、TRANSCRIBED、canonical `docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/long-context-tips`）は、長文を**上**に置き、引用を先に抽出させることを推奨する。**「窓を小さく保て」というベンダー側の指示は無い。**
- OpenAI 側: compaction は「ネイティブな複数コンテキスト窓の操作」として製品化されており（GPT-5.1-Codex-Max、2025-11-19）、ARC-AGI の "Provider Adapter harness" も "preserves opaque reasoning state between requests and uses compaction for longer conversations"（`simonwillison.net/2026/Sep/3/gpt6-astra/` が ARC-AGI ブログを引用、TRANSCRIBED）。**ベンダーは「圧縮して続ける」方向に投資しており、「窓を小さく保つ」方向ではない。**

## 測定エビデンス（追加のみ）

- 劣化の定量（RULER / NoLiMa / Chroma / arXiv 2605.12366）は `2026-09-27-compaction-defaults-across-harnesses.md` が扱う。ここでは HumanLayer 自身が Chroma 研究を引用しつつ**「needle-in-a-haystack は agentic coding とはかなり違う」**と限定している点だけ引く（DIRECT）:
  > Chroma researchers tested 18 models on needle-in-a-haystack tasks, which is admittedly quite different from agentic coding. But the finding matches our experience exactly: performance degrades as context length increases — even on simple tasks.
- 常時ロードされるツール定義が窓を食う唯一の実測（Zechner、DIRECT）: Playwright MCP 21 tools = 13.7K トークン、Chrome DevTools MCP 26 tools = 18K トークン = 窓の 7〜9%。同じ主張の第三者数値（ツール 30 未満で精度 3 倍）は Breunig 経由。
- 指示ファイルの実測（ETH Zurich、arXiv:2602.11988、`skill-issue-...` 経由 TRANSCRIBED）: 推論トークン +14〜22%、人手執筆でも改善は約 4%、LLM 生成は 20% 以上のコスト増で性能は悪化。

## 実地（公開リポジトリ・実装としての裏取り）

このセッションで `gh api` を直接叩いた値（すべて 2026-09-27 取得）:

| 対象 | 値 | 意味 |
|---|---|---|
| `obra/superpowers` | 292,067 stars、最終 push 2026-09-27 02:37 UTC、archived=false | 「clear して新セッション」型のワークフローを配布する実装が現役で最大級の採用 |
| `gastownhall/beads` | 27,467 stars、最終 push 2026-09-27 10:59 UTC | 「圧縮＝意味的減衰」型の記憶系が現役 |
| `humanlayer/humanlayer` | 11,615 stars、最終 push 2026-06-19 | 100K 警告を実装した本人たちの本体（2026-06 以降 push なし） |
| `earendil-works/pi` issue #92 | "Context compaction for long sessions"、2025-11-30 起票 → 2025-12-04 `completed`（v0.12.7） | 圧縮を持たないことを意図していたハーネスが、約 1 年で compaction を実装した |

## 合意していること

1. **窓を広げるより、窓に入れない**。HumanLayer（context firewall / 40〜60%）、Huntley（主窓をスケジューラに）、Zechner（セッションを分けて artifact を作る）、Vincent（clear してタスク単位で渡す）、Yegge（memory decay + `bd remember` 1 段落）、Breunig（Context Quarantine / Offloading）が、機構の名前は違えど同じ結論。
2. **引き継ぎ成果物はディスク上の Markdown**。Horthy `progress.md` / plan ファイル、Vincent の plan ドキュメント、Zechner `PLAN.md` / `TODO.md`、antirez の implementation notes、Yegge の brain / beads。**「文脈を要約して次に渡す」の実装は全員ファイル経由**。
3. **数字は絶対値で語られる**。割合で語ったのは HumanLayer の 40〜60%（と同社の旧 40%）だけ。25〜30K、75K、100K、147〜152K、170K はすべて絶対トークン。
4. **上限を「窓いっぱい」と言う実践者はゼロ**。最も高い数字を出した Huntley ですら "as little of it as possible" と言い、147〜152K で clipping を観測している。

## 対立していること

1. **subagent は必須か**。Huntley / Horthy / Kyle / Willison は「窓を分ける主要機構」とする。Zechner は **pi に subagent を持たせない**ことを設計判断とし、セッション内 subagent を「計画不足のサイン」と呼ぶ。Hashimoto は単一エージェント運用。Vincent は subagent ではなく**人間が回す 2 セッション**を選ぶ。
2. **ネイティブ圧縮を使うか**。Kyle は警告を出し、Horthy は手動の intentional compaction を使う（自動より手動）。Vincent は「compact せず clear する」。Zechner は 2025-11 時点で圧縮そのものが不要と述べ（後日 pi に実装）、antirez は圧縮後に確実に処理される instructed file を要求する。
3. **劣化の始点**。25〜30K（Gauthier、コーディング）、75K（Horthy）、100K（Kyle / Zechner / Vincent の総量 / Workaccount2）、147〜152K（Huntley の clipping）、170K（Huntley の上限）まで 7 倍の幅がある。**どの数字も「200K では足りない」方向には動いていない。**

## この家の数字は保守的なのか — 明示的な答え

**いいえ。170K 発火＝200K 窓の 85% は、この実践者集団の中では最上位の 1 名（Huntley）と同水準であり、数字を公表している他の全員より遅い。**

| この家 | 実践者の同種の数字 | 差 |
|---|---|---|
| 発火 170,000（85%） | Huntley の**上限** 170K（85%）、clipping 147〜152K（74〜76%） | 同じ数字だが向きが逆（Huntley は「これしかない」、家は「ここまで使う」） |
| 予算 200,000 | HumanLayer の警告 **100K**（200K 窓の 50%） | 実践者の警告水位は家の予算の半分 |
| 予算 200,000 | Horthy の smart zone **約 75K**（200K 窓の 38%） | 約 2.3 倍の差 |
| 予算 200,000 | Gauthier **25〜30K**（コーディング） | 約 7 倍の差 |
| 利用率の目標なし | HumanLayer **40〜60%**、全員が "as little as possible" | 家は目標利用率を持たず上限だけを持つ |

**ただし「すべての数字が保守しすぎを意味する」わけではない**: 家の 200K **予算**は、ベンダー既定（窓の 50〜98%）と比べれば保守的である — これは `2026-09-27-compaction-defaults-across-harnesses.md` の結論と一致する。論点は**発火点**である。200K 予算に対して 170K で発火させるのは、実践者の警告帯（75K〜100K）の上を通り抜ける設定であり、実践者リスクの観点ではむしろ攻めた側に属する。

## 既存記録との矛盾（親への報告事項）

1. **`2026-09-27-compaction-defaults-across-harnesses.md` との部分矛盾**。同記録の verdict は「保守的。…数値で作業予算を推す一次情報も 200K を最適とする測定も無い」と述べる。前半（ベンダー既定に対する保守性）は本記録の証拠と整合する。**後半「数値で作業予算を推す一次情報も無い」は本記録と矛盾する** — Huntley（170K）、Horthy（75K / 40〜60%）、Kyle（100K）、Zechner（100K）、Gauthier（25〜30K）が絶対値で作業予算を述べている。同記録の主張は「200K を最適とする一次情報や測定は無い」としては正しいが、**「数値を推す一次情報が無い」は言い過ぎ**であり、本記録（同日）がその反例を列挙する。
2. **`rules/decisions/2026-09-24-context-window-budget-200k-extended-1m.md` との関係**。決定は「予算をプロバイダ最大にしてはならない」であり、実践者証拠はこれを支持する（どの実践者も 1M を使い切るとは言わない。唯一の 1M 言及は HumanLayer の「1M の 10% = 100K」という警告設定で、これも「1M を使い切らない」側）。**しかし発火点の設計では矛盾する**: 決定が却下したパターンは「圧縮トリガーを窓に比例させる」ことだったが、omp の `effectiveReserveTokens = max(floor(contextWindow * 0.15), reserveTokens)` は**まさに比例則**であり、200K 予算では窓の 85% という高い発火点を生む。実践者は全員、発火点を**窓に比例しない固定絶対値**で語っている。[inference] 決定の精神を一段下まで通すなら、発火点も絶対値（実践者の帯の上端 = 100K 前後）にする方が、ベンダー既定に対するのと同じ論法になる。
3. **`2026-09-27-practitioner-agent-approval-practice.md` との整合**。同記録の結論（毎回丁寧に承認する運用は 1 人もいない）と本記録の結論（窓は小さく保ち、隔離する）は同方向である。ただし **Zechner の「subagent なし」と Vincent の「2 セッション」** は、同記録の「ゲートはハーネス / 人間側」という整理と合わせて読む必要がある。

## 検証できなかったこと（no precedent found / UNREACHABLE）

- **公称 1M 窓に対する作業予算を割合で語った実践者は HumanLayer の 1 件のみ**（"For opus 1m this is only 10% of the context window"）。他の全員は 200K 級窓を前提にした絶対値である。
- **200K 窓を埋め切ってから圧縮せよと述べた実践者・ベンダーは 1 件も見つからなかった。**（探した範囲: HumanLayer 6 記事、Huntley 2 記事、Zechner 2 記事、Vincent 1 記事、Willison タグ 4 種、Hashimoto 1 記事、Yegge 2 ソース、Breunig 2 記事、Ronacher 2 記事、Ball 2 ソース、Karpathy 2 tweet、Cherny 1 tweet、Lütke 1 tweet。）
- **subagent の隔離が品質に効くことを測った実践者**は Willison の 2025-10-11 実験（subagent ごとのトークン数記録）のみ。**品質の比較測定は見つからず**、Anthropic の 4×/15× は研究 / 調査タスクでコーディングではない。
- **Karpathy の context window 管理に関する運用発言**（RAM 比喩を含む）: `x.com` は egress 遮断、`nitter.tiekoetter.com` の該当 tweet は 404、`xcancel.com` 451。**到達不能**。
- **HumanLayer の smart zone / dumb zone の一次動画**（`youtu.be/rmvDxxNubIg`）は取得していない。75K は同社ブログ本文の記述として確認。
- **`IMPLEMENTATION_NOTES.md`（antirez/flux2.c）の原文**: `raw.githubusercontent.com/antirez/flux2.c/main/IMPLEMENTATION_NOTES.md` は HTTP 404。引用は第三者経由の TRANSCRIBED。
- **Armin Ronacher が subagent を context 隔離に使うという記述**: Simon のまとめに存在するが canonical URL を特定できず（取得した本人の 2 記事には該当記述なし）。**未検証**として扱う。
- **170K という具体的な発火点を公表している実践者**は Huntley のみ。この家と同じ「200K 予算 + 170K 発火」という組み合わせを書いた一次記事は見つからなかった。
- 一般の実践者集団（ブログを書かない層）の分布は不明。本記録は「名の知られた実践者」の標本であり、**発言するほど context に神経質になる選択バイアス**がかかっている（Vincent は「friends swear that...」と多数派が別の運用であることを示唆し、HumanLayer は「最近のモデルは context を恐れすぎている」と逆方向の苦情も書いている）。

## Sources

1. https://www.humanlayer.dev/blog/long-context-isnt-the-answer
2. https://www.humanlayer.dev/blog/advanced-context-engineering
3. https://www.humanlayer.dev/blog/context-efficient-backpressure
4. https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents
5. https://www.humanlayer.dev/blog/context-forking-to-save-time-trouble-and-tokens
6. https://www.humanlayer.dev/blog/brief-history-of-ralph
7. https://ghuntley.com/ralph/
8. https://ghuntley.com/subagents/
9. https://blog.fsck.com/2025/10/05/how-im-using-coding-agents-in-september-2025.md
10. https://bsky.app/profile/s.ly/post/3m2srmkergc2p (via https://simonwillison.net/tags/sub-agents/)
11. https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
12. https://mariozechner.at/posts/2025-06-02-prompts-are-code/
13. https://simonwillison.net/2025/Jun/18/context-rot/
14. https://simonwillison.net/tags/sub-agents/
15. https://simonwillison.net/tags/long-context/
16. https://simonwillison.net/2026/Sep/3/gpt6-astra/
17. https://mitchellh.com/writing/my-ai-adoption-journey
18. https://yegge.ai/essays/the-shape-of-things-to-come/
19. https://raw.githubusercontent.com/steveyegge/beads/main/README.md
20. https://dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html
21. https://dbreunig.com/2025/06/26/how-to-fix-your-context.html
22. https://nitter.tiekoetter.com/karpathy/status/1937902205765607626
23. https://nitter.tiekoetter.com/karpathy/status/1976082963382272334
24. https://nitter.tiekoetter.com/tobi/status/1935533422589399127
25. https://nitter.tiekoetter.com/bcherny/status/2098217573276131577
26. https://lucumr.pocoo.org/2025/6/12/agentic-coding/
27. https://lucumr.pocoo.org/2026/6/23/the-coming-loop/
28. https://registerspill.thorstenball.com/archive
29. https://www.humanlayer.dev/blog (index; tags include context-engineering)
30. https://github.com/earendil-works/pi/issues/92 (via `gh api`; 2025-11-30 open → completed 2025-12-04)
31. https://raw.githubusercontent.com/gastownhall/beads/main/examples/compaction/README.md
32. https://raw.githubusercontent.com/gastownhall/beads/main/docs/cli-reference/compact.md (Dolt ストレージ圧縮でありコンテキスト圧縮ではない)
33. `gh api repos/obra/superpowers`, `repos/gastownhall/beads`, `repos/humanlayer/humanlayer`（2026-09-27 取得）
34. `rules/research/2026-09-27-compaction-defaults-across-harnesses.md`（ベンダー既定トリガーと劣化測定はここを参照、再導出しない）
35. `rules/research/2026-09-27-practitioner-agent-approval-practice.md`（承認姿勢。引用は同記録に譲る）
36. `rules/decisions/2026-09-24-context-window-budget-200k-extended-1m.md`
37. https://simonwillison.net/2026/Jan/18/flux2-c/ (antirez の implementation notes 引用元、TRANSCRIBED)

## 結論（一段落）

窓の管理について数字を公表している実践者は、絶対トークンで 25〜30K（Gauthier、コーディング）・75K（Horthy の smart zone）・100K（Kyle の警告、Zechner の劣化点、Vincent の長い仕事の総量）・147〜152K（Huntley の clipping）・170K（Huntley の上限）に並び、割合で語るのは HumanLayer の 40〜60% だけである。機構としては誰も「窓を広げる」を使わず、**窓に入れない**（MCP を積まない、ツール出力を潰す、ディスク上の plan / progress / notes ファイルへ状態を逃がす）と**窓を分ける**（subagent、別セッション、`/clear`、巻き戻し）に収束している — ただし subagent を必須とする派（Huntley / Horthy / Kyle / Willison）と、意図的に持たない派（Zechner の pi）、人間が回す 2 セッションで代替する派（Vincent）、単一エージェントで足りるとする派（Hashimoto）に割れる。この家の 170K 発火は 200K 窓の 85% であり、この帯の最上位 1 名と同じ数字だが、その 1 名は「これしか余地がない」として提示し、他の全員は 75K〜100K で警告・区切りを置いている。すなわち **200K 予算はベンダー既定に対して保守的だが、170K 発火は実践者の警告帯より上**であり、家の設定は「保守的」と一括りにはできない。唯一この方向を押し戻す証拠は 2026-09 の長文脈ベンチマーク改善（eight-needle 100% @256K-512K）で、これは needle-in-a-haystack 型でありエージェントのコーディング作業ではない。
