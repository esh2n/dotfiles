---
question: "How do practitioners persist research/decision records so later agent sessions can find and reuse them without re-researching, and what is known about writing clear explanations and diagrams for a tired reader?"
date: 2026-09-22
verdict: "Persistent agent memory converges on a small always-loaded index plus on-demand topic files, referenced by URL/stable path rather than numeric ID; clear writing converges on leading with the point, one idea per paragraph, concrete examples, and diagrams only for mechanisms (never decoration) — no source gives a universal length ceiling."
unverified:
  - "Codex's own AGENTS.md discovery/priority/memory mechanism (official docs unreached)"
  - "Obsidian's official vault structure and MCP integration docs (404s)"
  - "A first-person account of an agent actually reading Simon Willison's TIL notes"
  - "Any connection between Andy Matuschak's evergreen notes and AI agents"
  - "A quantitative comparison of flat index vs grep vs embedding vs MCP search recall"
  - "A named practitioner essay specifically about agents ignoring their own notes"
  - "Edward Tufte's chart-junk/data-ink-ratio writing, primary quotes"
  - "Mayer's coherence/signaling/redundancy/spatial-contiguity principle definitions (6 URLs, all 404/403)"
  - "Research on LLM-generated text comprehension, trust, or reader fatigue"
  - "JTF Japanese style guide content (404/403)"
  - "Yuki Hiroshi's book-specific writing principles beyond his general essay"
  - "Excalidraw's AI diagram generation documentation (404)"
  - "Practitioner writing specifically about how to fix AI-generated prose"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 永続知識ストアと分かりやすい説明文 — 業界調査 2026-09-22

対象: writeup パイプラインの二つの動機に対する直接的な業界調査。(1) agent の調査・決定を Notion 的に永続化し、後続セッションが再調査しないようにする。(2) AI が書く説明文を理解可能にする（現状クラリティ自己評価 20/100）。

前提として尊重するルーリング: メモリはリポジトリ内のファイルのみ（ハーネス横断のメモリ DB は作らない）。決定は `rules/decisions/` 配下の短い Markdown。

先行調査 `.tmp-research/writeup-practice.md`（ADR フォーマット、AI 文検出器 vs リンター、公開先）とは重複しない範囲に絞った。

## 方法と検証凡例

- 直接 fetch: `WebFetch` / `curl` / `gh api` でベンダー一次ドキュメント・GitHub raw を取得したもの。無印。
- `[via summarizer]`: WebFetch は取得 HTML を小型モデルで要約してから返す。原文全体ではなく要約結果であることを明示。
- `[unverified]`: 一次情報に到達できず、モデルの学習知識に基づく主張。
- `gh`（認証済み）で `gh search repos` / `gh search code` / `gh api` / `gh repo view` を使用。
- 到達できなかったソース（403・404・リダイレクト先404・検索予算切れ）は「未到達」と明記。「見つからない」は「存在しない」ではなく「到達できなかった」を意味する。
- 本調査は Q1・Q2 それぞれを担当する 2 本の並列サブエージェントで実施し、この文書に統合した。両エージェントとも WebSearch は途中でセッション共有の予算（200 回）を使い切り、後半は `WebFetch` の直接 URL 指定と `gh` のみで継続した。この制約自体を負のエビデンスの一部として扱い、未到達項目は隠さず「先例が見つからなかったもの」に列挙する。

---

# Q1 — agent が使える永続知識ストア

**問い**: 2026 年、人々はどうやって調査記録・決定を保存し、後続の（無関係な）agent セッションがそれを見つけて再利用し、再調査を避けられるようにしているか。

## 1. Vendors

**Claude Code memory / auto-memory**（`https://code.claude.com/docs/en/memory.md`、直接 fetch。忠実度は高いが `[via summarizer]` 扱い）

- 仕組みは「2 段構成のインデックス＋オンデマンドファイル」。全文検索でも埋め込み検索でもない。引用: *"Each project gets its own memory directory at `~/.claude/projects/<project>/memory/`... The directory contains a `MEMORY.md` index and one topic file per memory... `MEMORY.md` acts as an index of the memory directory."*
- 起動時に自動ロードされるのは `MEMORY.md` の先頭のみ: *"The first 200 lines of `MEMORY.md`, or the first 25KB, whichever comes first, are loaded at the start of every conversation... Claude Code doesn't load topic files... at startup. Claude reads them on demand using its standard file tools when it needs the information."*
- 検索は素の file read。埋め込みではない: *"Claude reads and writes memory files during your session."*
- 鮮度管理: 書き込み時に `modified` ISO-8601 タイムスタンプを付与し *"so it shows how current the fact is."*
- サイズと遵守率のトレードオフを自ら明言: *"target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence"* — これは後述の「context rot」という実務家用語と独立に一致する。
- `@path` インポート、`paths:` frontmatter によるパス限定ルール、**プロジェクトルート CLAUDE.md は `/compact` を生き延びて再読込される**（ネストされたパス限定ファイルは自動生存しない）ことを確認。

