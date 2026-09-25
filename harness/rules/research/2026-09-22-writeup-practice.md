---
question: "agentの作業を文書化する慣行(writeup practice)の2026年業界調査 — 何を書きどこに置くか、文章品質/AI臭さ検出、公開先、決定記録とwriteupの分離"
date: 2026-09-22
verdict: "決定的な字面linter(textlint/Vale/textlint-ja preset)は実プロダクトで広く現役採用されている一方、AI文検出器そのものの正確性は誤検知率約20%という負のエビデンスがあり支持されない(natural-japanaseの『検出は機械、判断はAI』の方向性と一致)。公開先は『書く場所と公開する場所を同一ツール内で地続きにする』設計思想がObsidian Publish/Quartzで実在するが、digital-garden系エコシステムの活性度にはばらつきがある。決定記録とwriteupの分離はNygard ADR系の業界標準だが、Kubernetes KEPのように統合という逆方向の先例も存在する。"
unverified:
  - "セッション全体(チャットログ)を丸ごと記事に変換する専用ツール・慣習の広範な実在(gh検索は該当0件、唯一の近似例も1 starの未成熟プロジェクト)"
  - "『生のtranscriptは公開せず、decisionだけ公開する』という立場を明示した名指し実務家の一次発言"
  - "lintで整えた文章の方が読者の理解・信頼度が高いことを示す定量研究"
  - "OpenAI AI Text Classifierの撤退に関する一次ソース(403/404で未到達)"
  - "Amazon 6-pagerの長さ・対象読者に関する一次または信頼できる二次情報"
  - "名指しの日本語実務家によるAI文体検出記事(検索エンジン到達不能)"
  - "Simon Willison・Armin Ronacher・Mitchell Hashimotoによる2026年のagent-assisted writingに関する明示的立場"
  - "claude.ai Artifactリンクの陳腐化・共有不能について外部から書かれた苦情記事"
  - "ADR採用率・ドキュメント実践に関するDORA/SPACEないし学術的なサーベイ数値"
  - "同一リポジトリ内で短いdocs/adrと別の長いdocs/designが両立している実例の確度高い確認"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# agent の作業を文書化する慣行 — 業界調査 2026-09-22

## 方法と検証凡例

- 直接 fetch: `WebFetch` / `curl` でベンダー一次ドキュメント・GitHub raw を取得したもの。無印。
- `[via summarizer]`: WebFetch は取得した HTML を小型モデルで要約してから返す。原文全体ではなく要約結果であることを明示する。
- `[unverified]`: このセッションで一次情報に到達できず、モデルの学習知識に基づく主張。
- `gh`（認証済みアカウント esh2n）で `gh search repos` / `gh search code` / `gh repo view` / `gh api` を使用。
- 到達できなかったソース（403・404・ペイウォール・JS レンダリング・CAPTCHA）は「未到達」と明記する。「見つからない」は「存在しない」ではなく「到達できなかった」を意味する。
- 本調査は 4 本の並列サブエージェント（サブクエスチョン 1〜4 をそれぞれ担当）で実施し、この文書に統合した。セッションの `WebSearch` 予算は 200 回/セッションで、後半に走ったエージェントほど枯渇の影響を受けた（サブクエスチョン 2・4 は途中で予算切れ、DuckDuckGo の代替検索も CAPTCHA で不可）。この制約自体を負のエビデンスの一部として扱い、到達できなかった項目は隠さず「未到達」リストに列挙する。

---

## Part A — ローカルの writeup パイプラインの実態（事実のみ、判断なし）

**入力**: チャットでの直接依頼、または research/design-review/acceptance/deliberate ワークフローが返した Markdown レポート（`--from <md> --kind <kind>` で取り込み、見出し・リスト・表・mermaid エッジを `.wu-*` コンポーネントと diagram IR にマッピング）。

