---
question: "日本語圏の実践者はコーディングエージェントの文脈をどう管理しているか（どれだけ許し、いつ clear / compact / 引き継ぎ / 再起動し、サブエージェントを隔離するか）、数値を出している人はいるか"
date: 2026-09-27
verdict: "clear / compact の『数値』を出している日本語圏の実践者は実在するが、その数値は本人の判断基準ではなく道具側の自動発火点の実測である — 705 回の圧縮を実測して『圧縮前→後 168,635 → 14,296 tok』『直前ターンの cache_read 164,690 tok（中央値）』『閾値が16万〜18万トークンなら…』（Tsutomu_eng）、200K 窓の 80%＝160,000（pnd、`contextSize * 0.8`）、Copilot CLI の『約80%』（nozomu）、`/context` の `Autocompact buffer: 45.0k tokens (22.5%)`（akira_cloudjob）。人間が自分で先回りする基準を割合で示したのは toshi772 の『体感50〜60%を超えたあたりから、こまめに /compact』だけで、それ以外の日本語記事はタスク境界・修正2回失敗・圧縮直前といった基準を書き、トークン閾値を書かない。したがって omp の 200K 窓 + 170K 圧縮（85%）は、この 80% 慣行よりやや攻めており、唯一公表された先回り帯（50〜60% = 10万〜12万）より明確に緩い。日本語圏が英語圏の記録に足すのは閾値の議論ではなく運用の型で、そこには実測された失敗（1,508 行の引き継ぎログのうち 436 行しか届かない・Read の 25,000 トークン上限・205 セッションの申し送りが誤りを増幅する・18 回の合言葉テストでサブエージェントの CLAUDE.md 全階層持ち込みを検出）が付いてくる。"
unverified:
  - "Speaker Deck の日本語スライド本体は取得できない（JS ビューア、PDF 経路は 301 でデッキページに戻る）。kmurahama『Compacting Conversation を体感50%減』の 50% の根拠、autotaker『エージェントに記憶を与える』、s9a17、tame、mulyu、codmoninc、heita、nwiizo の内容はタイトル・説明・著者名・閲覧数までしか確認していない"
  - "suwa_nobu の本名と雇用関係（Qiita プロフィールは『in 株式会社JQIT』表示のみ）。Tsutomu_eng の本名は Tsutomu Saito だが雇用先の記載なし。aiqlabs・miilaka・akira_cloudjob・k0kishima・hocky3・crandim・mamagotolab・ryutarom128 の著者個人の同定はできない"
  - "jadaq / karaage0703 / akira_cloudjob / nozomu が載せる /context の数値は記事内の転記・画像であり、この調査で製品出力そのものを再取得していない（再計算もしていない）"
  - "aiqlabs の 205 セッション・991MB・2,249 行の数値は自社申告で第三者検証がない。同社は同じ仕組みの構築を販売している（商業利害）"
  - "suwa_nobu が引く arXiv 2026-07-28 の論文（ルール遵守 36.2%）は原典未取得。同氏自身が『著者は Surge AI です』と利害を明記している（TRANSCRIBED 相当）"
  - "jadaq が参照する Anthropic 公式ブログ『Claude Code のトークンを無駄にしない6つの方法』は原典未取得"
  - "mizchi の『$6 かかっていたタスクが $1 未満に』は測定条件が書かれていない体感表現。mizchi の Zenn 記事一覧は API の count=48 で取得しており、48 が総数か上限かは未確認"
  - "企業規模の文脈管理を数値で公表した日本語記事は発見できず（Globis のセッション大規模分析の報告は到達できなかった）。組織の型を書く TOKIUM の記事にトークン数はない"
  - "『日本語圏に数値がない』という否定は、この egress で到達できた検索経路（Zenn / Qiita の公開 API、Speaker Deck の検索 HTML、note.com の直接 URL、GitHub API）の範囲に限る。X（Twitter）のスレッドは取得していない"
sources_note: "本文は英語（引用は原文の日本語のまま）。URL と引用は本文の中にあり、参照はパスで行い番号 ID は使わない。全ページを 2026-09-27 に直接取得した。web_search はこの egress で全プロバイダ失敗したため、発見経路は Zenn / Qiita の公開 API、Speaker Deck の検索 HTML、note.com の直接 URL、GitHub API である。"
---

# What Japanese-language practitioners publish about coding-agent context management

**Research date:** 2026-09-27. **Slice:** lens 2 (practitioners) restricted to the Japanese-language web, with the measured-evidence lens where a Japanese author did the measuring, and the in-the-wild lens (adoption counts, tooling, maintenance) over the same corpus.

**Do-not-re-derive scope.** This record does not re-derive: vendor compaction-trigger defaults or long-context degradation studies (`2026-09-27-compaction-defaults-across-harnesses.md`), the vendor/lab absolute-token-budget statements including Amp's "200k tokens is plenty" and Google's 150,000/40,000 (`2026-09-27-context-management-lab-guidance.md`), code-execution gating (`2026-09-27-code-execution-gating-across-agents.md`), or the approval posture of the named English-speaking practitioners (`2026-09-27-practitioner-agent-approval-practice.md`). Those records are referenced by path and their facts are used as the comparison anchor only.

## Method and verification legend

- **DIRECT** — the page (or its platform API record) was fetched by this research chain during this session: native HTML through the reader extraction used across this repo, the Qiita v2 API (`https://qiita.com/api/v2/items/<id>`, which returns the full Markdown body), the Zenn public API, the GitHub API, or a URL fetched with `read`.
- **TRANSCRIBED** — the statement is reproduced inside a page I fetched, but the original (vendor blog, arXiv paper, changelog) I did not fetch. Always marked as such.
- **UNREACHABLE** — could not be fetched. "Not found" means *not reachable*, not *absent*.

**Discovery constraint.** `web_search` failed against every provider from this egress for the whole session, as in the sibling records. Discovery therefore ran on: Qiita `GET /api/v2/items?query=`, Zenn `GET /api/search?q=&source=articles&order=most_liked` and `GET /api/articles?username=`, Speaker Deck's server-rendered search HTML, direct URLs on note.com, and `gh api`. Consequence: this is a *reachable-corpus* survey, not a complete one. X/Twitter threads, Discord, closed corporate wikis and video are outside it.

**Two caveats that bound every conclusion.**

1. Every operational statement below is a self-report about the author's own environment. Nobody in this corpus publishes an audited log except where a script or raw tool output is quoted; where the author supplies one, that is said so.
2. Commercial interest is flagged per name. The Japanese corpus is dense with it: books, paid templates, consulting, a SaaS, and one review-style account that publishes per-tool numbers at volume.

## Headline table — who published a number