**Codex AGENTS.md** — 公式ドキュメントに未到達。`developers.openai.com/codex/agents-md` は 308 リダイレクト後 404。`github.com/openai/codex` の AGENTS.md はコントリビュータ向けコーディング規約のみで、AGENTS.md 発見・優先順位・メモリ機構の記述はなし。**Claude Code と同じ挙動だと仮定してはならない。**

**GitHub Copilot + `docs/`**（`docs.github.com/en/copilot/concepts/response-customization`、直接 curl）

- `AGENTS.md`・`CLAUDE.md`・`GEMINI.md` を "Agent instructions" として明示的に言及。
- **重要な反証**: GitHub 自身がこのパターンに警鐘を鳴らしている。引用: *"for a large and diverse repository, these may cause problems: Requests to refer to external resources when formulating a response... the following instructions may not have the intended results: 'Always conform to the coding styles defined in styleguide.md...'"* 「docs/ に置けば Copilot が使う」と推奨する公式文書は見つからず、むしろ逆方向の注意喚起があった。

**Notion MCP**（`developers.notion.com/docs/mcp`、`[via summarizer]`）— ライブなツール拡張として説明されるのみ（検索・読み書き・ページ作成）。**永続的なセッション横断エージェントメモリとしては文書化されていない。**

**Obsidian** — vault 構造や MCP 連携の一次ドキュメントに未到達（`help.obsidian.md/plugins/local-rest-api` 404、リダイレクト先も 404）。agent 連携は全てサードパーティ製（下記 in the wild）。

## 2. Practitioners

**Simon Willison の TIL**（`til.simonwillison.net`、`[via summarizer]`）— 582 件、タグ閲覧、Atom フィードという人間向け検索可能ノートの実例は確認できたが、**agent が TIL を読む・書くワークフローへの接続は今回到達した範囲では確認できず**。

**Andy Matuschak の evergreen notes**（`notes.andymatuschak.org`、断片的に到達）— 核心の主張は原子性と相互リンクによる想起（*"Evergreen notes are written and organized to evolve, contribute, and accumulate over time, across projects"*）。**AI agent との接続は到達範囲では見つからず。**

**「agent に実際に過去のノートを読ませる」具体的パターン**（`gh search code` で多数の独立リポジトリから収集。これが本 Q1 で最も強いエビデンス群）:

1. **「まずこれを読め」インデックスファイルの収束的パターン**（複数の無関係リポジトリでほぼ同一表現）: `evershopcommerce/evershop`（10,489 stars、2026-09-17 push）"`wiki/index.md` — catalog of all pages... Read this first"；`agents-io/PokeClaw`（1,063 stars）"`AI_INDEX.md` | Repo map for coding agents"；`gl0bal01/intel-codex`（60 stars、2026-09-20 push）Obsidian vault を "field manual" 化し `.omc/vault-state.md`（read this first）＋各階層に `*-Index.md` ハブ。
2. **「再調査するな」という明示的な禁止指示**: `ozykhan/iina-airplay`（22 stars）"## Facts already established — do not re-research these"；`PriyanArora/shorecheck` "Never re-research, re-fetch, or re-derive them"；`reflex-search/reflex` "Avoiding rework: Don't re-research solved problems."
3. **`docs/decisions/` ＋ AGENTS.md/CLAUDE.md での明示的な読み込み指示**: `lovitus/mdd-sim-gateway` AGENTS.md — "Read docs/decisions/2026-09-20-current-scope.md... before changing scope. Latest explicit owner decisions govern requirements; a stale ledger... must be corrected, not used to override those decisions."；`bforbesc/claudia` — "`docs/decisions/<topic>.md` holds which decisions were made and why (this cannot be found in the code)"。
4. **`paths:` frontmatter による条件付きロード**が実際に使われている（`clingen-data-model/clinvar-gkm`）。
5. **Karpathy「LLM Wiki」パターン**が名指しで複数リポジトリの設計根拠として引用されている: `Simon-YHKim/2nd-B` の `docs/research/CLAUDE.md`（`gh api` で全文取得）— *"Following Andrej Karpathy's LLM Wiki pattern (April 2026), this is the schema layer... Audience: AI agents reading this to answer user queries."* Query→file のルーティング表を持つ。他にも `NulightJens/ai-second-brain-skills`、`AgriciDaniel/claude-obsidian`、`helloianneo/obsidian-ai-second-brain` が同パターンを引用。