**段階**（`~/.claude/skills/writeup/SKILL.md` 8 ステップ）:
1. 種別（8 kind: 決定記録/設計/調査まとめ/参考資料まとめ/PBI資料/絵解き/作業メモ/議事録）と読者を決定
2. `writeup-kit` の kind 別契約（`references/kinds.md`）を読む
3. **執筆**: `kit/template.html` をコピーし、20 種の役割命名コンポーネント（`wu-*`）で本文を書く。図は IR (YAML) → `render-diagram.mjs` でレンダリングしたもの限定（手描き SVG・絵文字禁止）
4. **lint**: `lint.mjs`（13 検出器、`natural-japanese` スキルと検出器・禁止語辞書を共有。形態素解析器のみ IPADIC/Sudachi で異なる）
5. **self-check**: `self-check.mjs --write-meta`、exit 0 必須。`<meta name="checks">` に lint/diagram/self-check の状態を記録
6. **保存**: `$STORE/<folder>/<date>-<slug>.html`、store ごとの git リポジトリにコミット
7. **build**: `build.mjs` がシンタックスハイライト・diff テーブル等を後付けレンダリング
8. パス報告、要求時のみ publish

**publish 先**: `--to file|github|artifact|cloudflare|yoki-artifact`。store 内ページは `../_kit/writeup.css` に依存するためそのまま持ち出せず、必ず `publish.mjs` を通す（CSS インライン化・画像埋め込み・非公開ワード検査 exit 4）。GitHub 宛のみフォルダ出力＋`gh pr create --attach`。

**ルールの所在**: 文章のルールは `writeup-kit/references/writing.md`（一文一義・見出し=メッセージ等）と `natural-japanese` スキルの「文体憲法」12 箇条（`references/writing-constitution.md`）。AI 臭検出は `natural-japanese` が担い、13 検出器（禁止語・翻訳調・反復・文長均質性・体言止め率・段落頭接続詞率・語彙多様性・英語統語疑い等）を lint.mjs/lint.py 両実装で共有。設計思想は「検出は機械、判断はAI」（機械が決定的に疑いを検出し、直すかどうかは文脈でAIが判断）。EXPERIMENTAL な意味的検出（`semantic.py`、文埋め込み）は opt-in。

**ストア実態**（読み取り専用調査、内容は見ていない）:
- `~/.local/share/writeup/{work,private}` は各々独立 git リポジトリ（`stores.toml` に登録、`default = "private"`）
- `.html` ファイル数: 全体で 103（本体ページ＋ `.publish/*.artifact.html` コピー＋アセット）。`manifest.json` 上のページ件数は private 26 件・work 26 件（計 52 ページ）
- コミット数: private 74、work 65
- 最終更新: private は 2026-08-30〜2026-09-22（本日まで継続）、work は 2026-08-30〜2026-09-13
- フォルダはトピック単位（例: private 配下に `yoki`, `yoki-rebuild`, `network`, `harness`, `minecraft`, `local-llm` 等）

**決定記録システム**（`domains/dev/llm/harness/rules/decisions/`、writeup とは別系統）: リポジトリ内 Markdown のみ（HTML 化しない）、ファイル名 `YYYY-MM-DD-topic.md`、必須見出し `Status / Problem / Decision / Alternatives considered / Consequences / Sources`。索引ファイルなし（ディレクトリ一覧が索引）。運用ルール: 採択後は書き換えず新メモで上書き（`superseded by`）、行動拘束は生成される AGENTS.md への太字一行+リンクとして反映、機械検査可能な決定は同一コミットで `guard-rules.json` か lint に変換。**「HTML のページ（writeup、Artifact）は人間向けの投影であって、元ではない。エージェントは読まない」**と明記（`README.md`）。現在 11 件の決定メモが存在（2026-09-22 に集中して作成）。

---

## Part B — 四つの視点で見た調査結果

### 1. 何を書き、どこに置くか