| Source | Author, identity, commercial interest | Claim with numbers | Measured or impression |
| --- | --- | --- | --- |
| `https://qiita.com/Tsutomu_eng/items/3ce60c1d8ceb1f8bcc39` [DIRECT] | Tsutomu Saito (`Tsutomu_eng`); "プログラマ6年/インフラエンジニア10年"; no employer stated; 36 Qiita items, 4 followers, 1 like on this article; publishes the analysis script (`compact_cost.py`) | "compaction 705 回 / 148 セッション", "圧縮前→後 : 168,635 → 14,296 tok", "圧縮前の1ターン読込 : 164,690 tok", "直後ターンの書込 : 43,844 tok", "通常ターンの書込 : 1,712 tok → 26 倍", "trigger=auto : 702 回（99.6%）", "1セッションあたりの compaction 回数は中央値2回、最大53回", "閾値が16万〜18万トークンなら、" | Measured from the author's own `~/.claude/projects/` session logs; script published; single author, no third-party verification |
| `https://zenn.dev/pnd/articles/claude-code-statusline` [DIRECT] | ogino / `pnd`, "Platform Engineer @ 株式会社ダイニー" (GitHub `swen128`); 254 likes, the most-liked source here; no commercial interest | "大体 80% ぐらいのタイミングで自動的に `/compact` を実行します" on a 200K window; code constants `const autoCompactLimit = contextSize * 0.8` and legacy `const COMPACTION_THRESHOLD = 200000 * 0.8` → **160,000** | A shipping code artifact plus the author's assumption about the vendor's behaviour; the number is the author's, not a vendor quote |
| `https://qiita.com/toshi772/items/bae57ac508918c536072` [DIRECT] | toshi772; "データエンジニアやってます。株式会社クレスティブ代表" — representative of Crestive Inc. (`crestive.jp`), an IT-services commercial interest; 26 items, 4 followers | "使用率が体感50〜60%を超えたあたりから、こまめに" `/compact`; bar turns yellow at 70%, red at 90% | Explicitly **impression** ("体感") |
| `https://zenn.dev/nozomu/articles/4b55abc30c8ec1` [DIRECT] | Zenn `nozomu` ("Nozomuts"), self-described "Webアプリの開発に携わっているひよこエンジニアです"; 14 likes; written twin of his Speaker Deck talk | `/context`: `gpt-5.4 · 22k/304k tokens (7%)`, `System Prompt: 8.9k`, `System Tools: 7.3k`, `MCP Tools: 3.0k`, `Messages: 2.5k`, `Free Space: 236.6k (78%)`, `Buffer: 45.6k (15%)`; "会話がコンテキストウィンドウの約80%に達するとバックグラウンドで自動的にも圧縮が開始されます" | Product output quoted verbatim (Copilot CLI); the 80% sentence is the author's description, not a vendor quote |
| `https://zenn.dev/akira_cloudjob/articles/1f052f3e569e87` [DIRECT] | `akira_cloudjob`, anonymous handle, "実践検証 Day N" daily series; 1 like | `/context`: `claude-opus-4-5-20251101 · 63k/200k tokens (31%)`, `Autocompact buffer: 45.0k tokens (22.5%)`, `System prompt: 3.0k`, `System tools: 14.9k`, `Memory files: 85`, `Messages: 8`; "メッセージ部分の圧縮率は約54%" | Product output quoted; the 54% is the author's before/after reading; unnamed author |
| `https://zenn.dev/miilaka/articles/claude-code-read-limit-handoff` [DIRECT] | `miilaka`; states he consolidated the same practice into a book ("本にまとめました") → commercial interest | "1,508行の引き継ぎログを Read で読ませると…先頭の436行だけが返りました"; "1,508行で約7万3千トークン"; "この環境では25,000トークンでした"; rule "本体が1,500行か2万字を超えたら、古い章から月ごとの保管庫へ移す"; validated with a 2万字（791行）sample | Measured in-product (Read tool output); one environment; author's own log |
| `https://zenn.dev/aiqlabs/articles/70370e973d8425` [DIRECT] | `aiqlabs` (team account); sells a service that builds this handoff setup ("環境に合わせて作って納品するサービスも出しています") → strong commercial interest | "76 日", "205 セッション", "991MB", handoff file "2,249 行 / 144,987 字", injected "冒頭 40 行だけ", "記述を名指しで「誤り」「撤回」としている行が 15 行" | Operational self-report with counters; no third-party verification; commercial framing explicit |
| `https://qiita.com/suwa_nobu/items/e02595193c2ec2e733a3` [DIRECT] | `suwa_nobu`; Qiita profile shows "in 株式会社JQIT"; 53 items, 299 followers, 4,982 contributions, 98% AI-tagged; no real name; reviews tools/skills at volume | "47本 82,179 トークン / 127本 82,364 トークン ← 80本足して +185"; "消したら 3,710トークン減りました。予告は約2,160だった"; environment "Windows 10 / Claude Code 2.1.260 / モデル `claude-opus-5` / 測定は 2026-09-07 時点" | Measured with `/context`; environment and date stated |
| `https://qiita.com/suwa_nobu/items/817a26e02cd1f08c7edd` [DIRECT] | same author | "起動時のトークン : 自作 3,225 → 導入したもの 90,000（28倍）" for one 60,480-star skill | Measured startup tokens; direct A/B |
| `https://qiita.com/suwa_nobu/items/b465ef863f8d8608f497` [DIRECT] | same author | Subagent CLAUDE.md inheritance, 3/3 per configuration over two versions; "機能の有無は測れましたが、量は測れていません" | Measured presence/absence with passphrase markers; the token measurement is explicitly refused |
| `https://zenn.dev/jadaq/articles/5f85c29d7f4f60` and `https://note.com/qiuyu/n/n8c900edb24ed` [DIRECT] | Jada QIU (`jadaq`); "建築設計9年 → 生成AIで独立" — self-employed, one-person operation, no employer to verify; publishes on Zenn and note.com | `/context` categories: Messages "54.8k → 一仕事で 123.9k", Memory files "34.1k", MCP tools "320個 · 0 トークン", Skills "167個 · 9.9k" (health line "1個あたり平均 ≤60 トークン"), Custom agents "6個 · 659", System prompt/tools "3.7k + 15.5k"; "1M モデルで auto-compact の安全網を戻したければ `/autocompact 200k`（v2.1.221+）"; "過去309セッションの transcript…1721回の ffmpeg 呼び出しのうち 86% はすでに `-loglevel` 付き" | Product output transcribed by the author; 309-session log aggregation by the author; no third party |
| `https://qiita.com/karaage0703/items/1f30a572ff8460` [DIRECT] | からあげ (`karaage0703`); 793 Qiita followers, 294 Zenn articles, author of a Japanese book on MCP development → commercial interest | Session-start `/context` "69%"; after disabling MCP servers and shrinking tool definitions, "トークン使用量は39%と69%から30%の削減に成功しました！このうち22.5%はバッファなので、使用量自体は18%と20%を切っている" | Measured before/after in-product; screenshots rather than a script |
| `https://qiita.com/mamagotolab/items/37d3bdd0bafdd81ba392` [DIRECT] | `mamagotolab`; anonymous; 16 items, 1 follower | Token mix across sessions: "cache_read_input_tokens 229,310,646 98.1%", "output_tokens 605,332 0.3%", "97〜98%"; "Opus 5.5 は Opus 5 の約53%" | Measured from local logs by the author; anonymous, low engagement |
| `https://zenn.dev/hocky3/articles/963c5e9e706e7f` [DIRECT] | `hocky3`; 1 like, published 2026-09-27 | Quotes the vendor threshold — "Anthropicのcompaction機能は、会話の入力トークン数がしきい値(既定は15万トークン)に達すると…" — and declares "数字による実測はしていません" | Impression by the author's own admission; the 15万 number is a vendor quote |
| `https://zenn.dev/k0kishima/articles/8976ce2bf725e0` [DIRECT] | `k0kishima`; 17 likes | Illustrative figure "'ok commit' のようなわずかなトークンの命令でも、場合によっては10万トークン規模の履歴とセットで送信される"; names "Auto-compact (自動要約)の直前" as a clear trigger | Impression; no measurement |
| `https://zenn.dev/mizchi/articles/claude-code-orchestrator` [DIRECT] | `mizchi` (Kotaro Chikuba); 1,857 GitHub followers; blog mizchi.dev; large-audience engineer with books/consulting → commercial interest | "今までだと $6 かかっていたようなタスクが、$1 未満にコンテキストを圧縮できていた"; subtasks return "concise summaries (100-200 words)" | Impression (no measurement conditions given) with a concrete operational design |
| `https://zenn.dev/tacoms/articles/552140c84aaefa` [DIRECT] | `shinpr`; 361 likes; sells the workflow and writes Claude Code books → commercial interest | Subagent token reports quoted verbatim: "Done (12 tool uses · 62.9k tokens · 4m 16.7s)", "task-executor … 65.2k tokens", a second executor run "102.7k tokens", "quality-checker … 87.6k tokens" | Product output quoted verbatim |

**The one number that answers the acceptance question directly.** The only published *personal* threshold expressed as a share of the window in this corpus is toshi772's "体感50〜60%を超えたあたりから、こまめに" `/compact`. Every other number is either (a) the automatic trigger the tool fires on its own — measured or described at **80% of the window** (pnd, nozomu) or **160,000–180,000 tokens** (Tsutomu_eng) — or (b) an inventory of what already occupies the window (`/context` dumps).