**負のエビデンス**（最も判断材料になる部分）:

- **リポジトリ間 ID 参照は想起を壊し、agent を積極的に誤誘導する**。`windyroad/agent-plugins`（6 stars、2026-09-22 push）の問題チケット全文: *"Every plugin... ships SKILL.md / hook / agent files dense with `ADR-NNN`... references that resolve correctly only in the source repo. In adopter projects those IDs either do not resolve (best case) or resolve to UNRELATED decisions in the adopter's own `docs/decisions/` (worst case)... The agent's behavior is now confidently wrong, anchored on a misleading decision document."* — ダングリングポインタは大人しく失敗する（file not found）が、番号 ID は無関係な内容に静かに解決されうる、という一次証拠。
- **「context rot」は独立に多数のリポジトリで使われる定着した実務家用語**: `Kaikei-e/Alt`「Long-running sessions silently lose the invariants ('context rot')」、`lucasxf/engineering-daybook`「'context rot' — the degradation in quality that occurs when a single session accumulates 10+ commits worth of file reads」など。Claude Code 公式の「200行超で遵守率低下」という言明と独立に一致。
- **compaction が再調査ループを引き起こす**: `robertphyatt/ironclaude` CLAUDE.md — "Set max_turns on subagents so they fail fast rather than spiral (compaction loses critical detail, causing re-research loops)."
- **research ディレクトリの陳腐化を自認する実例**: `Nathandela/long-running-harness`（2026-03-29 push）"The single source of truth for all research is `research/`. The old `docs/research/` path no longer exists — never create or reference it" — 移行未完了の生きた証拠。
- **抜粋からの合成を明示的に禁止するルール**: `enjector/microgpt-c`（115 stars）"Do not synthesise across research documents from excerpts."

「エージェントがノートを無視する」と題した名指し実務家のブログ記事は今回到達できず（WebSearch 予算切れ、未到達扱い）。ただし `gh search code` による運用ファイル（CLAUDE.md/AGENTS.md 本文）からの証拠は、エッセイより具体的な「運用上の指示」という別種のエビデンスとして代替的に収集できた。

## 3. Measured

- `IAAR-Shanghai/Awesome-AI-Memory` のREADME（`[via summarizer]`）は LoCoMo・LongMemEval という会話長期記憶ベンチマークを挙げるが、これは **チャット履歴からの事実想起** を測るものであり、コーディング agent によるファイルベース調査記録の想起とはタスクが異なる。この数値をそのまま Q1 に転用するのは不適切。
- flat index vs grep/全文検索 vs 埋め込みセマンティック検索 vs MCP ツール検索、という比較についての定量研究・ベンチマークは**発見できず**。「数字なし」。
- 唯一の具体的な数値（ただし単一リポジトリの方針表明であり測定ではない）: `alisadikinma/Portfolio_v2` CLAUDE.md — "Vault recall is sequential file-read (not semantic)... vector-RAG was deliberately dropped (YAGNI), re-evaluate only if the vault exceeds ~5000 files AND keyword/graph recall proves insufficient." **[unverified as general claim]**、一事例の閾値ヒューリスティックとして扱う。

## 4. In the wild

`gh search code "docs/research" filename:CLAUDE.md`、`"read docs/decisions" filename:AGENTS.md` 等の検索、および `"second brain"` `"agent memory"` のリポジトリ名検索を実施。

代表的な日付付きリポジトリ（5件）:

1. `Morrison-Lab/ai-config`（1 star、2026-09-22 push）— "Maintain a 'lab notebook' for each session — a dated, append-only file written to *as work happens*... so that if the session is interrupted with no clean exit... a later session (or I) can pick it up." 本調査が想定する失敗モード（中断による損失）に直接対応する実例。
2. `Simon-YHKim/2nd-B`（0 stars、2026-09-21 push）— `docs/research/CLAUDE.md` に query-routing table 付きの index-as-schema パターン。
3. `ozykhan/iina-airplay`（22 stars、2026-09-12 push）— 外部ソース引用付きの日付入り「確立済み事実」セクションを CLAUDE.md に直接埋め込む実例。
4. `windyroad/agent-plugins`（6 stars、2026-09-22 push）— ID 参照失敗モードを自ら文書化（上記負のエビデンス）。
5. `Nathandela/long-running-harness`（1 star、2026-03-29 push）— 移行未完了による陳腐化の生きた実例。