**vendors**
- Claude Code 公式ベストプラクティス（[code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)、直接取得）には、セッション結果・調査・決定を「恒久文書として書き出す」ガイダンスが**存在しない**。内容の中心はコンテキスト管理（`/clear`・compaction）、CLAUDE.md の書き方、サブエージェントへの調査委任、`/batch` による大規模並列移行、非対話モード。唯一「文書化」寄りの記述は、大機能実装前にユーザーをインタビューして `SPEC.md` を書かせる手順で、引用: *"The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step that proves the feature works."* — これは実装前の仕様書であり、セッション後の記録ではない。
- `/batch` は実在するコマンド（5〜30 サブエージェントへの fan-out、各自 worktree で PR を作成）。**PR 自体が恒久成果物**であり、別途「書き上げレポート」を作る工程はない。
- GitHub Copilot の PR 要約機能（[docs.github.com](https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-for-pull-requests)、直接取得）: *"GitHub Copilot can summarize a pull request in the description field or as a comment, helping reviewers quickly understand what changed."* ただし自ら精度に留保: *"GitHub Copilot does not take into account any existing content in the pull request description, so start with a blank description for best results."* / *"Review the generated summary carefully."*
- Claude.ai Artifacts の共有（[support.claude.com](https://support.claude.com/en/articles/9487310-can-i-share-my-claude-ai-artifacts-with-others)、[via summarizer]）: 既定は非公開 *"By default, artifacts in Claude Code are visible only to the person who created them."* **永続化は publish 後のみ**: *"Persistent storage is only available for published artifacts."* さらに *"Unpublishing an artifact permanently deletes all associated storage data."*
- Notion AI（[notion.com/product/ai](https://www.notion.com/product/ai)、[via summarizer]）: *"Capture every detail and actionable summaries, right where you work"* / *"Automate your meeting notes and follow-ups, no bot needed"* — アンビエントな取り込み＋要約が主眼で、ADR のような判断の規律ではない。
- Simon Willison のブログで「Claude Cowork」統合の発表（2026-09-16）への言及を確認したが、Anthropic 自身の一次ドキュメントには到達できず **[unverified]**。OpenAI Codex cloud のタスク要約、ChatGPT canvas/docs、Linear AI の一次文書は今回未到達（「見つからない」ではなく「未到達」）。

**practitioners**
- Michael Nygard「Documenting Architecture Decisions」（2011、[cognitect.com](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)）: ADR の直接の起源。引用: *"We will keep a collection of records for 'architecturally significant' decisions... The whole document should be one or two pages long."* / *"We will write each ADR as if it is a conversation with a future developer."*
- [adr.github.io](https://adr.github.io/)（[via summarizer]）: ADR は Architectural Knowledge Management の下で「決定ログ」を構成すると位置づけ、Nygard の散文形式に加えて Y-statement（Zdun et al.）という代替フォーマットにも言及。
- Simon Willison のブログトップ（[simonwillison.net](https://simonwillison.net/)、[via summarizer]）: 2026年9月時点で Claude／コーディングエージェントの作業について毎日ブログを書いていることは確認できる（例: 9/11「Claude production code standards」）。別サイトの [til.simonwillison.net](https://til.simonwillison.net/) への導線もある。ただし「セッション→ブログ変換」を明示的に語る特定記事は今回**特定できず [unverified]**（該当と思われた URL は 404）。
- Armin Ronacher・Mitchell Hashimoto の 2026 年時点の関連記述は今回未到達。
- 「生の transcript は公開せず、決定だけを公開する」という立場を明示的に述べた**名指しの実務家の引用は見つからなかった**。これはローカルの決定記録システム自身の方針（「HTML のページは人間向けの投影であって、元ではない」）と一致する方向性ではあるが、外部からの独立した裏付けにはなっていない。

**measured**
- ADR 採用率調査、DORA/SPACE のドキュメント実践に関する具体的知見は**今回のセッションでは 1 件も発見できず**。「数字なし」。

**in the wild**（`gh search`、認証済み）
- `docs/decisions` / `docs/adr` は、2026 年の AI コーディングツール向けスキャフォールディングで急速に採用が広がっている命名規約。例: `colabcolibri/meridian`（"Document-driven project governance for AI-assisted development"、4 stars）、`joestump/claude-plugin-sdd`（"ADRs, OpenSpec specs... for Claude Code"、32 stars、本日更新）、`ejklock/living-docs-skill`（"Works with Claude Code, Cursor, Copilot, OpenCode & Pi"、13 stars）。星数は小さいが、独立した複数の試みが同じパターン（ADR ディレクトリ＋AI エージェント skill）に収束している。
- `repowise-dev/repowise`（6,866 stars、本日更新）が突出: "Codebase intelligence for AI and humans: code health scores, auto-generated docs, git analytics, dead code detection, and architectural decisions via MCP" — AI＋決定記録を組み合わせた最も採用の大きいツール。
- **確立済みの ADR 専用ツールは停滞している**: `npryce/adr-tools`（5,700 stars）— 実コードの最終プッシュは 2024-04-25、未解決 issue 69 件。`thomvaill/log4brains`（1,593 stars）— 最終プッシュ 2024-12-17、未解決 issue 57 件。アーカイブはされていないが、2026 年の AI エージェント界隈は既存ツールを拡張せず、新規にゼロから ADR 隣接ツールを作り続けている——これは負／停滞のエビデンスとして扱える。
- 「セッションをそのまま記事に変換する」ツールは事実上存在しない: `gh search repos "session to blog"` / `"chatlog to article"` は**いずれも 0 件**。`jesgarram/verbatim`（"Transcript-to-blog pipeline for Claude Code. Edits instead of writes."、1 star、2026-04-06 プッシュ）が最も近い直接の類似例だが、非常に未成熟。「transcript to markdown」で見つかる他のリポジトリも `wassimk/granary`（5 stars, 2026-07-30）、`jerrison/transcript-to-markdown`（0 stars, 2026-05-29）など小規模個人開発に留まる。
- `gh search code path:docs/adr` は `mozilla-services/socorro`、`CERTCC/SSVC`、`theupdateframework/python-tuf`、`hmrc/accessibility-statement-frontend` など実プロダクトで即座に多数ヒット——決定記録ディレクトリという慣習自体は広く実践されている。
- 「AI 生成ドキュメントはノイズ」という明示的な苦情スレッドは、今回の `gh search issues` では発見できなかった（検索到達範囲の限界であり、存在しないことの証明ではない）。

---

### 2. 文章品質と「AI臭さ」検出

**vendors**
- Anthropic の「Claude の文体」専用ページ、OpenAI のシステムプロンプト文体ガイダンス公開ページには今回到達できなかった（403 または未発見）。
- GitHub Copilot の PR 要約に対する自己留保（上記セクション 1 で引用済み: 「まず空欄から始めよ」「必ず注意深くレビューせよ」）は、ベンダー自身が AI 生成文への不信を暗に認めている例として扱える。

**practitioners / 実在するツール生態系**（すべて `gh repo view` で確認、2026-09-22 時点）
- textlint 本体: 3,191 stars、最終プッシュ 2026-09-22（本日、活発）。[github.com/textlint/textlint](https://github.com/textlint/textlint)
- textlint-rule-preset-ja-technical-writing: 555 stars、最終プッシュ 2026-09-20（活発）。[github.com/textlint-ja/textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing)
- Vale: 6,135 stars、最終プッシュ 2026-09-19（活発）。[github.com/errata-ai/vale](https://github.com/errata-ai/vale)
- proselint: 4,576 stars、最終プッシュ 2026-09-04（活発）。[github.com/amperser/proselint](https://github.com/amperser/proselint)
- alex（get-alex/alex、包摂的文章チェッカ）: 5,102 stars だが最終プッシュは **2024-11-27**（約1年10か月停滞）。アーカイブ宣言は確認できていないが、実質的なメンテナンス低下の弱い兆候。[github.com/get-alex/alex](https://github.com/get-alex/alex)
- 検出ツールと並行して「AI文章を人間らしく見せかける」回避スキルも実在（`sergebulaev/linkedin-skills` の `skills/linkedin-humanizer/references/detector-list.md`）——検出と回避のいたちごっこが実際に起きている一次的な状況証拠。
- 名指しの日本語実務家（note.com/Zenn）による「AI文体検出」記事は、検索経路が塞がれ（DuckDuckGo CAPTCHA、Zenn トピックページはリスティング不可）今回**未到達**。

**measured**
- AI 文検出器（GPTZero 等）の誤検知: Futurism の報道 [via summarizer、一次記事 URL 未確定] によれば「教員がツールに依存すると無実の学生の約20%を誤って不正行為で告発することになる」との報告。Washington Post も同様の誤検知リスクを指摘。
- メリーランド大学の 2023年3月論文「Can AI-Generated Text be Reliably Detected?」は「複数の AI 文検出器は実運用シナリオで信頼できない」と結論 [via summarizer、原論文 URL 未確認]。
- OpenAI 自身の AI Text Classifier が低精度を理由に撤退したという経緯: 今回のセッションでは一次ソース（openai.com、help.openai.com）に到達できなかった（403/404）。この事実自体は **[unverified: model knowledge]** として扱う——独立に検証できていない。
- 「lint による書き換えが読者の理解・信頼を向上させる」という定量エビデンスは**発見できず**。「数字なし」。

**in the wild**
- `.textlintrc` の実採用（`gh search code filename:.textlintrc`）: `hoodiehq/hoodie`、`FerretDB/FerretDB`、`reviewdog/reviewdog`、`js-primer/js-primer`（日本語技術書）、`dunwu/linux-tutorial` など、実プロダクト・技術文書リポジトリで確認。
- `.vale.ini` の実採用: `getpelican/pelican`、`discord/discord-api-docs`（Discord 公式 API ドキュメント）、`ViewComponent/view_component`、`telepresenceio/telepresence`、`Velocidex/velociraptor` — 企業の公式 API ドキュメントでの採用が目立つ。
- alex の1年10か月の停滞は弱いメンテナンス低下シグナル（deprecation 宣言は未確認、issue の個別精査はしていない）。

---

### 3. 公開先（publishing surface）

**vendors**
- Claude.ai Artifacts の共有モデル（セクション 1 で引用済み）: 既定非公開、publish 後のみ永続化、unpublish で完全削除。
- Obsidian Publish（[obsidian.md/publish](https://obsidian.md/publish)、[via summarizer]）: *"Publish is built into Obsidian so you can write, collaborate, and publish seamlessly"* / *"Make your changes public in just a few taps"* — 「書く場所」と「公開する場所」を同一アプリ内で地続きにする設計思想の一次的な表明。ただし今回の取得では「非公開でまず貯めて後で選んで公開する」という文言そのものまでは確認できていない。
- Notion の公開ページ機能、その他の一次ドキュメントは今回未到達。

**practitioners**
- Andy Matuschak のノートサイトや「デジタルガーデン」実践者による比較記事は今回未到達（検索経路が塞がれ深掘りできず）。

**measured**
- 「数字なし」。GitHub Pages/Notion/Obsidian Publish の利用シェア調査等は本セッションでは未発見。

**in the wild**
- Quartz（digital-garden 用静的サイトジェネレータ）: 13,278 stars、最終プッシュ 2026-09-20（非常に活発）。[github.com/jackyzha0/quartz](https://github.com/jackyzha0/quartz)
- digital-garden 系リポジトリの活性度はばらつく: `oleeskild/obsidian-digital-garden`（2,504 stars、2026-09-11、活発）、`maximevaillancourt/digital-garden-jekyll-template`（1,282 stars、2025-12-01 以降停滞）、`MaggieAppleton/digital-gardeners`（4,805 stars、2024-06-22 以降 2年以上停滞——情報収集ハブとしては陳腐化）、`TuanManhCao/digital-garden`（Obsidian Publish 代替、815 stars、2023-12-22 以降停滞）。
- 「私有ファーストで貯めてから公開を選ぶ」モデルの直接的な先例としては Obsidian Publish＋digital-garden エコシステムが最も近いが、Quartz 以外は活性度にばらつきがあり、エコシステム全体としては成熟しきっていない。
- Artifact リンクの陳腐化・共有不能について外部から書かれた苦情記事は今回発見できなかった（未検証）。ただしセクション1で引用した Claude 公式文書自体が「unpublish で完全削除」「publish 前は永続化されない」という構造的な脆さを**公式に認めている**——これは外部の苦情がなくとも、一次情報として負のエビデンスに数えてよい。
- **本項目は他の3項目と比べて調査エージェントの WebSearch 予算が枯渇した状態で実施されたため、カバレッジが薄い。** 静的サイト＋エージェント生成コンテンツの具体的な実例リポジトリ、Notion/GitHub Discussions を writeup 先に使う実務家の実例は今回発見できなかった（探索不足、存在しないことの証明ではない）。

---

### 4. 決定記録と writeup の分離

**フォーマット仕様自身の言明**（このサブ問で最も重要な一次情報）

- **Michael Nygard の原典**（[cognitect.com](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)、[via summarizer]）: 長さ = *"The whole document should be one or two pages long."* 読者 = *"We will write each ADR as if it is a conversation with a future developer."* 内容規律 = *"All consequences should be listed here, not just the 'positive' ones."* / *"Bullets are acceptable only for visual style, not as an excuse for writing sentence fragments."*
- **adr-tools README**（[github.com/npryce/adr-tools](https://raw.githubusercontent.com/npryce/adr-tools/master/README.md)、[via summarizer]）: 独自の長さ・読者ガイダンスは無く、Nygard の記事を権威として参照するのみ——スコープを継承するだけで拡張はしていない。
- **MADR**（[adr.github.io/madr](https://adr.github.io/madr/) とその[テンプレート](https://raw.githubusercontent.com/adr/madr/main/template/adr-template.md)、[via summarizer]）: 明示的なページ数上限はないが、文脈・問題文は *"two to three sentences or in the form of an illustrative story"* と指示——セクション単位での簡潔さを課す。Title/Context/Decision Outcome 以外のほぼ全セクションが *"This is an optional element. Feel free to remove"* と明記され、既定で最小構成。スコープの定義: *"An Architectural Decision (AD) is a software design choice that addresses a functional or non-functional requirement that is architecturally significant"*、かつ「architecture」を過度に厳密に解釈しないよう警告。
- **log4brains README**（[github.com/thomvaill/log4brains](https://raw.githubusercontent.com/thomvaill/log4brains/master/README.md)、[via summarizer]）: *"a very concise template to record functional or non-functional 'architecturally significant' decisions in a lightweight format like markdown"* — ADR を「生きた・時系列の記録」として明示的に、より充実した技術文書（"up-to-date technical documentation and training material"）とは別物として位置づける。**このサブ問において「短い決定記録と長い説明文書を分ける」ことを最も明確にベンダー側から言明している一次情報。**
- **Rust RFC プロセス**（[README](https://raw.githubusercontent.com/rust-lang/rfcs/master/README.md)、[via summarizer]）: 明示的な長さの規定はないが、実質を求める: *"RFCs that do not present convincing motivation, demonstrate lack of understanding of the design's impact, or are disingenuous about the drawbacks or alternatives tend to be poorly-received."* 読者は Rust/Cargo/Crates.io の長期メンテナ。軽微な変更は RFC 不要と運用上区別。
- **Python PEP 1**（[peps.python.org/pep-0001](https://peps.python.org/pep-0001/)、[via summarizer]）: 15 の名前付きセクションを持つ明示的な構造（Abstract/Motivation/Specification/Rationale/Backwards Compatibility/Rejected Ideas 等）。Abstract 自体には長さ上限: *"a short (~200 word) description of the technical issue being addressed."* 読者 = *"core developers of the CPython reference interpreter and their elected Steering Council, as well as developers of other implementations."*
- **Kubernetes KEP テンプレート**（[raw template](https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/NNNN-kep-template/README.md)、[via summarizer]）: ADR とは**逆方向**——「決定＋進捗管理＋製品要件＋設計を意図的に 1 ファイルへ統合」する設計。サマリーの長さは *"A good summary is probably at least a paragraph in length"* と、最小ではなく一定のボリュームを促す。反復拡張を推奨: *"Avoid getting hung up on specific details and instead aim to get the goals of the KEP clarified and merged quickly ... with details filled out incrementally in subsequent PRs."* 各 SIG が自分の閾値を決めてよく、明示的な文字数上限はない。**「分離が唯一の業界標準ではない」ことを示す最も明確な反証。**
- **Amazon 6-pager**: 今回のセッションでは一次・安定した二次ソースいずれにも到達できなかった（`aboutamazon.com`、`bringthedonuts.com`、First Round Review、LinkedIn 転載、Bing/DuckDuckGo 検索いずれも失敗、WebSearch は予算切れ）。広く語られる「箇条書きなし・6ページの物語形式メモ」という主張は**このセッションでは独立に検証できていない [unverified / 未到達]**——事実として扱わない。

**practitioners**
- 「なぜ決定記録と writeup を分けるか／統合するか」を明示的に論じる 2026 年の記事は、WebSearch 予算切れのため今回探索できなかった（未探索、否定的結論ではない）。

**measured**
- ADR 採用率、ドキュメント長と有用性の相関に関する実証研究は、今回チェックした一次資料（Nygard・adr-tools・MADR・log4brains・Rust RFC・PEP 1・KEP テンプレート）のいずれにも存在しない。これは検索の失敗ではなく、全て直接読んだ上での**確認された不在**。

**in the wild**
- `gh search code "path:docs/adr filename:0001"` / `"path:docs/decisions filename:0001"` はいずれも 0 件——GitHub コード検索の `path:` 修飾子が期待どおりに機能していない可能性があり、二層構造（短い ADR ディレクトリ＋別の長い設計文書ディレクトリが同一リポジトリに同居）の実例を確度高く確認することはできなかった。`home-assistant/operating-system`（`docs/adr` を持つ活発なプロジェクト）や `mattpocock/skills`（"docs: Add ADR explanation to README.md" という 2026-05-06 の issue あり）は候補だが、二層構造そのものは未検証。**探索ツールの限界による不確定であり、パターンが存在しないという意味ではない。**
- ADR が「冗長になりすぎた」「短すぎて役に立たなくなった」という苦情スレッドは、今回の `gh search issues` では見つからなかった（ノイズのみヒット）。存在しないと断定はできない——検索到達範囲の限界。

---

## サマリーテーブル

| source | what they write | where it lives | quality check | numbers | failure modes |
|---|---|---|---|---|---|
| Claude Code best-practices docs | セッション運用ガイド（仕様書 SPEC.md 止まり） | リポジトリ内 or ローカル | Claude 自身の verification loop | 数字なし | 恒久文書化の言及自体が無い |
| GitHub Copilot PR 要約 | PR 説明文 | GitHub PR | 「必ずレビューせよ」と自ら警告 | 数字なし | 既存本文を無視する既知の欠陥 |
| Claude.ai Artifacts | HTML 成果物の共有 URL | claude.ai（publish 後のみ永続） | — | 数字なし | unpublish で完全削除、publish 前は非永続 |
| Nygard ADR | 決定（Context/Decision/Status/Consequences） | in-repo Markdown | 人間レビュー | "1〜2 ページ" | — |
| adr-tools | ADR ストレージ CLI | in-repo Markdown | Nygard に依存 | 独自基準なし | メンテ停滞（最終コード変更 2024-04） |
| MADR 4.0.0 | 決定（緩いスコープ、任意セクション多数） | in-repo Markdown, versioned | — | 文脈は"2〜3文" | — |
| log4brains | 決定の「生きた時系列記録」 | in-repo Markdown、Web UI 生成 | — | — | メンテ停滞（最終プッシュ 2024-12） |
| Rust RFC | 実質的な言語変更提案 | GitHub リポジトリ | サブチーム審査 | 軽微変更は対象外と明記 | 説得力不足の RFC は "poorly-received" |
| PEP 1 | Python 全体の設計文書 | peps.python.org | Steering Council 合意 | Abstract 約200語上限 | — |
| Kubernetes KEP | 決定＋進捗＋要件＋設計を1ファイルに統合 | GitHub リポジトリ | SIG ごとに閾値を自己決定 | 明示的文字数上限なし | 各 SIG の運用にムラ |
| GPTZero 等 AI 文検出器 | — | — | Futurism実測・メリーランド大2023論文 | 誤検知率 約20%（無実の学生の） | 「実運用で信頼できない」と結論 |
| textlint / textlint-ja preset | 日本語技術文書の lint | npm, リポジトリ内設定 | 決定的検出器 | 3,191 / 555 stars、いずれも2026-09の直近プッシュ | — |
| Vale | 汎用文体 linter | リポジトリ内設定 | 決定的検出器 | 6,135 stars、2026-09-19 プッシュ | — |
| alex | 包摂的文章チェッカ | リポジトリ内設定 | 決定的検出器 | 5,102 stars、最終プッシュ 2024-11-27（停滞） | メンテナンス停滞の弱い兆候 |
| Obsidian Publish | 私有ノート→選択公開 | obsidian.md（vault内→公開） | — | 数字なし | 「後で選んで公開」文言は未確認 |
| Quartz | digital garden 静的サイト生成 | GitHub Pages 等 | — | 13,278 stars、2026-09-20 プッシュ | — |
| digital-garden 系（その他） | 同上 | 同上 | — | 815〜4,805 stars、多くが2023〜2025で停滞 | エコシステムの陳腐化 |
| gh: transcript-to-markdown系 | チャット→記事変換 | 個人リポジトリ | — | 0〜6 stars | 「session-to-blog」市場自体が検索語として0件 |
| gh: docs/adr 採用例 | 決定記録の実践 | 多数の実プロダクトリポジトリ | — | 8件超即座ヒット（氷山の一角） | — |
| repowise-dev/repowise | AI＋人間向けコード健全性・ADR等 | MCP 経由 | — | 6,866 stars、本日更新 | — |

---

## サブ問ごとの評決

1. **何を書き、どこに置くか** — エビデンスが支持するのは、ADR 的な短い決定記録を in-repo に置く慣習が広く実在し、2026 年には AI エージェント向けスキャフォールディングとして独立に量産されていること（`docs/adr` は実例豊富、低スター多数の独立した収束）。支持しないのは「セッション全体を1本の記事に変換する」市場の存在——`gh search repos` で "session to blog" は 0 件、"transcript to markdown" も小規模個人リポジトリのみ。Claude Code 自身の公式ベストプラクティスも、セッション結果を恒久文書に変換する工程を推奨していない（SPEC.md 止まり、PR が最終成果物）。**欠けている**のは Simon Willison ら名指し実務家の「セッション→ブログ」ワークフローの一次証言、および「transcript は非公開、decision は公開」という立場の外部裏付け。
2. **文章品質と AI 臭さ検出** — 支持されるのは「決定的な字面 linter（textlint/Vale/textlint-ja preset）は実プロダクトで広く現役採用されている」こと（Discord 公式 API ドキュメント含む）。支持されないのは「AI 文検出器そのものが正確である」こと——誤検知率約20%という具体的な負のエビデンスがある。この非対称性（決定的 linter は機能する、AI-vs-AI 判定は機能しない）は、ローカルの `natural-japanese` の「検出は機械、判断はAI」という設計と方向が一致する。**欠けている**のは「lint がAI臭さの除去に効く」という定量的な読者側エビデンス、および名指しの日本語実務家による一次情報。
3. **公開先** — 支持されるのは「書く場所と公開する場所を同一ツール内で地続きにする」設計思想の実在（Obsidian Publish, Quartz）。支持されないのは、そのエコシステムが均質に活発であること——digital-garden 系リポジトリの多くが2023〜2025年で更新停止。「私有ファースト」モデルの最も強い一次証拠は、皮肉にも claude.ai Artifacts 自身の仕様（publish前は非永続、unpublish で完全削除）——設計思想の先例というより、構造的な脆さの公式な告白として読める。**この項目は調査予算の制約で他の3項目よりカバレッジが薄い**——実務家の実例、GitHub Discussions/Notion を writeup 先に使う具体例は未発見（探索不足）。
4. **決定記録と writeup の分離** — フォーマット仕様のうち Nygard ADR・adr-tools・MADR・log4brains・Rust RFC・PEP は明確に「短い決定」と「長い説明」を別物として扱う設計（log4brains が最も明示的にこれを言明）。一方 Kubernetes KEP は唯一「決定＋進捗＋要件＋設計を意図的に1ファイルへ統合する」という**逆方向の先例**を提供する——分離が唯一の業界標準ではなく、統合という選択肢にも実例がある。Amazon 6-pager は今回未検証のため判断材料にできない。

---

## 先例が見つからなかったもの（no precedent found）

- 「セッション全体（チャットログ）を丸ごと記事に変換する」専用ツール・慣習の広範な実在（`gh search repos` は "session to blog" 0件、"chatlog to article" 0件。唯一の近似例 `jesgarram/verbatim` も 1 star の未成熟プロジェクト）。
- 「生の transcript は公開せず、decision だけ公開する」という立場を明示した名指し実務家の一次発言。
- 「lint で整えた文章の方が読者の理解・信頼度が高い」ことを示す定量研究。
- OpenAI AI Text Classifier の撤退に関する一次ソース（今回のセッションでは403/404で未到達。事実自体は `[unverified: model knowledge]`）。
- Amazon 6-pager の長さ・対象読者に関する一次または信頼できる二次情報（接続失敗、WebSearch予算切れ）。
- 名指しの日本語実務家（note.com/Zenn）による「AI文体検出」記事（検索エンジン到達不能のため）。
- Simon Willison・Armin Ronacher・Mitchell Hashimoto による2026年の agent-assisted writing に関する明示的立場（URL未到達/WebSearch不可）。
- claude.ai Artifact リンクの陳腐化・共有不能について外部から書かれた苦情記事。
- ADR 採用率・ドキュメント実践に関する DORA/SPACE ないし学術的なサーベイ数値。
- 静的サイト＋エージェント生成コンテンツの具体的な実例リポジトリ（3〜5件の収集目標を達成できず）。
- 同一リポジトリ内で短い `docs/adr` と別の長い `docs/design` が両立している実例の確度高い確認（`gh search code` の `path:` 修飾子が機能せず、候補止まり）。
- ADR が冗長化・空洞化したという苦情スレッド（検索到達範囲の限界）。