**The comparison to omp.** omp runs a 200K working budget with compaction at 170,000 = **85% of the working budget**. On the same arithmetic the Japanese corpus puts the tool-side convention at **80% (160,000)** and the only human-side proactive band at **50–60% (100,000–120,000)**. So 170K is not conservative against either figure: it sits above the published proactive band, and it sits *inside* the autonomously observed trigger band (16万〜18万), meaning a user who waits for 170K is not clearing ahead of the tool but arriving together with it. `2026-09-27-context-management-lab-guidance.md` reaches a compatible reading from the vendor side (Amp's 200k/90% pair); the Japanese corpus narrows the practitioner-side band further down, not up.

---

## 1. The people who measured — and the quality of what they measured

### 1.1 Tsutomu_eng: 705 compactions from 148 sessions, and the auto trigger at 16万〜18万

`https://qiita.com/Tsutomu_eng/items/3ce60c1d8ceb1f8bcc39` [DIRECT] — "「/compact のコストを実ログ705回分で測った — 対話なら回収できる、バッチなら避けるべき」", 2026-09-03, 1 like. The article measures Claude Code's own compaction from `~/.claude/projects/` session logs, explicitly excluding subagents ("# サブエージェントは別コンテキスト"), warns about double counting ("レコード単位で素朴に合計すると二重計上になり、ターン数は約1.94倍、トークン量は1.9〜2.9倍に膨らみます"), and ships the script (`compact_cost.py`) so the numbers can be recomputed.

Verbatim results as published:

> "compaction 705 回 / 148 セッション"
> " auto の割合 : 99.6%"
> " 圧縮前→後 : 168,635 → 14,296 tok"
> " 直後ターンの書込 : 43,844 tok"
> " 通常ターンの書込 : 1,712 tok → 26 倍"
> " 圧縮前の1ターン読込 : 164,690 tok"
> " 圧縮後の1ターン読込 : 78,084 tok"

> "圧縮する直前は、毎ターン16万トークンを読み直していました。"

> "trigger=auto : 702 回（99.6%）" / "trigger=manual : 3 回（ 0.4%）"

> "1セッションあたりの compaction 回数は中央値2回、最大53回。"

> "閾値が16万〜18万トークンなら、" … "そこが自分の環境での閾値なので、1件あたりの実行がそこに届かないよう切ります。"

> "compaction はモードに関係なく、同じトークン閾値で発火しています。"

> "2ターン目でもう7万まで戻ります。"

Three of his findings matter for a design decision, and none of them is the token arithmetic:

1. **The auto/manual split is 99.6 / 0.4.** His own reaction: "実測 0.4% ということは、この推奨はほぼ実行されていません。私もでした。" — the vendor's advice ("at a natural break in your work, such as between tasks, instead of waiting for auto-compaction to trigger mid-task", quoted by the author from the docs) is measurably ignored, including by a practitioner who went to the trouble of measuring it.
2. **`/rewind` is cheaper than `/compact` for the same purpose**, per the vendor text he quotes: "Rewinding truncates back to a prefix that is already cached, rather than building a new one as compaction does." His measured compaction cost: "一時費用 = 43,844 tok × 2.0（1h書き込み） = 87,688".
3. **The turn after compaction is not the expensive one** — vendor quote again: "the turn after compaction rebuilds the conversation cache for only the much shorter summary, so that turn is not the slow part". What is expensive is the rebuild itself: "約44,000トークンを書き直すのは、キャッシュから読むのに比べて相応に高い。ここまでは体感どおりです。"

His overall conclusion is *not* "compact less": "対話では compaction は十数ターンで元が取れています。切る理由はありません。" The reason to care is batch runs, where "compaction が起きた" in "9（0.3%）" of sessions versus "139（57.0%）" for interactive runs with the same trigger — because each batch execution starts a fresh, short session.

**Caveats.** One author, one environment, one vendor's product, a self-published script, 1 like and 4 followers; this is not a peer-reviewed measurement. Its value is that the raw artifact (a parser over a documented log location) is published, which no other source in this corpus does. The numbers are consistent with the widely read pnd article below, which is the closest thing to independent corroboration available here.

### 1.2 pnd (ogino, 株式会社ダイニー): the 80% convention expressed in code

`https://zenn.dev/pnd/articles/claude-code-statusline` [DIRECT] — 2025-08-09, revised 2025-12-20, 254 likes, the most-liked source in this corpus. A Platform Engineer at a named company writing a statusline that draws the auto-compact boundary; the constants are in the article:

> "Claude のコンテキスト幅…は 200K トークンです。Claude Code はこのコンテキスト幅に到達する前に、大体 80% ぐらいのタイミングで自動的に `/compact` を実行します。"

> `const autoCompactLimit = contextSize * 0.8` … legacy `const COMPACTION_THRESHOLD = 200000 * 0.8`

**160,000 on a 200K window.** Note what kind of claim this is: he describes the vendor's behaviour as he understands it, does not quote a vendor document, and the number in his shipping code is his own inference. It nevertheless converges with Tsutomu_eng's measured 16万〜18万 and nozomu's Copilot CLI statement, which is what makes **80% of the window** the one cross-source convention in this corpus.

### 1.3 nozomu: the same 80% on a different vendor, with a full context breakdown

`https://zenn.dev/nozomu/articles/4b55abc30c8ec1` [DIRECT] — "Copilot CLI のコンテキスト管理メモ", 2026-05-29, 14 likes. He quotes his own `/context` panel:

> `gpt-5.4 · 22k/304k tokens (7%)`
> `○ System Prompt: 8.9k (3%)`
> `◌ System Tools: 7.3k (2%)`
> `◍ MCP Tools: 3.0k (1%)`
> `◉ Messages: 2.5k (1%)`
> `Free Space: 236.6k (78%)`
> `◎ Buffer: 45.6k (15%)`

and states the trigger:

> "なお、会話がコンテキストウィンドウの約80%に達するとバックグラウンドで自動的にも圧縮が開始されます。"

His operating split is the same three-way distinction the Japanese corpus keeps re-deriving: `/compact` to continue the flow, `/clear` to switch tasks, and "今のセッションから独立した別セッションを作る". He also records the two isolation moves: "独立した調査や検証は、サブエージェントで別コンテキストに分ける選択肢もあります。", plus an output filter — "長いシェル出力を LLM のコンテキストに届く前にフィルタリング・圧縮する CLI プロキシです" — because "長い出力を毎回そのまま会話に入れると、地味にコンテキストを圧迫します".

### 1.4 akira_cloudjob: the 22.5% reserve, read off the product

`https://zenn.dev/akira_cloudjob/articles/1f052f3e569e87` [DIRECT] — "Claude Code 実践検証 Day 23｜コンテキスト管理の基礎―/contextと/compactでトークンを監視・圧縮する", part of a numbered daily series; 1 like; anonymous handle.

> `⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛀ ⛀ claude-opus-4-5-20251101 · 63k/200k tokens (31%)`
> `⛝ … Autocompact buffer: 45.0k tokens (22.5%)`
> `System prompt: 3.0k tokens (1.5%) / System tools: 14.9k tokens (7.4%) / Memory files: 85 tokens (0.0%) / Messages: 8 tokens (0.0%) / Free space: 137k (68.5%)`

On a 200K window the reserved band before the ceiling is **45.0k = 22.5%**, and he reports the compaction ratio directly: "メッセージ部分の圧縮率は約54%". His operating rule is the one this corpus repeats in nearly these words:

> "定石は「そもそもFullにしない」こと。タスク分割やSubagentの活用を先に考え、`/compact` は万が一のセーフティネットとして使うのが良いでしょう。"

He also signals the follow-up: "次回：Day 24「/compact検証結果―指示あり・なし両方で情報保持率100%」". That Day-24 claim exists here as a title only; a 100% retention claim from an anonymous series writer with 1 like is exactly the kind of number that needs its test published, and Day 23 does not publish one.

### 1.5 jadaq (Jada QIU): the fullest published context inventory, and `/autocompact 200k`

`https://zenn.dev/jadaq/articles/5f85c29d7f4f60` [DIRECT] — 2026-09-03, 4,348 characters, 1 like — and its original on note.com, `https://note.com/qiuyu/n/n8c900edb24ed` [DIRECT]. Stated environment: "Claude Code v2.1.228 / 1Mコンテキストモデル / MCPサーバー11接続". Author identity: "建築設計9年 → 生成AIで独立" — nine years in architectural design, now self-employed; no employer, no team, one person's machine, and the numbers are transcribed from `/context` output rather than recomputed by me.

The inventory as published:

> Messages "54.8k → 一仕事で 123.9k"
> Memory files "34.1k"
> MCP tools "320個 · 0 トークン"
> Skills "167個 · 9.9k" (with the health line "1個あたり平均 ≤60 トークン")
> Custom agents "6個 · 659"
> System prompt/tools "3.7k + 15.5k"
> a suggestion line "File reads using 70.7k tokens → save ~21.2k"

The operating rules — the decision table this record is really about:

> "変わった → `/clear`（戻りたければ先に `/rename`）"
> "変わっていないが前半は完了 → `/compact`"
> "変わっていないが直近数ターンが無駄だった → **`/rewind`**"
> "キーボードを1時間以上離れる前 → 先に `/compact`"

and the mechanism behind `/rewind`, the single most additive technical insight in the corpus:

> "rewind は末尾を切り落とすだけで、**それより前のキャッシュは全部生きている＝ゼロコスト**"
> "キャッシュはサブスクで1時間、APIキーでは5分で失効"

He also documents the knob that maps directly onto omp's threshold: "1M モデルで auto-compact の安全網を戻したければ `/autocompact 200k`（v2.1.221+）" — a 1M-window user *lowering* the automatic trigger to 200,000 deliberately. And `BASH_MAX_OUTPUT_LENGTH=8000` (default 30,000 文字), plus a log-derived claim: "過去309セッションの transcript…**1721回の ffmpeg 呼び出しのうち 86% はすでに `-loglevel` 付き**". The same "the problem I feared was not there" conclusion is on note.com:

> "MCPツール320個の定義は 0トークンだった。…心配していた約24万トークンは最初から請求されていなかった。"
> "やることは一つだけ。最適化を始める前に、新しいセッションで /context を叩く。何が読み込まれ、何トークン占めているか、カテゴリ別に出る。数字を見てから、一番大きい項目だけ直す。"

That last line is effectively this corpus's methodology statement: measure before optimizing. He also names the vendor post he is responding to — "Anthropic が「Claude Code のトークンを無駄にしない6つの方法」という公式ブログを出した" (TRANSCRIBED: I did not fetch that vendor post).

### 1.6 suwa_nobu (株式会社JQIT): four quantified experiments, one refused measurement

`suwa_nobu` is the most prolific quantified account in the corpus — the Qiita profile shows "in 株式会社JQIT", 53 items, 299 followers, 4,982 contributions, 98% of posts tagged AI, no real name published. The account reviews tools and skills at volume (a mild incentive toward dramatic numbers), and every article states the environment and measurement date.

**(a) Skill count barely costs anything — until the ceiling** — `https://qiita.com/suwa_nobu/items/e02595193c2ec2e733a3` [DIRECT]:

> "47本 82,179 トークン / 127本 82,364 トークン ← 80本足して +185"
> "**増えません。** 上限に当たっていました。"
> "消したら **3,710トークン**減りました。予告は約2,160だったので、多めに減っています。"
> "`/skill-doctor` に「19本が一度も呼ばれていない。**毎ターン、システムプロンプトに載り続けている**」と言われました。"
> "> 検証環境: Windows 10 / Claude Code 2.1.260 / モデル `claude-opus-5` / 測定は 2026-09-07 時点"

**(b) One imported skill can cost more than an entire personal setup** — `https://qiita.com/suwa_nobu/items/817a26e02cd1f08c7edd` [DIRECT]:

> "起動時のトークン : 自作 3,225  →  導入したもの 90,000（28倍）"
> "実装             : SKILL.md 1本 →  Python 308ファイル / 32MB"

**(c) Subagents inherit every CLAUDE.md level — measured, with the token measurement refused** — `https://qiita.com/suwa_nobu/items/b465ef863f8d8608f497` [DIRECT], 2026-09-15, on the `omitClaudeMd` changelog entry in Claude Code 2.1.271 (the changelog text he quotes: "Added `omitClaudeMd` to agent frontmatter and `--agents` JSON, letting custom and plugin subagents run without user, project and local CLAUDE.md files; managed policy files still load"):

> "**「CLAUDE.md なしで走らせられるようにした」ということは、今までは走らせられなかった**という意味です。"
> "サブエージェントを1体呼ぶたびに、CLAUDE.md が丸ごとそのコンテキストに積まれていたことになります。"

the measurement table:

> `2.1.271  設定なし        サブエージェントから CLAUDE.md が見えた    3/3`
> `2.1.271  omitClaudeMd    見えなくなった                            3/3`
> `2.1.270  omitClaudeMd    見えたまま（設定が黙って無視される）      3/3`
> "トークン数ではなく、**中身が見えるかどうか**で測りました。"

and the refusal, which is the most valuable part of the article:

> "**機能の有無は測れましたが、量は測れていません。**"
> "**トークンの差が何なのかを説明できていません。** 「11,100 減る」は CLAUDE.md の節約分ではなく、正体不明の定数です"
> "**外す対象が無くても同じだけ減ります。** この差は CLAUDE.md の中身ではありません。"

Across both definition paths (`--agents` JSON and `.claude/agents/`) the result held in 18 runs — he records "18回とも一貫". He also documents two measurement traps worth copying: the parent answered in place of the subagent when measured with `--agent` ("親が代わりに答えたら測定になりません"), and the frontmatter reference he checked (17 items) did not list `omitClaudeMd` at all on 2026-09-15 even after the feature shipped.

**(d) A thin CLAUDE.md, argued from a paper's number** — `https://qiita.com/suwa_nobu/items/2dee3e3d53080c3676a0` [DIRECT] opens "**36.2%。** …AIエージェントに「このルールを守って作業して」と指示書を渡したとき、**実際にちゃんと守れた割合**です。しかも、これが**一番マシだったモデルのスコア**。ほとんどのモデルは25%を下回りました。", attributing it to "2026年7月28日に arXiv に上がった論文" (TRANSCRIBED — I did not fetch the paper) and then stating the paper's own interest and its scoring caveat:

> "**著者は Surge AI です。** データの評価・ラベリングを事業にしている会社です。"
> "**strict 採点はかなり厳しい。** 3〜27個の基準を全部満たして初めて合格なので、1個外すと0点です。論文には1個の失敗を許す緩和版（pass@1 (N-1)）もあるので、実務の感覚に近いのはそちらかもしれません。"

The companion piece `https://qiita.com/suwa_nobu/items/cea574550613de33a114` [DIRECT] (104 likes, his most-liked) settles the "21 sections vs 8 lines" debate in favour of short and gives the mechanism:

> "つまり **CLAUDE.md が長いほど、全リクエストのトークンコストが上がります**。100回やり取りすれば100回分です。1回きりの初期化コストではありません。"
> "キャッシュは**プレフィックスの完全一致**で効くため、CLAUDE.md を編集すると、それ以降のキャッシュが作り直しになると考えられます（Claude Code の内部実装は公開されていないので、ここは**仕組みからの推測**です）。"
> "**読み込まれる総量は変わらない**ので、これは分量対策ではなく整理のための機能です。"

Note the difference in kind between (a)–(c) and (d): the former are in-product measurements with stated environments; (d) is an argument whose single number comes from a paper and whose cache claim the author himself labels 推測. It is one of the very few Japanese sources in this corpus that marks its own inference.

### 1.7 The two handoff-discipline measurements, and their commercial framing

These are the only Japanese sources I found that measure *handoff artifacts* rather than the window, and both authors sell the practice they describe.

**miilaka — the handoff log that only partly arrives** (`https://zenn.dev/miilaka/articles/claude-code-read-limit-handoff` [DIRECT], 2026-09-26):

> "著者の環境では、このファイルを1,500行に保つ仕組みを入れていました。Claude Code のファイルを読む道具（Read）は、既定で先頭の2,000行まで読むので、それより小さければ全部届くと考えていたからです。"
> "2026-09-26、1,508行の引き継ぎログを Read で読ませると、次の知らせが出て、先頭の436行だけが返りました。"
> "Read の上限は、行数だけではありません。一度に返す量（トークン。AIが文章を数える単位）にも上限があります。この環境では25,000トークンでした。"
> "このログは日本語が多く、1行も長いので、1,508行で約7万3千トークンありました。行数の上限より先に、量の上限に当たっていたわけです。"
> "さらに困ったことに、このログは古い順に並んでいて、最新の章は末尾にあります。届いていたのは古い3割だけで、いちばん読ませたい最近の引き継ぎが届いていませんでした。"
> "本体が1,500行か2万字を超えたら、古い章から月ごとの保管庫へ移す"
> "2万字は、量の上限に余裕を持たせた数です。架空の見本のログを2万字（791行）に畳んで Read させたところ、最後の行まで返ってきました。"

The "2万字（791行）" figure is a validated working limit for a Japanese-language handoff file in that environment, and the 25,000-token Read cap is a harness-side constraint that no window budget removes. For any design that plans to keep state in files and reload it, this is the sharpest measured constraint in the corpus. Commercial interest: "この件を含め、Claude Code に記憶と引き継ぎを持たせる仕組みを、本にまとめました。"

**aiqlabs — 205 sessions, and handoff as an error amplifier** (`https://zenn.dev/aiqlabs/articles/70370e973d8425` [DIRECT]):

> "Claude Code を 1 つのプロジェクトで 76 日走らせ続けています。会話ログは 205 セッション分残っていて、生のトランスクリプトは合計 991MB あります。"
> "現行の申し送りファイル 2,249 行 / 144,987 字" (an earlier iteration was "900 行 / 130,981 字": "この規模が引き継ぎ設計の出発点でした")
> "冒頭 40 行だけ…として注入しています。全文（2,249 行）は入れません。冒頭に「次にやること」を必ず書くという規約と対になっています。"
> "毎セッション無条件にダイジェストを注入すると、履歴と無関係な単発作業でも数千トークンを常時課金する。再開の意思表示があったときだけ払うのが正しい。"
> "前のセッションの記述を名指しで「誤り」「撤回」としている行が 15 行"
> "測り方が書いてあれば、次のセッションは「n=42 は 1 ページの件数と合わないのでは」と疑えました。"
> "引き継ぎファイルに残るのは結論であって、証拠ではない"

Its explicit framing is a warning against the *other* Japanese handoff articles — "引き継ぎの実装方法を書いた記事は日本語でもたくさん見つかりますが、実装した後に何が壊れるかは自分では見つけられませんでした" — and its conclusion is that session splitting is the lesser evil: "長いセッションは…破損とツール結果の作話という、もっと検出しにくい壊れ方を持ちます。分割は副作用が軽いほうを選んだ結果です". Commercial interest is explicit: they sell the setup as a delivered service.

### 1.8 Small measured contributions worth keeping

- **toshi772** (`https://qiita.com/toshi772/items/bae57ac508918c536072` [DIRECT]): the only person-side percentage band — "使用率が体感50〜60%を超えたあたりから、こまめに" `/compact`; bar colour at 70% (yellow) and 90% (red); and the observation that subagent-heavy work consumes the window faster than expected — "サブエージェント(Task/Agent機能)を多用するタスクほど、想像より早くコンテキストを食う". Commercial interest: representative of a company in this domain.
- **karaage0703** (`https://qiita.com/karaage0703/items/1f30a572ff8460` [DIRECT], 2025-12-11, 116 likes): the before/after inventory reduction — session-start `/context` "69%"; after disabling MCP servers, halving the tool tokens of a self-written MCP server and deleting a memory file, "トークン使用量は39%と69%から30%の削減に成功しました！このうち22.5%はバッファなので、使用量自体は18%と20%を切っている". Commercial interest: Japanese technical-book author.
- **mamagotolab** (`https://qiita.com/mamagotolab/items/37d3bdd0bafdd81ba392` [DIRECT]): across his sessions "98.1% がキャッシュ読み込み", "出力は0.3%", and the price comparison "Opus 5.5 は Opus 5 の約53%". Anonymous handle, 1 follower — an order-of-magnitude statement, not a citable budget.
- **ryutarom128** (`https://qiita.com/ryutarom128/items/310d79a8f1d4bc22273b` [DIRECT]): the statusline fields that make a percentage budget observable at all — `context_window.used_percentage` and `rate_limits.five_hour.used_percentage`, rendered as "Sonnet 5 | 242k / 1M (24%使用済み)".

---

## 2. The people who publish a criterion but no number

This is the larger group, and it is the actual answer to "what do Japanese practitioners do": they gate on *events*, not on token counts.

| Author / article | The rule, verbatim | Notes |
| --- | --- | --- |
| `k0kishima` — `https://zenn.dev/k0kishima/articles/8976ce2bf725e0` [DIRECT], 17 likes | Clear triggers: "Auto-compact (自動要約)の直前", "タスクの完了時", "議論が停滞・堂々巡りになった時", "前提条件の大きな変更" | Names the cost as 死荷重: "課題Aの履歴は課題Bの問題解決に寄与しない…死荷重 (dead load)" |
| `Yasushi-Mo` — `https://qiita.com/Yasushi-Mo/items/0071f71ba102d2125c13` [DIRECT], 25 likes, Web engineer, 259 items | "同じ問題で2回以上修正しても直らないときは、一度 `/clear` して…"; "次のプロンプトを新品のターミナルに打ち込んでも意味が通じるなら、送る前に `/clear` する"; "キャッシュはおよそ5分でexpire…5分以上放置するとキャッシュが切れ…その場合は `/clear` で新しく始める方が安く済みます"; "`/compact` は早めに呼ぶほど要約がきれいになります" | A counter-rule to jadaq's 1-hour cache claim: the /clear-vs-/compact decision tied to cache expiry. Delegation sizes: "ログやスタックトレースは、貼る前に該当する20〜30行に絞ります"; and on subagents, "単純なシェル操作や短い git 操作のような小さいタスクではかえって無駄". Most sources are vendor docs → derivative |
| `aki_think` (akihiro) — `https://zenn.dev/aki_think/articles/66f6fc7530467a` [DIRECT], 185 likes, freelance Android engineer, runs a >1000-member Codex community | Reset protocol: "長時間の作業でどうしてもコンテキストが汚染されてきたら、そこまでの必要なやり取りや進捗をドキュメントなど外部情報として書き出して保管…ClaudeCode自体をリセットする" | Subagents as pure functions; Opus for planning, Sonnet for speed. No numbers |
| `hocky3` — `https://zenn.dev/hocky3/articles/963c5e9e706e7f` [DIRECT], 1 like, 2026-09-27 | Five rules: 正本は1箇所; one START index for new sessions (7 分冊 total); decisions logged with date + rejected alternatives + reasons; 未決台帳 deletes rather than appends (週1回); machine gate then human check | Declares "数字による実測はしていません". Only source in the corpus that quotes the vendor's 15万 default, which the API docs confirm (see `2026-09-27-compaction-defaults-across-harnesses.md` and `https://platform.claude.com/docs/en/build-with-claude/compaction-threshold`, fetched this session: default `{"type": "input_tokens", "value": 150000}`, minimum 50,000) |
| `crandim_r_and_d` (株式会社クランディム, author shown as `tokoi`) — `https://zenn.dev/crandim_r_and_d/articles/260822_a10_handoff_questions_workflow` [DIRECT] | HANDOFF.md as "現在地スナップショット" not a log, `.gitignore`-ed under the principle "ここにしか無い知識を作らない"; per-session `QUESTIONS/` files named `<日付>-<テーマ>-<セッションID先頭8桁>` (session id from `CLAUDE_CODE_SESSION_ID`); trigger words declared in global CLAUDE.md (HANDOFF → update, TAKEOVER → resume); "未解決の質問が5個以上になったら、私が質問一覧ファイルを作る" | Written by the Claude Code session itself, which the article states; documented failure: "どこにも書かなかった知識は番号ごと消える" |
| `helloworld` — `https://zenn.dev/helloworld/articles/a74a29997ab901` [DIRECT], 30 likes | Automates the handoff *at compaction time*: `PreCompact` is `command`-type only, so it shells out to `claude -p --allowedTools "Read"`; generates `HANDOFF.md` with fixed headings `# HANDOFF / ## What was being worked on / ## Completed / ## Remaining / ## Key decisions / ## Context for next session`; "育成モード" (differential update from the second compaction on) | Opens with the failure it fixes: "3時間かけてリファクタリングの方針を詰めた…そのまま実装に入って、しばらく経ったところで圧縮が走った。次のターンでClaudeが返してきたのは、さっき却下したはずの設計案". Issue #36749 (a prompt/agent type for PreCompact) went stale-closed unanswered — an in-the-wild maintenance negative |
| `arithan` — `https://zenn.dev/arithan/articles/claude-code-handover-overview` [DIRECT] | Makes `/clear` safe with role-separated files: one overview file per day (newest first — "1日に20セッション以上あっても読む量は変わりません"), one detail file per session, one Plan file whose "現在地" is what the next session reads; a `/start` command reading only the overview's newest 3 entries plus the current Plan 現在地 | Reports "この日、このプロジェクトだけで30近いセッションになりましたが、どのセッションも前回の続きから迷わず始まりました" (impression). Documents a real trap: a correction written only in the log while the procedure file kept the old value meant "同じ誤りに2回戻りました" |
| `nekonotte` — `https://zenn.dev/nekonotte/articles/318f553c606b95` [DIRECT] | "世界樹": a Markdown tree for project context, with the session-handoff file labelled "役割: セッション間の短期記憶" and explicitly "通常の作業セッションでは読まなくてよい" | Result stated without numbers: "新規セッションの立ち上げが速くなった"; the author also writes "この仕組みは万能ではありません" |
| `tokium_dev` (TOKIUM, author `muyu`) — `https://zenn.dev/tokium_dev/articles/3236cc7c721259` [DIRECT] | Organization-level framing from a 2026-02-09 Findy Job Lunch Talk: scope context by *stability*, technical first then business — "テクニカルな情報は安定性が高く整備しやすいため、まずそこから着手して、変動しやすいビジネスコンテキストへと広げていくのが進めやすい" | No token numbers at all. Its value here is that it is the only Japanese source in the corpus that treats context management as a company-wide concern reaching PdM/QA roles ("コンテキスト管理は個人やチームから組織全体へとスケールしつつあります") |
| `shinpr` (`tacoms`) — `https://zenn.dev/tacoms/articles/552140c84aaefa` [DIRECT], 361 likes | Subagent orchestration with a quality gate; the failure it documents is the sharpest argument in the corpus for isolating subagents: auto-compact destroyed test quality — "重複したテストが作成されていたり…そもそもテストをパスさせられなくなってしまう事象がauto-compact後には頻発します" | Also a negative worth keeping: "どのような記載をしてもsub-agentからsub-agentを呼び出すことをしてくれなかった" (nested subagents could not be induced by prompt). Commercial interest: sells the workflow and writes books |

Two cross-cutting observations about this group. First, the criteria are *semantic* (has the task changed? has the discussion looped? has the premise changed? has a fix failed twice?), not numeric — and they are stated in a form that a human can apply without a measurement device, which is why none of these authors needed a threshold. Second, several of them use **cache expiry** as the pivot (Yasushi-Mo at ~5 minutes, jadaq at 1 hour for subscription plans), which is a different clock from the window: it decides whether `/clear` or `/compact` is cheaper, not whether either is needed.

## 3. Subagent isolation: who separates, and on what basis

Isolation is the one area where the Japanese corpus converges on a *design*, not just a habit, and the stated basis is context hygiene rather than cost alone.

- **mizchi** (`https://zenn.dev/mizchi/articles/claude-code-orchestrator` [DIRECT], 2025-06-12) — the orchestrator pattern ported from Roo Orchestrator: sequential steps, parallel subtasks per step, each subtask returning "concise summaries (100-200 words)" that become the next step's context, with the sizing argument that "オーケストレーターはコンテキストウィンドウに余裕があるので、長くても良さそう". Effect claim: "今までだと $6 かかっていたようなタスクが、$1 未満にコンテキストを圧縮できていた" — impression, no conditions given.
- **aki_think** — subagents as pure functions, and a *reset* (not a compaction) when the parent context is contaminated (quoted in §2).
- **suwa_nobu** — the measured half of the isolation story: before 2.1.271 every subagent received the full CLAUDE.md hierarchy; `omitClaudeMd` makes that optional; the *token size* of the inheritance remains unmeasured by him and, in this corpus, by anyone (§1.6c).
- **shinpr** — subagents plus an explicit quality-checker agent, with the tool printing each subagent's spend (`62.9k tokens`, `65.2k tokens`, `102.7k tokens`, `87.6k tokens`), the clearest published illustration that isolated subagents still burn five-figure token budgets each.
- **nozomu** — isolation for scope: "独立した調査や検証は、サブエージェントで別コンテキストに分ける選択肢もあります。", plus filtering long tool output before it reaches the parent context.
- **Tsutomu_eng** — the reason subagent numbers must be excluded from compaction arithmetic: "# サブエージェントは別コンテキストなので除外".
- **jadaq** — one subagent-specific control worth noting: "サブエージェント定義には `model:` を書く".

**Explicit negative:** I found no Japanese-language source that measures isolated-subagent execution against single-context execution on a coding task (same task both ways, with numbers). The closest are mizchi's dollar figure, which has no stated conditions, and aki_think's practice description. shinpr's token reports and suwa_nobu's inheritance test measure *cost* and *leakage* respectively, not outcome.

## 4. Slide-only slice: the Japanese deck corpus (bodies UNREACHABLE)

Speaker Deck's server-rendered search makes the Japanese deck corpus visible; the deck bodies are not machine-retrievable (JS viewer; appending `.pdf` returns 301 back to the deck page; the player HTML exposes no slide text). This section therefore records *what exists and how much attention it holds*, and nothing about its content.

From `https://speakerdeck.com/search?q=コンテキスト管理&language=ja` and `?q=Claude+Code&language=ja` [DIRECT, search HTML], with author names from each deck's oEmbed where fetched:

| Deck | Author | Attention (views / likes) |
| --- | --- | --- |
| "Claude Codeの「Compacting Conversation」を体感50%減！ CLAUDE.md + 8 Skills で挑むコンテキスト管理術" (`/kmurahama/…`) | Kazuki Murahama (per oEmbed; described as "2025/12/17 AI駆動開発勉強会 沖縄支部 第3回の発表内容です") | 2.1k views, 3 likes |
| "Copilot CLI の継戦能力を高める コンテキスト管理" (`/nozomutu/…`) | `nozomutu` — same person as the Zenn article in §1.3, which is this talk's written twin | 1.4k views, 1 like |
| "エージェントに記憶を与える -コンテキスト管理の設計と実践" (`/autotaker/…`) | `autotaker` — Zenn bio "本当はHaskellを書きたいJava SETエンジニアです" | 1k views, 0 likes |
| "長期運用プロダクトこそ効くコンテキスト管理の妙 / The Art of Context Management for Long-Running Products" (`/codmoninc/…`) | codmon Inc. (PRO account) | 820 views, 0 likes |
| "AIエージェント時代のハーネスエンジニアリングとは" (`/tame/…`) | `tame` | 4.9k views, 6 likes |
| "AIによる開発の民主化を支える コンテキスト管理のこれまでとこれから" (`/mulyu/…`) | `mulyu` — written twin is the TOKIUM article in §2 | 3.2k views, 3 likes |
| "人が考えるべきことに集中するためのコンテキストの作り方" (`/s9a17/…`) | `s9a17` | — |
| "20260514_its_the_context_window_stupid.pdf" (`/heita/20260514-its-the-context-window-stupid`) | `heita` | 1.5k views, 1 like |
| "Claude Code どこまでも / Claude Code Everywhere" (`/nwiizo/…`) | `nwiizo` | 58k views, 67 likes — the highest-attention Japanese Claude Code deck found |

**Explicit negative:** kmurahama's "体感50%減" is in the title and the slides are unreachable, so the 50% has no verifiable basis in this record; the word 体感 ("felt") in the title is the author's own signal that it is not a measurement. Treat the table as an inventory of awareness, not evidence of practice — with the one exception noted: the `nozomutu` deck has a written twin whose numbers are in §1.3.

## 5. What the Japanese-language corpus adds to the English-language record

Measured against `2026-09-27-compaction-defaults-across-harnesses.md` and `2026-09-27-context-management-lab-guidance.md`, whose vendor/lab numbers stand as the anchor, this corpus adds five things those records do not contain:

1. **A measured auto-trigger band with the log arithmetic shown.** Tsutomu_eng's 16万〜18万 and "圧縮前→後 : 168,635 → 14,296 tok" describe the same regime as the vendor's 150,000 API default and Amp's "200k tokens is plenty" / 90% pair, but derived from one user's 148 sessions rather than from documentation. It is also the only source in any language I reached this session that reports the **auto/manual split (99.6% / 0.4%)** — quantified evidence that practitioners do not choose when to compact; the tool does.
2. **`/rewind` as a cheaper alternative to `/compact`,** because it truncates to an already-cached prefix (jadaq: "rewind は末尾を切り落とすだけで、それより前のキャッシュは全部生きている＝ゼロコスト"). The English-language records cover context editing and compaction; truncation-to-cached-prefix as a deliberate context-management move is not in them.
3. **Handoff artifacts measured as failures.** miilaka's Read-call ceiling (25,000 tokens per call in his environment; a 1,508-line Japanese log ≈ 73,000 tokens; only the first 436 lines arrive, with the newest chapter at the end) and aiqlabs's 205-session report (2,249-line handoff, only the first 40 lines injected, 15 lines naming the previous session's claim as 誤り/撤回, corrupted tool output propagating through saved text) are quantitative failure modes of a technique the English-language records treat as a practice. Both authors sell the practice; the mechanism is not thereby invalidated, but each number is one practitioner's illustration, not a survey.
4. **A documented subagent-context leak whose token size is honestly left unmeasured** (suwa_nobu: before 2.1.271 every subagent carried all CLAUDE.md levels; `omitClaudeMd` closes it; he refuses to publish a token delta because his own A/B showed the same delta with no CLAUDE.md present at all). That is better grounded than any vendor page cited for subagent isolation in the sibling records.
5. **A person-side percentage band.** toshi772's "体感50〜60%" is the only practitioner-authored band in this corpus, and it points the same way as the sibling records — that omp's 85% is not conservative — rather than toward the tutorial literature, which mostly repeats the vendor's automatic trigger as if it were advice. Of the two most-liked Japanese context articles found (pnd, 254 likes; karaage0703, 116 likes), one states the vendor's automatic behaviour and the other reports his own inventory; neither recommends a budget.

One more difference in kind, worth stating plainly: **the Japanese-language corpus is where the "put state in files, not in the window" school is most developed.** This record alone documents at least seven distinct schemes — HANDOFF.md with fixed headings (helloworld), HANDOFF.md + QUESTIONS/ (crandim), Note + Plan with 現在地 (arithan), 世界樹 (nekonotte), 引き継ぎ.md one-pager (gorinvestor, `https://zenn.dev/gorinvestor/articles/7c0cc42d5a81ea`, seen in search results only), a compaction-time digest hook with ranked session summaries (aiqlabs), and 1,500-line logs folded monthly (miilaka). The English-language material in the sibling records covers handoff as a technique; it does not contain this volume of *measured* operational failure around it.

## 6. Explicit negatives

**Named people who publish nothing on this topic, with the search paths used.** These are negatives over the reachable corpus, not proof of absence:

- **`mizchi` (Kotaro Chikuba)** — the person several of this repo's records were named after — has no context-budget article. His Zenn listing (`GET /api/articles?username=mizchi`, fetched this session, 48 entries returned) contains Claude Code pieces from 2025-06/07 (cheatsheet, orchestrator, "技術的特異点") and 2026 (Bit, vlmkit), all searched by title for コンテキスト / トークン / compact / harness. What he does publish on the topic is the orchestrator piece quoted in §3 (subagent summaries of 100–200 words; "$6 → $1 未満" impression) and one measured-regret line in the cheatsheet (`https://zenn.dev/mizchi/articles/claude-code-cheatsheet`, 852 likes): "`/compact` はそのセッションの会話を要約して、コンテキストを圧縮する。履歴が膨らむと勝手に発動するので、よく使うというか、残念ながら使わされるコマンド". No threshold, no budget.
- **`k1LoW` (Ken'ichiro Oyama, Tailor Inc.)** — `gh api users/k1LoW/repos?per_page=100&sort=pushed` returns 70+ repos with no agent-context tooling (closest adjacents: `k1LoW/mo`, a Markdown viewer, 1,068★; `k1LoW/git-wt`, 562★; `k1LoW/gh-copilot-review`); `https://zenn.dev/api/users/k1low` has no articles (one book, `runn クックブック`). No writing on agent context found.
- **`songmu` (Masayuki Matsuki, GitHub Japan G.K.)** — writes a running diary at `https://songmu.jp/riji/` (fetched; the archive page `/riji/archives.html` does not render its list to a non-JS fetch, so this negative is limited to the diary front page and repo listing). Recent posts are agent-adjacent tooling with a token-cost remark but no numbers — "ここは決定的なスクリプトなので、出力が変になることもないし、トークンコストも抑えられる" (`sagepipe`, 2026-09-27). His agent-adjacent repos are `Songmu/skillsmith` (embed Agent Skills in Go CLIs, 21★, README read: no token numbers) and `Songmu/insmith` (6★). No context-management writing found.
- **`hiraku`** — unverifiable as a Japanese practitioner identity: the Zenn user `hiraku.usami` has 0 articles, and `gh api search/users?q=hiraku+in:login` returns unrelated accounts. Discarded as unverified rather than recorded as a negative about a person.

**Category negative — the impression-only and SEO layer.** Most Japanese hits on 「Claude Code コンテキスト」 / 「コンテキストエンジニアリング」 are impression-only, frequently AI-generated SEO content with round numbers and no measurement or environment. Examples reached and discarded: `https://zenn.dev/takuyanagai0213/articles/claude-code-100-skills-full-record` (65 likes, "100個のSkill" over "4ヶ月", no environment, no reproduction), `https://zenn.dev/babushkai/...` ("85%トークン削減！" style headline with no method), and the changelog-roundup genre (`https://qiita.com/NaokiIshimura/items/6cbf554ecbf81a43e3c5`, `https://qiita.com/moha0918_/items/4d9f3ac4f27c7bac0aab`, `https://qiita.com/Takuya__/items/85659512e93f4d8fa3ef`), which restates vendor documentation. They are counted here as a *category* precisely because a reader searching in Japanese hits them first: they carry the vocabulary of measurement without any.

**No precedent found** (searched, not found — see §4 and the discovery constraint in Method):

- No Japanese-language practitioner publishes a personal token threshold for *voluntary* `/clear` or `/compact`. The only share-of-window band is toshi772's felt 50–60%; every other number describes the tool's own trigger or the current inventory.
- No Japanese-language measurement of isolated-subagent execution versus single-context execution on a coding task.
- No company-level Japanese publication of a context policy with numbers (TOKIUM's article is the only organization-level description reached, and it has none). A widely referenced "Globis 1000 sessions" analysis could not be reached or confirmed.
- No Japanese-language source that publishes a *retention* measurement by re-running the same task before and after compaction with the artifact attached. akira_cloudjob's Day-24 title claims 情報保持率100%; the method is not published.

## 7. Unverified

The negative results above are limited to what this egress could reach. Real limits of this record:

- **All deck bodies** in §4 are UNREACHABLE (JS viewer; no PDF path). Titles, descriptions, authors and view counts are DIRECT. kmurahama's "50%減" therefore has no basis in this record.
- **Anonymous authors.** `akira_cloudjob`, `miilaka`, `k0kishima`, `hocky3`, `mamagotolab`, `aiqlabs`, `arithan`, `nekonotte`, `crandim`/`tokoi`, `ryutarom128` and `helloworld` cannot be tied to a person or employer. `suwa_nobu` shows an employer (株式会社JQIT) but no name. `Tsutomu_eng` publishes a name (Tsutomu Saito) but no employer. `jadaq` is self-employed; there is no one to corroborate him.
- **No product output was re-derived.** The `/context` dumps in §1 (jadaq, karaage0703, akira_cloudjob, nozomu, suwa_nobu) are transcribed by their authors, often from screenshots. I did not re-run any of them, and the numbers cannot be checked against a published artifact.
- **Commercial interest was not audited beyond what the pages state**, and in several cases (miilaka's book, aiqlabs's service, shinpr's work) the article is partly a lead source.
- **third-party reproductions.** suwa_nobu's 36.2% (arXiv 2026-07-28) and jadaq's reference to an Anthropic blog post are TRANSCRIBED; neither original was fetched.
- **Search coverage.** X/Twitter, Discord, YouTube, closed corporate material and conference videos are outside this survey, and the Qiita/Zenn APIs may not return everything (Zenn `count=48` returned 48 entries for `mizchi`, which may be a page cap rather than his total).

## 8. Conclusion

**Yes — Japanese-language practitioners do publish numbers for when context gets compacted, and the numbers agree with each other: about 80% of the window, i.e. 160,000 tokens on a 200K window, or a measured 16万〜18万 in one 148-session log.** The single most useful number for the question asked is Tsutomu_eng's measured compaction: 705 compactions, "圧縮前→後 : 168,635 → 14,296 tok", median pre-compaction per-turn cache read "164,690 tok", and his own statement of the trigger band, "閾値が16万〜18万トークンなら". pnd states the same boundary as a constant (`200000 * 0.8`) and nozomu states it for a different vendor ("約80%"). What almost nobody publishes is a *personal* threshold — the only one is toshi772's "体感50〜60%".

**What that means for the 200K / 170K pair.** 170,000 is 85% of the working budget: above the 80% convention, above the only published proactive band (50–60%), and inside the autonomously observed trigger band. It is not a conservative choice in the sense the question asks. What the corpus actually supports, if a number is wanted at all, is either (a) keep the window large and let the tool fire near 80%, or (b) pick a small fraction of the window (the only published band being 50–60%) and treat compaction as a safety net, which is what akira_cloudjob and, in effect, most of §2 do by gating on task boundaries instead.

**The more transferable finding is not a threshold.** The Japanese corpus's distinct contribution is operational and mostly measurable only in its failures: state lives in files with fixed roles; sessions are short and restart often; handoff files have a measured size ceiling imposed by the *reader*, not by the window (25,000 tokens per Read call; a 2万字 / 791行 Japanese log validated); and handoff text preserves conclusions without their evidence, which measurably amplifies errors across 205 sessions. If the budget is to be tuned, the evidence here says the /clear-plus-handoff shape and the file sizes are the parts with measurements behind them, and the threshold is the part without.

## URLs fetched this session

Platform APIs and endpoints used for discovery (not sources themselves): `https://qiita.com/api/v2/items?query=`; `https://qiita.com/api/v2/items/<id>`; `https://qiita.com/api/v2/users/<id>`; `https://zenn.dev/api/search?q=&source=articles&order=most_liked`; `https://zenn.dev/api/articles?username=`; `https://zenn.dev/api/users/<username>`; `https://zenn.dev/api/books?username=`; `https://speakerdeck.com/search?q=&language=ja`; `https://speakerdeck.com/oembed.json?url=`; `gh api users/<login>`, `gh api users/<login>/repos`.

Sources, grouped as in the body:

- Measured / numeric: `https://qiita.com/Tsutomu_eng/items/3ce60c1d8ceb1f8bcc39` · `https://zenn.dev/pnd/articles/claude-code-statusline` · `https://qiita.com/toshi772/items/bae57ac508918c536072` · `https://zenn.dev/nozomu/articles/4b55abc30c8ec1` · `https://zenn.dev/akira_cloudjob/articles/1f052f3e569e87` · `https://zenn.dev/jadaq/articles/5f85c29d7f4f60` · `https://note.com/qiuyu/n/n8c900edb24ed` · `https://qiita.com/suwa_nobu/items/e02595193c2ec2e733a3` · `https://qiita.com/suwa_nobu/items/817a26e02cd1f08c7edd` · `https://qiita.com/suwa_nobu/items/b465ef863f8d8608f497` · `https://qiita.com/suwa_nobu/items/2dee3e3d53080c3676a0` · `https://qiita.com/suwa_nobu/items/cea574550613de33a114` · `https://qiita.com/karaage0703/items/1f30a572ff8460` · `https://qiita.com/mamagotolab/items/37d3bdd0bafdd81ba392` · `https://qiita.com/ryutarom128/items/310d79a8f1d4bc22273b` · `https://zenn.dev/miilaka/articles/claude-code-read-limit-handoff` · `https://zenn.dev/aiqlabs/articles/70370e973d8425` · `https://zenn.dev/tacoms/articles/552140c84aaefa`
- Criteria without numbers: `https://zenn.dev/k0kishima/articles/8976ce2bf725e0` · `https://qiita.com/Yasushi-Mo/items/0071f71ba102d2125c13` · `https://zenn.dev/aki_think/articles/66f6fc7530467a` · `https://zenn.dev/hocky3/articles/963c5e9e706e7f` · `https://zenn.dev/crandim_r_and_d/articles/260822_a10_handoff_questions_workflow` · `https://zenn.dev/helloworld/articles/a74a29997ab901` · `https://zenn.dev/arithan/articles/claude-code-handover-overview` · `https://zenn.dev/nekonotte/articles/318f553c606b95` · `https://zenn.dev/tokium_dev/articles/3236cc7c721259` · `https://zenn.dev/mizchi/articles/claude-code-orchestrator` · `https://zenn.dev/mizchi/articles/claude-code-cheatsheet`
- Slides (metadata only): `https://speakerdeck.com/kmurahama/claude-codeno-compacting-conversation-woti-gan-50-percent-jian-claude-dot-md-plus-8-skills-detiao-mukontekisutoguan-li-shu` · `https://speakerdeck.com/nozomutu/copilot-cli-noji-zhan-neng-li-wogao-meru-kontekisutoguanli` · `https://speakerdeck.com/autotaker/ezientoniji-yi-woyu-eru-kontekisutoguan-li-noshe-ji-toshi-jian` · `https://speakerdeck.com/codmoninc/the-art-of-context-management-for-long-running-products` · `https://speakerdeck.com/tame/aiezientoshi-dai-nohanesuenziniaringutoha` · `https://speakerdeck.com/mulyu/ainiyorukai-fa-nomin-zhu-hua-wozhi-eru-kontekisutoguan-li-nokoremadetokorekara` · `https://speakerdeck.com/s9a17/hito-ga-kangaerubeki-koto-ni-shuuchuu-suru-tame-no-kontekisuto-no-tsukurikata` · `https://speakerdeck.com/heita/20260514-its-the-context-window-stupid` · `https://speakerdeck.com/nwiizo/...` (Claude Code どこまでも — the deck slug was not captured, so this URL is the profile root for the author shown in search results)
- Vendor anchor fetched for the 15万 cross-check: `https://platform.claude.com/docs/en/build-with-claude/compaction-threshold`
- Identity / maintenance evidence (in-the-wild lens): `https://github.com/Songmu/skillsmith` · `https://github.com/Songmu/godzil` · `https://songmu.jp/riji/` · `gh api users/k1LoW/repos` · `gh api users/songmu/repos` · `https://zenn.dev/api/users/k1low` · `https://zenn.dev/api/users/nozomu` · `https://qiita.com/api/v2/users/Tsutomu_eng` · `https://qiita.com/api/v2/users/toshi772` · `https://qiita.com/api/v2/users/mamagotolab` · `https://qiita.com/suwa_nobu` (profile showing 株式会社JQIT)