**「agent 向け second brain」は 2026 年時点で実在し活発な製品カテゴリ**: `eugeniughelbur/obsidian-second-brain`（4,574 stars、作成 2026-03-24、push 2026-09-21）"Persistent memory for Claude Code and 6 other CLI agents, stored as plain markdown in your Obsidian vault... hybrid semantic search"；`okf-memory/okf-agent-memory`（713 stars、作成 2026-09-05、push 2026-09-22）"Git-native persistent memory... sub-300µs in-memory BM25 search... Slashes token bloat by 80%"（ベンダー自己申告の数値、独立検証なし、`[unverified]` マーケティング主張として扱う）；`tigerless-labs/agent-memory`（963 stars）"plain Markdown as the source of truth, local ranked retrieval"；`riponcm/projectmem`（832 stars）"warns your agent before it repeats an approach that already failed"。

**収束パターン**: 独立に競合する複数チームが、いずれも「プレーン Markdown ファイルを真実源とし、その上に BM25/キーワードランキングなどの検索層を足す」という設計に収束している（純粋な埋め込みセマンティック検索のみに頼るものはなかった）。これは「ファイルのみ、DB を作らない」という既存ルーリングと矛盾せず、むしろ市場の独立収束として補強する。

興味深い負の発見: `"research log" filename:CLAUDE.md` の完全一致検索は **0 件**。一方 `"decision log"` `"lab notebook"` は複数ヒット。「research record／research log」という語彙は 2026 年時点でまだ定着した実務家用語ではない（`docs/research/` というディレクトリパス自体は 18 件超ヒットしており広く使われているのとは対照的）。

## Q1 の結論 — 記録の形と置き場所

各項目の根拠は「整理のため」ではなく、発見した失敗モード／メカニズムに基づく:

- **1行のインデックスエントリを持つこと。** Claude Code の MEMORY.md 機構と、7件超の独立リポジトリで収束している「INDEX.md — read this first」パターンの両方が同じ形に収束している。Anthropic 自身の文書が明言する通り、自動ロードされるのはインデックスのみで、本体はインデックスの一行を見て関連性を判断した agent がオンデマンドで読む。
- **結論（verdict）を証拠より前に、独立した1行として書くこと。** `windyroad/agent-plugins` の失敗例が示す通り、「この記録の結論はまだ有効か」を安く判定できないと、agent は記録を無視するか誤適用する。
- **「検証できなかったこと」を明示すること。** `enjector/microgpt-c` が抜粋からの合成を禁じたのは、「確認して不在と分かった」と「そもそも確認していない」を区別できない記録を信用しないからである。`ironclaude` が報告する compaction 起因の再調査ループも同じ問題の裏返し。
- **記録本体にも個々の主張にも日付を持つこと。** Claude Code の `modified` フィールドは「事実がどれだけ最新か示すため」と明言されており、`Nathandela/long-running-harness` の陳腐化事例はその不在時の結果を示す。
- **参照は内部 ID ではなく URL／安定したパス・スラッグで行うこと。** `windyroad/agent-plugins` の文書化された失敗モード（ID が無関係な決定に解決されてしまう）が最も強い根拠。URL は到達不能なら「未到達」として安全に失敗するが、番号 ID は誤った内容に静かに解決されうる。

**置き場所**: エビデンスは「インデックスか、ディレクトリか」の二択を支持しない。両方を機能させている実例（Claude Code の MEMORY.md＋topic files、`Simon-YHKim/2nd-B` の index.md＋batches/、`evershopcommerce` の wiki/index.md＋wiki ページ、`gl0bal01/intel-codex` の階層別 `*-Index.md`）は全て「常時ロードされる小さなポインタファイル＋関連時のみ開かれる本体ディレクトリ」の組み合わせを使っている。ディレクトリのみ（存在自体が agent に伝わらない）、インデックスのみ（Claude Code の 200行/25KB 上限がまさにこの限界を制度化している）で機能する実例はなかった。`paths:` frontmatter は「常時」でも「検索」でもない第三のロードモードとして、特定コードパスに紐づく記録には使う価値がある。

---

# Q2 — 分かりやすい説明文と図

**問い**: 疲れた読者が一読で理解できる説明文について、また図について、何が分かっているか。

## 1. Vendors

**Google Developer Documentation Style Guide**（`developers.google.com/style`、直接 fetch）

- 段落構造: *"Each paragraph should address a single idea in the fewest words and in the fewest sentences possible."* *"A paragraph longer than 5 or 6 sentences is often an indication that the paragraph is trying to convey too much information."* *"Put the most important information first in a paragraph. Don't hide the key point of a paragraph at the end."*
- 見出し: *"Use descriptive headings and titles"*、タスク見出しは動詞の原形、概念見出しは "-ing" なしの名詞句、センテンスケース必須。
- 文構造: 条件・状況を指示より前に置く。文の長さの数値上限はページ上に**なし**。
- ハイライト集約ページ: 能動態、二人称、グローバル読者向け配慮。

**Microsoft Writing Style Guide**（`learn.microsoft.com/en-us/style-guide/`、更新日 2026-07-06 で最新性を確認）

- *"Use bigger ideas, fewer words... Shorter is always better."* *"Write like you speak. Read your text aloud."* *"Get to the point fast. Lead with what's most important. Front-load keywords for scanning."*
- 弱い言い回しの排除: *"Avoid weak phrasing like 'there is', 'there are', and 'there were'."*
- 見出し: *"Think of headings as an outline, only more interesting... If readers don't read the headings, they probably won't read the text that follows, either."* 同レベルの見出しは "Use parallel sentence structure"。

**Diátaxis**（`diataxis.fr`、直接 fetch）

- 4類型の中で explanation だけが理解志向: *"Explanation = 'to illuminate a topic' (orientation: understanding; question: 'Why…?')"*。
- explanation 固有の性質: *"Explanation can and must consider alternatives, counter-examples or multiple different approaches."* *"explain why things are so - design decisions, historical reasons, technical constraints."* 一方で *"closely bounded"* — 手順や技術リファレンスが混入しないよう戒めている。

**Anthropic**（`platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices`、直接 fetch）

- 黄金律: *"Show your prompt to a colleague with minimal context on the task and ask them to follow it. If they'd be confused, Claude will be too."*
- 出荷済みシステムプロンプト断片: *"When writing reports, documents, technical explanations, analyses, or any long-form content, write in clear, flowing prose using complete paragraphs and sentences... NEVER output a series of overly short bullet points."*
- **矛盾フラグ**: 同じ Anthropic のドキュメント自体は XML タグ・表・アコーディオンを多用している。つまりこのルールはジャンル依存（説明的散文 vs 機械可読な指示）であり、普遍則ではない。
- `anthropic.com/research/claudes-constitution` は到達したが、内容はモデルの倫理・振る舞いであり文章の明瞭さの指針ではないため、本チェックリストの根拠には使わない。

## 2. Practitioners

**結城浩**（`hyuki.com/writing/writing.html`、`[via summarizer]`）

- 読者中心主義: 「文章を読むのは読者である。したがって、読者のことを考えるのは当然のことと言える。けれど、読者のことをつい忘れてしまうのが、書き手の常なのである。」
- 理解が説明の前提: 「自分が理解していないことを人に説明することはできない」
- **検証可能な主張**: 「具体例が思い付かなかったら、たいていはその説明はうそである」

**Julia Evans**（`jvns.ca/blog/2026/02/18/man-pages/`、2026年2月の実在記事）— 具体例への渇望: *"I like any man page that has examples... Except for examples, I LOVE examples."* アルファベット順ではなくカテゴリ別の構成が理解を助ける実例（strace man page）。

**Bret Victor「Explorable Explanations」**（`worrydream.com/ExplorableExplanations/`、`[via summarizer]`）— *"By watching the result change as we adjust parameters, we can develop an intuition for the system's behavior."* **重要な限定**: Victor の主張はパラメータを操作できる**インタラクティブな**図に対するものであり、静的な装飾図はこの効果を主張できない。

**Edward Tufte** — 一次引用に到達できず（`edwardtufte.com/tufte/` はホームにリダイレクトされ、"Chartjunk" ノートブック記事本文は未取得）。**引用なしとして扱う。**

AI 文章の具体的な直し方に関する実務家記事は、WebSearch 予算切れのため今回は薄い（下記「先例なし」参照）。

## 3. Measured

**Flesch–Kincaid**（Wikipedia経由、`[via summarizer]`）— Grade Level = 0.39(words/sentences) + 11.8(syllables/words) − 15.59。1975年、US Navy の技術文書可読性評価契約下で J. Peter Kincaid が開発。文の長さ・音節数という変数は、Google/Microsoft の「短く」という定性的助言と同じ変数を最適化している。

**jReadability**（`jreadability.net`、到達確認済み）— 「日本語文章のテキストを入力すると、その難易度を6段階で判定します。」6段階スケールの存在は確認できたが、ページ上に計算式・研究出典の開示はなし。**6段階という事実以上の数字なし。**

**Mayer の多メディア学習認知理論** — 論文の存在（Mayer & Moreno 1998）は Wikipedia の参考文献から確認できたが、coherence／signaling／redundancy／spatial contiguity といった原理名を定義付きで掲載する一次・準一次ページには**6箇所試みて全て到達できず**（Vanderbilt CFT、Cornell CTI、MIT TLL、Queen's、Arkansas、Minnesota、いずれも404/403）。**原理名そのものは `[unverified]` として扱う** — 論文の実在は確認できたが、原理の正確な定義文言は本調査では未検証。効果量の数字は発見できず。

LLM 生成テキストの理解度・信頼・読者疲労に関する研究は、今回未着手（予算切れ、未到達）。

## 4. In the wild

**Vale スタイルハブ**（`vale.sh/hub/`、到達確認済み）— Google: v0.7.1・36 rules・160万DL、"A Vale-compatible implementation of the Google Developer Documentation Style Guide"。Microsoft: v0.15.1・47 rules・80.5万DL。write-good: 8 rules・110万DL。proselint: 34 rules・68.2万DL。（先行調査がカバー済みの alex は繰り返さない。）

**textlint の構造・可読性ルール**（先行調査未カバー分）: `textlint-rule/textlint-rule-sentence-length`（デフォルト最大100文字）、`textlint-ja/textlint-rule-max-ten`（1文あたりの読点を最大3個に制限。引用: 「一文の読点の数が多いと冗長で読みにくい文章となるため、読点の数を一定数以下にするルールです。」）、`textlint-rule/textlint-rule-first-sentence-length`、`IQTLabs/textlint-rule-one-sentence-per-line`。

**図生成ツールの採用**（`gh repo view`、2026-09-22時点の実データ）: Mermaid 90,355 stars（2026-09-21 push）、D2 25,487 stars（2026-09-20 push）、Excalidraw 132,655 stars（2026-09-22 push、本日）。Excalidraw の AI 図生成機能の専用ドキュメントは404で未到達。

**負のエビデンス（AI生成図）**:
- Ask HN「AI Generated Diagrams」（`news.ycombinator.com/item?id=46927101`、2026年2月、日付・URL確認済み）— 直接引用: *"Does anyone genuinely like these diagrams or find them legitimately helpful? I find them way too whimsical... too noisy to be of any use whatsoever, and yet they are increasingly being sprinkled everywhere, in business documents, blog posts, you name it... Do you use these slop diagrams at work?"* — AI生成図が装飾的でノイズという直接的な名指しの苦情。
- John D. Cook「AI-Generated ASCII Diagrams」（`johndcook.com/blog/2026/08/20/ai-generated-ascii-diagrams/`、2026年8月、`[via summarizer]`）— 最初の図は「うまくいった」が、複雑なネットワークでは "the second network is more complicated and so the corresponding ASCII diagram is hard to read" — 図の複雑さに比例した品質劣化という具体的な失敗モード。
- Mermaid の実在するレンダリング破綻バグ（issue #7000, #6236 — 11ノード超のマインドマップ破綻、自己参照クラス図の矢印・ラベル破綻）。

## Q2 の結論 — 理解可能な説明文のチェックリスト（各項目に出典）

1. **最初の一文・段落が主張を述べ、最重要情報を先頭に置く** — Google paragraph-structure「Put the most important information first in a paragraph.」／Microsoft top-10「Get to the point fast. Lead with what's most important.」
2. **1段落=1アイデア、5〜6文以内** — Google paragraph-structure。
3. **見出しは具体的な記述であり、裸のトピックラベルではない**（ただし完全な文である必要はなく、Google は概念見出しに名詞句を許容） — Google headings／Microsoft headings「If readers don't read the headings, they probably won't read the text that follows, either.」
4. **弱い言い回し（"there is/are"）を削る** — Microsoft top-10。
5. **具体例を含む。具体例が浮かばない説明は疑うべき** — 結城浩「具体例が思い付かなかったら、たいていはその説明はうそである」／独立に Julia Evans「Except for examples, I LOVE examples」— 2名の実務家が独立に収束。
6. **書き手自身が理解してから書く（読者向けルールではなく前提条件）** — 結城浩「自分が理解していないことを人に説明することはできない」。
7. **説明文（explanation）は代替案・理由・トレードオフを扱う。何をだけでなくなぜを書く** — Diátaxis「Explanation can and must consider alternatives, counter-examples or multiple different approaches」。この項目は explanation 種別の文書に限定し、how-to/reference/tutorial には適用しない。
8. **説明文は手順書やリファレンスに脱線しない範囲に留める** — Diátaxis「closely bounded」。
9. **声に出して自然に読める。専門語は未定義のまま使わない** — Microsoft top-10「Write like you speak. Read your text aloud.」
10. **条件・状況を指示の前に置く** — Google sentence-structure。
11. **図が「システムの振る舞いの直感」を狙うなら、操作可能でなければならない。静的な図には同じ効果を主張できない** — Bret Victor「By watching the result change as we adjust parameters, we can develop an intuition for the system's behavior.」
12. **図の複雑さには上限がある。表現対象が複雑になりすぎたら図を単純化するか分割する** — John D. Cook の実例観察。
13. **図はメカニズム・関係性を伝える場合のみ挿入する。リストや平叙文への装飾として置かない** — Ask HN の苦情を負の形の根拠として使用（スタイルガイドの積極的規定ではない点に注意）。
14. **文の短さは Flesch-Kincaid 等の指標で機械的に測れる代理指標になる（具体的な目標スコアの規定はどの出典にもなし）** — Flesch-Kincaid 式そのもの。目標数値を発明しないこと。
15. **同一階層の見出しは構文を揃える（parallel structure）** — Microsoft headings。
16. **見出しはセンテンスケース、タイトルケースにしない** — Google highlights／Microsoft top-10。

**発見された矛盾（どちらか一方を選ばない）**:
- Anthropic 自身のドキュメントは、説明的長文には「flowing prose, NEVER... short bullet points」と指示しつつ、自らのドキュメントは XML タグ・表・アコーディオンを多用する。ジャンル依存（説明的散文 vs 機械可読な指示）と解釈すべきで、普遍規則ではない。
- Google の sentence-structure ページは順序規則（条件を先に）を与えるが文の長さの数値上限は与えない。一方 Flesch-Kincaid や Microsoft の「shorter is always better」は長さを主要変数として扱う。**「理解可能」の具体的な文字数上限を与える出典は本調査では見つからなかった** — チェックリストに数値目標を書き込まない。

---

## サマリーテーブル

| source | what they write | where it lives | quality check | numbers | failure modes |
|---|---|---|---|---|---|
| Claude Code memory docs | MEMORY.md索引＋topic files | `~/.claude/projects/<project>/memory/` | agent自身のfile read | 200行/25KB 上限 | 長文化で遵守率低下（自認） |
| GitHub Copilot response-customization | docs/ 参照ルールへの警鐘 | GitHub リポジトリ | — | 数字なし | 外部ファイル参照指示は信頼できないと明言 |
| Notion MCP | ライブ検索・編集ツール | notion.com | — | 数字なし | 永続 agent メモリとしての文書化なし |
| gh: index-as-schema 系（Karpathy Wiki） | query→file ルーティング表 | in-repo Markdown | — | 複数独立リポジトリで収束 | — |
| gh: agent-plugins ID参照問題 | 内部ID参照の破綻報告 | GitHub issue/docs | — | 3失敗モード列挙 | 無関係な決定に静かに解決 |
| gh: "second brain" 系ツール群 | plain markdown + 検索層 | Obsidian vault / git-native | — | 413〜4,574 stars、いずれも2026-09近傍push | ベンダー主張の80%削減は未検証 |
| Awesome-AI-Memory (LoCoMo/LongMemEval) | 会話長期記憶ベンチマーク | 論文/リーダーボード | — | ベンチマーク数値あり | Q1のタスク（ファイル調査記録の想起）とは別タスク |
| Google Developer Documentation Style Guide | 段落・見出し・文構造規則 | developers.google.com | — | 段落5〜6文の目安 | 文の長さ数値上限なし |
| Microsoft Writing Style Guide | 簡潔さ・見出し規則 | learn.microsoft.com（2026-07-06更新） | — | 数字なし | — |
| Diátaxis | explanation種別の固有規律 | diataxis.fr | — | 数字なし | — |
| Anthropic prompting best practices | 散文指示 vs 自己矛盾 | platform.claude.com | — | 数字なし | 自文書内で規則がジャンル依存 |
| Flesch–Kincaid | 可読性スコア式 | 1975年 Navy契約起源 | — | 具体式あり | 目標スコアはどの出典にもなし |
| jReadability | 日本語難易度6段階判定 | jreadability.net | — | 6段階のみ | 算出式非開示 |
| Mayer多メディア学習理論 | 原理名（未確認） | 論文引用のみ確認 | — | 効果量なし | 原理定義の一次ページ6箇所とも未到達 |
| Vale styles hub | Google/Microsoft/write-good等 | vale.sh | — | DL数・ルール数あり | — |
| textlint-rule-max-ten | 読点数で文複雑度を制限 | npm/GitHub | 決定的検出器 | デフォルト上限3個 | — |
| Mermaid/D2/Excalidraw | テキストから図生成 | GitHub | — | 90,355 / 25,487 / 132,655 stars（2026-09時点） | レンダリング破綻issue実在 |
| Ask HN「AI Generated Diagrams」 | 装飾的AI図への苦情 | news.ycombinator.com | — | 2026-02、実URL | 「noisy」「sprinkled everywhere」 |
| John D. Cook ブログ | AI生成図の複雑度劣化観察 | johndcook.com | — | 2026-08、実URL | 複雑ネットワークで可読性低下 |

---

## サブ問ごとの評決

**Q1**: エビデンスが支持するのは、「常時ロードされる小さなインデックス＋オンデマンドで開く本体記録」という二層構造が、ベンダー（Claude Code MEMORY.md）と実務家（独立した7件超のリポジトリの `INDEX.md`/`*-Index.md` パターン）の両方で収束していること。支持しないのは、ディレクトリのみ、あるいはインデックスのみで十分だという主張——両者ともそれぞれの理由（発見可能性の欠如、容量上限）で単独では機能しない。最も強い負のエビデンスは、内部ID参照（`ADR-014` のような番号）がリポジトリを跨ぐと無関係な内容に静かに解決されうるという `windyroad/agent-plugins` の実例で、これは「参照は URL か安定パスで行う」という具体的な設計規則を直接支持する。**欠けているのは**: flat index vs grep vs 埋め込み検索の定量比較（会話メモリのベンチマークはあるがタスクが違う）、および「agent がノートを無視する」ことを論じた名指し実務家のエッセイ（運用ファイルからの代替エビデンスはあるが、エッセイ形式の一次証言ではない）。

**Q2**: 支持されるのは、複数の独立したベンダー・実務家ソースが同じ骨格規則（最重要情報を先頭に、1段落1アイデア、具体例必須、見出しは具体的に）に収束していること。支持されないのは、単一の普遍的な文の長さ上限の存在——Google はあえて数値を与えず、Flesch-Kincaid は測定式のみを提供し、目標値はどの出典にもない。図については、Bret Victor の主張がインタラクティブ性に限定されている点が重要な区別で、静的なAI生成図に「直感を養う」効果を主張する根拠にはならない。Ask HN と John D. Cook の実例は、AI生成図が複雑化するほど、あるいは装飾目的で使われるほど価値を失うという一致した負の方向性を示す。**欠けているのは**: Mayer の原理の正確な定義（論文の実在は確認できたが定義文言に6回到達失敗）、Tufte の一次引用、LLM生成文の理解度・信頼に関する測定研究、AI文章の具体的な直し方を論じた実務家記事（WebSearch予算切れ）。

---

## 先例が見つからなかったもの（no precedent found）

**Q1**:
- Codex 自身の AGENTS.md 発見・優先順位・メモリ機構に関する公式文書（2URL試行、いずれも404）。
- Obsidian 公式の vault構造・MCP連携ドキュメント（local-rest-apiヘルプページ、元URL・リダイレクト先とも404）。
- Simon Willison の TIL を agent が読む具体的ワークフローの一次証言（ホームページのみ到達、about/workflowページ未到達）。
- Andy Matuschak の evergreen notes と AI agent の接続（サイト部分到達、接続自体は未確認）。
- flat index vs grep vs 埋め込み検索 vs MCP検索の定量比較研究（隣接する会話メモリベンチマークLoCoMo/LongMemEvalは実在するが別タスク）。
- 「agentがノートを無視する」と題した名指し実務家のブログ記事（WebSearch予算切れによる未到達）。

**Q2**:
- Edward Tufte の chart junk / data-ink ratio の一次引用（ページタイトルのみ到達、本文未取得）。
- Mayer の coherence/signaling/redundancy/spatial contiguity 原理の定義付き一次・準一次ページ（6URL試行、全て404/403）。
- LLM生成テキストの理解度・信頼・読者疲労に関する研究（未着手、予算切れ）。
- JTF 日本語標準スタイルガイドの内容（2URL試行、404と403）。
- 結城浩「数学文章作法」固有の原則（一般エッセイページのみ到達、書籍固有の記述は未確認）。
- Julia Evans の「説明の仕方」そのものを題材にした記事タイトルでの特定（jvns.ca/blog/のインデックスページが404、個別記事のみ到達）。
- wizardzines.com の執筆哲学の明示的表明（FAQページに記載なし）。
- Excalidraw AI図生成機能の専用ドキュメント（404）。
- AI文章の具体的な直し方を論じる実務家記事（WebSearch予算切れによりこのサブレンズは薄い）。
