---
question: "2026年の「エージェント編集完了→PR起票」間の品質ゲート実務: 個人ハーネスの preflight ワークフロー(fan-out review→judge screening→auto-apply→lint/build gate)を維持するか、harness-native機能に置き換えるか"
date: 2026-09-22
verdict: "fan-out review・judge screening・lint/build gateの分離は自動化として維持を支持する証拠が強く、無条件auto-applyやセッション内confirmationのみへの置き換えは測定上支持されない — 独立ワークフロー(CCR相当)の設計が精度上優位"
unverified:
  - "Google/Meta/Microsoftなど大手の社内AIレビュー運用に関する公開論文・数値"
  - "content-hash markerによる冪等性チェックを論じた一次資料"
  - "critを実CI/pre-PRワークフローに組み込んだ公開リポジトリの採用実例"
  - "fan-out(multi-agent)であること単独の効果をsingle-agentと比較統制した研究"
  - "Cursor Bugbotのauto-fix(見つけたら即push)が事故を起こした/起こさなかったことを示す定量データ"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 2026年の「エージェント編集完了→PR起票」の間の品質ゲート実務

**決定対象**: 個人ハーネスの `preflight` ワークフロー(Collect diff → fan-out AI review → judge screens findings → auto-apply accepted fixes → lint/build gate → content-hash marker)を維持するか、harness-native機能(`/code-review` → セッション内修正 → Stop-hook typecheck/lint → crit diff check → push)に置き換えるか、あるいは作り直すか。

調査日: 2026-09-22。WebSearchはセッション予算切れで使用不可(実測、後述)。WebFetch・curl(arXiv API, HN Algolia API)・認証済み`gh`で代替。

## 方法と検証凡例

- **直接取得(verbatim引用可)**: WebFetchで取得しモデルが要約した内容(Claude/Codex/Copilot/CodeRabbit/Cursor/Sourcery/Qodo各docs、Simon Willisonブログ、arXiv abstract、HNコメント、GitHub issue本文)。WebFetchは「AI要約」を返す設計のため、厳密な逐語引用は元ページの引用符付き文のみを正とする。
- **`curl`直接取得**: arXiv APIのXML(生データ)、HN Algolia API(生JSON)、`gh api`/`gh issue view`(生JSON) — これらは要約を介さない一次データ。
- **未到達**: Graphite Diamondの効果数値ページ(ブログ一覧のみ取得、個別記事は未取得)。Qodo Benchmarkの具体的なprecision/recall数値(ページはHugging Faceへの誘導のみで数値非表示)。
- **WebSearch**: 試行したが「this session has used its web search budget (200 of 200)」で拒否された。これは調査対象の前提(WebSearchが使えない状況)を裏付ける実測結果であり、以降は全てWebFetch/curl/ghで代替した。

---

## 1. Vendors(各社が出荷している機能と、その一次docsの文言)

### Claude Code — `/code-review`, `/verify`, `/batch`, Code Review GitHub app

一次資料: https://code.claude.com/docs/en/code-review.md, https://code.claude.com/docs/en/best-practices.md

- **PR時(マネージド)**: Code ReviewはGitHub Appとして「複数のエージェントがdiffと周辺コードを並列に解析し、各エージェントが異なる種類の問題を探す。その後、verificationステップが候補を実際のコード挙動と照合して偽陽性を除去する」— 原文: *"When a review runs, multiple agents analyze the diff and surrounding code in parallel on Anthropic infrastructure... a verification step checks candidates against actual code behavior to filter out false positives."* これは**preflightのfan-out+judgeとほぼ同型の設計**をベンダーが公式PR-time機能として実装していることを意味する。
- **PR承認をブロックしない設計**: *"Findings are tagged by severity and don't approve or block your PR, so existing review workflows stay intact."* チェックランも常にneutral結論。
- **ローカル/事前PR**: `/code-review`(旧`/review`のエイリアス)はターミナルでdiffをレビューし、`--fix`で「reviewの後に作業ツリーへ所見を適用」、`--comment`でPR/MRにインラインコメント投稿。**auto-applyはオプトイン**(`--fix`を渡した場合のみ)であり、デフォルトでは「Claudeに直してもらうよう頼む」人間判断を挟む設計。
- **重要な仕様**: `/code-review`はv2.1.218以降「forked subagentとして」バックグラウンド実行される — つまり**同一セッションの派生**であり、完全に独立したセッション(cross-context)ではない。この区別は下記Measuredレンズの結果と直結する。
- **公式ベストプラクティス「Add an adversarial review step」**: *"A reviewer running in a fresh subagent context sees only the diff and the criteria you give it, not the reasoning that produced the change, so it evaluates the result on its own terms."* さらに *"A reviewer prompted to find gaps will usually report some, even when the work is sound... Chasing every finding leads to over-engineering... Tell the reviewer to flag only gaps that affect correctness."* — **ベンダー自身が「何でも直すな、判定基準を絞れ」と明言**している。これはpreflightの「judge screens findings」の設計思想を支持する一次資料。
- **検証の段階付け(ベンダー推奨)**: プロンプト内完結 → `/goal`条件 → **Stop hookによる決定論的ゲート**(「Claude Code overrides the hook and ends the turn after 8 consecutive blocks」)→ 独立レビューア(subagent/second opinion)。提案されている置き換え案の「Stop-hook typecheck/lint」はこの4段階のうち3番目に正確に合致し、ベンダー自身の推奨パターンと一致する。
- **料金**: PR時マネージドレビューはレビュー1回あたり$15–25、プランの included usage 外で課金。ローカル`/code-review`は無料(セッションのモデル利用に含まれる)。

### Codex(OpenAI) — `/review`, cloud review

一次資料: https://learn.chatgpt.com/docs/codex/cli (developers.openai.com/codex/cliから308リダイレクト)

- ローカル`/review`: *"Run a dedicated review against uncommitted changes, a commit, or a base branch. Codex reports prioritized findings without modifying your working tree, so you can address risks before you commit or open a pull request."* — **デフォルトで作業ツリーを変更しない**(Claude Codeの`--fix`オプトインと同じ方向性、さらに一歩保守的)。
- auto-fix: ドキュメントに明記なし。所見を出すだけで、適用は人間/別コマンドに委ねる設計と読める。
- クラウドレビューあり(`codex cloud`)だが詳細な検証パス記述は本文からは確認できず。

### GitHub Copilot code review

一次資料(WebFetch要約): https://docs.github.com/en/copilot/using-github-copilot/code-review/using-copilot-code-review

- 基本はPR時。ただしローカルIDE(VS Code/Visual Studio/JetBrains/Xcode)でコミット前の変更もレビュー可能。
- auto-fix: 提案は出すが自動適用はしない。*"Where possible, Copilot's feedback includes suggested changes which you can apply with a couple of clicks."* クラウドエージェントで"Fix with Copilot"はあるが人間のボタン操作が起点。
- 承認判定(approve可否のassessment)はデフォルトoff。
- プランゲート: Copilotライセンス無しユーザーでも組織/enterprise管理者が有効化すれば使える(ライセンス必須ではない)。

### CodeRabbit

一次資料(WebFetch要約): https://docs.coderabbit.ai/, https://docs.coderabbit.ai/cli

- **CLIでpre-commit/pre-PRレビューをうたう唯一級の存在**: *"Get AI code reviews directly in your CLI before you commit."*
- auto-fix: なし。所見+修正ガイダンスを出し、*"Apply the change in your editor, or pass structured findings to your AI coding agent to implement it."*
- **verification passを明示的に推奨**: *"Once those changes are implemented, run cr --agent one more time to make sure we addressed all the critical issues and didn't introduce any additional bugs."* — **preflightの「修正後にもう一度チェックする」設計と同型の推奨**。
- 実態としてはPR時運用が主流(下記In the wildで採用数10,208リポジトリを確認)。

### Cursor Bugbot

一次資料(WebFetch要約): https://cursor.com/docs/bugbot

- 基本はPR時。ローカルでは`/review-bugbot`スキルで「pushする前にエージェントからBugbotを走らせる」ことが可能。
- **auto-fixあり、かつ検証パスの記述なし**: 有効化すると「PRレビューで見つかったバグを直すためにCloud Agentを自動起動」し、既存ブランチか新規ブランチへ直接pushする。**preflightのjudge screeningに相当する人間/別モデルの介在なしに、見つけたら即修正コミットまで自動化**する点が他ベンダーと異なる。
- 効果数値: ルールごとのacceptance rateのみで、集計値の公開なし。

### Graphite Diamond / Sourcery / Qodo Merge

- Graphite: docs/blogとも個別記事に効果数値・false positive率は未確認(到達不能ではなく、要約止まりで数値記載なし)。
- Sourcery: PR時ステータスチェック中心、IDE統合でローカル適用可、エージェント修正機能ありだが仕組みの詳細不明。
- Qodo Merge: PR時中心。**独自ベンチマーク**(https://www.qodo.ai/ai-code-review-benchmark/)を公開し「Qodo demonstrates the strongest overall performance」「most competitors cluster toward high precision and low recall (quiet reviews with limited coverage)」と主張するが、**具体的なprecision/recall数値はページ本文になく**、Hugging Face上のベンチマーク実行に誘導するのみ。ベンダー自己申告であり独立検証は今回到達できず。

---

## 2. Practitioners(名前のある実務者の2026年アカウント)

- **Simon Willison, "Anti-patterns: things to avoid"** (2026-03-04, https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/): 最大の主張は *"Don't file pull requests with code you haven't reviewed yourself."* — 「delegating the actual work to other people」になるからNG。良いPRの条件として「動作確認済みで自信がある」「小さくレビュー可能」「文脈情報(手動テストのメモ、実装判断のコメント、スクショ/動画)を含む」を挙げる。**AIレビューが人間レビューの代替になるとは一言も言っていない** — AIレビューはあくまで人間の自己レビューを助ける道具という位置づけ。
- **Simon Willison, "More Than Just Code Review"** (2026-08-22, https://simonwillison.net/2026/Aug/22/more-than-just-code-review/): *"Eyeballing every line of code has never been the most effective way to validate a change... The key skill required to make productive use of coding agents is being able to confidently instruct them on how to make changes and then confidently verify that those changes have been applied in the correct way."* — 行単位レビューへの懐疑、検証(verify)を重視する立場。ただし本文は短く、具体的な運用ステップの記述は薄い[要約経由、本文全体は未取得]。
- **Jarred Sumner (Bun), via Simon Willison's "Rewriting Bun in Rust"** (2026-07-08): エージェント運用の検証として「a language-independent test suite with a million assertions, adversarial code review and when something does go wrong, fixing the process that generates the code instead of hand-fixing the code」— **adversarial review**(敵対的レビュー、preflightのfan-outに相当)を明示的に使い、かつ「個別のバグを直すのではなく生成プロセスを直す」という姿勢。
- **HN "Code Review for Claude Code" スレッド**(2026-03-09, 83pt, https://news.ycombinator.com/item?id=47313787): 実務者の生の反応が多数。
  - `jgraettinger1`: *"I ask Claude or codex to review staged work regularly... It will always find about 8 issues. The number doesn't change, but it gets a bit weird if it can't really find a defect. Part of the art of using the tool is recognizing this is happening, and understanding it's scraping the bottom [of the barrel]."* — **AIレビューには「必ず何か指摘するバイアス」がある**という実務観察。judge screeningの必要性を裏付ける。
  - `toniantunovi`: *"When a tool flags 8 issues on clean code and 8 issues on broken code, it's not a reviewer, it's a random number generator with a UI. The approach we've found more tractable is to separate concerns: let deterministic tools (linters, SAST, SCA) handle what they're definitively good at... and reserve the AI layer for things human[s are better at]."* — **決定論的ツール(lint/build)とAIレビューを分離すべき**という主張。preflightの「lint/build gateを別ステップとして持つ」設計を支持。
  - `lbreakjai`: *"the right harness makes more difference than the right model. The real competition for both claude and the platforms is a skill running locally against the very same code."* — ローカルskill(preflightのようなもの)がベンダーのPR時サービスと競合しうるという見立て。
  - `denisdev1`: *"LLM reviews are useful, but they tend to always produce findings. Even on small or very clean changes you will still get a list of suggestions. So part of the workflow becomes filtering signal vs noise."*
- **HN "Ask HN: Does anyone use codex to review Claude's code?"** (2026-05-15, https://news.ycombinator.com/item?id=48150810): `mrcode007`: *"I do it all the time. It finds errors CC doesn't. Especially in math formulas. I ping pong reviews between the two agents until they converge on no errors."* — **クロスモデルレビューを実践している具体例**(1件のみ、下記arXivのクロスモデル論文と方向性が一致)。
- **`iderex/swarm.asm` issue #50**(GitHub, 2026-08-12, https://github.com/iderex/swarm.asm/issues/50、1件のリポジトリの個人開発者の決定): *"My decision (2026-07-17): all code review and quality gating is done in-house via the adversarial lens gate (four refute-by-default lenses + simd-reviewer), the review of record. No external review/quality services in the project. External providers are not trusted; disabling is not enough, they must be removed and kept out."* — **CodeRabbit/Sonar/Copilotを完全撤去し、自前の複数レンズ(反証優先)ゲートに置き換えた実例**。preflightのfan-out+judge設計と構造的に酷似しており、「ベンダーPR時レビューより自前ゲートを選んだ」直接の先例。ただし1人のリポジトリの1事例であり、一般化はできない。

---

## 3. Measured evidence(数値のある研究・ベンチマーク)

- **arXiv 2603.12123, "Cross-Context Review: Improving LLM Output Quality by Separating Production and Review Sessions"** (Tae-Eun Song, 2026-03-12, https://arxiv.org/abs/2603.12123) — **本調査で最も決定に直結する測定結果**。30アーティファクト(コード・技術文書・プレゼン原稿)に150個のエラーを注入し、4条件×360回のレビューを実施:
  - 同一セッション内Self-Review (SR): F1 = 24.6%
  - 同一セッション内で2回目のSelf-Review (SR2): F1 = 21.7%(1回目と有意差なし, p=0.11 — **繰り返しレビューは効果がない**ことを示す対照条件)
  - 文脈を保持したSubagent Review (SA, 元セッションの文脈にアクセス可能なサブエージェント): F1 = 23.8%
  - **Cross-Context Review (CCR, 完全に独立した新規セッション、生成時の会話履歴に一切アクセスしない)**: F1 = 28.6%(SR比 p=0.008, d=0.52; SR2比 p<0.001, d=0.72; SA比 p=0.004, d=0.57)
  - 原文: *"CCR works with any model, needs no infrastructure, and costs only one extra session."*
  - **含意**: Claude Codeの`/code-review`は「forked subagent」(=SA条件に近い、生成セッションの文脈を引き継ぐ)であり、提案されている置き換え案の「`/code-review` → session fixes」も同一セッション内で完結する。この論文が測った4条件のうち、SAとSRはいずれもCCRに有意に劣る。**preflightの独立ワークフロー(別プロセス・別文脈のfan-out review)はCCR条件に近く、測定上優位な設計に該当する可能性が高い** — ただしこの論文はコード変更のみを対象にしたわけではなく(文書・スクリプトも含む混合評価)、タスク種別はコードに限定されない点に注意。
- **arXiv 2607.21656, "Cross-Model LLM Code Review: Should you use Claude to review Codex or vice versa?"** (2026-07-22, https://arxiv.org/abs/2607.21656, KDD'26 Agentic SE採択): LiveCodeBenchの難問/中問116件、Claude/Codexの6条件で統制実験。
  - Claude reviewがCodexのdraftを71.6%→89.7%に改善(p_BH=.001)
  - Codex self-reviewは71.6%→84.5%に改善(p_BH=.022) — **同一モデルの自己レビューでも改善はする**(ゼロではない)
  - 逆方向は悪化: CodexがClaudeのdraftをレビューすると91.4%→82.8%に**低下**(p_BH=.046)
  - Claude self-reviewは91.4%のまま**変化なし**
  - 結論原文: *"the useful pairing is asymmetric: use Claude to review Codex, not the other way around."*
  - **含意**: 「同一モデルが自分のコードをレビューしてはいけない」という一般論は本研究では**部分的にしか支持されない** — Claude self-reviewは効果なし(横ばい)だがCodex self-reviewはプラス、モデルの組み合わせと方向に強く依存する非対称な結果。「別モデルなら常に良い」も誤りで、Codex→Claudeは有害だった。
- **arXiv 2603.11078, "CR-Bench: Evaluating the Real-World Utility of AI Code Review Agents"** (2026-03-10, https://arxiv.org/abs/2603.11078): *"code review agents can exhibit a low signal-to-noise ratio when designed to identify all hidden issues, obscuring true progress and developer productivity when measured solely by resolution rates... hidden trade-off between issue resolution and spurious findings."* — **「全部拾おうとするAIレビューはノイズ増、resolution率だけで測ると見誤る」**という定量的知見。judge screening(preflight)や、REVIEW.mdでのnit上限設定(Claude Code)の必要性を裏付ける。
- **arXiv 2505.20206, "Evaluating Large Language Models for Code Review"** (2025-05-26): GPT4o/Gemini 2.0 Flashで、問題文ありの場合の正誤判定精度68.50%/63.89%、修正成功率67.83%/54.26%(AI生成コード492ブロック)。問題文なしでは精度低下。**「Human in the loop LLM Code Review」を提案** — 人間を介さない自動適用への慎重論。
- **arXiv 2505.16339, "Rethinking Code Review Workflows with LLM Assistance: An Empirical Study"** (WirelessCar Sweden AB, 2025-05-22): フィールド実験で「AI-led reviews are overall more preferred」だが「conditional on the reviewers' familiarity with the code base, as well as on the severity of the pull request」、懸念点として「false positives and trust issues」を明記。
- **METR, "Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity"** (https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/): 経験豊富なOSS開発者16名・246 issueのRCT。**「AIツール使用許可群はissue完了に19%長くかかった」**(期待は24%高速化)。コードレビュー/自己レビュー/auto-fixループを個別に扱った記述はなし[未言及、レビュー起因の遅延かは不明]。2026年2月更新版で後期2025年ツールでは異なる結果になったと言及されているが、更新版の本文は未取得[unverified、リンク先未確認]。
- **HN comment, `sensanaty`**(2026-07-01, https://news.ycombinator.com/item?id=48743713, 元コメントは公開企業内部評価の要約という体裁 — 一次資料ではなく実務者の伝聞であることに注意): 従業員約2000名・2年間の社内統計に基づく評価として「全AIツール導入の総合生産性向上はわずか7%」「最も成果の出たチームで約20%、マイナスになったチームもある」。測定項目の一つに「how often people interact with the MR review bots and implement their suggestions/fixes」を含むと明記されているが、**レビューボット単体のROIを分離した数値は示されていない**。社内文書へのリンクは提示されておらず、検証不能[unverified、一次資料非公開]。
- **Qodo AI Code Review Benchmark**(ベンダー公開、https://www.qodo.ai/ai-code-review-benchmark/): 「real, merged pull requestsに検証済みバグとベストプラクティス違反を注入」しprecision/recall/F1で評価と主張するが、**本文に具体的な数値は掲載されておらず**、Hugging Face上での再実行に誘導するのみ。ベンダー自己評価であり独立検証なし。

**「なし」と明記すべき箇所**: Google/Meta/Microsoftの社内AIレビュー大規模運用に関する公開論文は、本調査では発見できなかった(探索はしたが到達せず)。CodeRabbit/Graphite自身が公開した独立検証済みの効果数値(false positive率、defect detection率)も本調査では未発見。

---

## 4. In the wild(公開リポジトリの実態)

`gh search code` / `gh api search/code` / `gh search issues`(認証済み)で確認。

| リポジトリ | 何を確認したか | 日付 | 規模 |
|---|---|---|---|
| `BertCalm/XO_OX-XOmnibus` `.claude/skills/preflight.md` | `/preflight`スキル: lint→build→test→benchmark compareの直列ゲート、`--fix`でlint自動修正。**AIレビューのfan-outはなし**、決定論的チェックのみ | 2026-08-24 push | star 1(小規模個人プロジェクト) |
| `mateaix/matecloud` `.claude/.harness/README.md` | `mate-preflight`スキルを「提出/開PR前」に位置づけ、「校验+提交规范+范围干净」を実行するハーネスの一部として文書化 | 2026-09-19 push | star 1,700(中規模の実プロダクト) |
| `iderex/swarm.asm` issue #50 | CodeRabbit/Sonar/Copilotを完全撤去し、自前の「四反証レンズ+simd-reviewer」ゲートへ一本化(上記Practitioners参照) | 2026-08-12 | star 0(個人プロジェクトだが設計判断として明確) |
| `vanillagreencom/kendex` issue #1113 | CodeRabbitをorg全体で無効化。理由は**"constant rate limits"**(継続的なレート制限)。Copilot(手動リクエストのみ)とCodex connectorのみが残る運用に縮退 | 2026-08-08 | star 79 |
| `aiidateam/aiida-core` `.coderabbit.yaml` | 大規模科学計算OSSプロジェクトが「CodeRabbit reviews every non-draft PR automatically. Open a PR as a draft to [delay review]... AGENTS.md / CLAUDE.md already steer reviews as guidance (default); no config needed」— **PR時レビューが既定、ローカルpre-PR運用への言及なし** | 2026-09-22 push(調査当日) | star 590 |

**採用規模の定量値**: `.coderabbit.yaml`をfilenameに持つ公開リポジトリは`gh api "search/code?q=filename:.coderabbit.yaml"`で**10,208件**(2026-09-22時点)。CodeRabbitのPR時運用は広く普及している定量的裏付け。

**`crit`(tomasz-tomczyk/crit)の採用実態**: GitHub code検索では"crit"がノイズ語(CRITICAL等)に埋もれ有効な検索ができなかった。HN Algolia検索では以下のShow HN投稿を確認——「Show HN: Crit – local review tool for agent plans and code diffs」(2026-05-08, 12pt)、「Show HN: Crit – Review AI agent work like you review PRs」(2026-03-10, 4pt)、「Show HN: Crit – terminal TUI for reviewing AI-generated code and plan documents」(2026-03-09, 2pt)。**いずれも小規模な反応**(最大12pt)であり、広範な実務採用を示す一次証拠(公開リポジトリでの利用実例)は本調査では発見できなかった[gh code検索がレート制限(403)にも遭遇し、追加検索は断念]。

**否定的証拠**:
- `vanillagreencom/kendex`: CodeRabbitをレート制限を理由にorg全体で無効化(上記)。
- `iderex/swarm.asm`: 外部レビューサービス全撤去、「External providers are not trusted; disabling is not enough, they must be removed and kept out」という強い不信の表明。
- `LMLiam/Kotventure` issue #385「make CodeRabbit accurate, stable, and advisory」(2026-08-10)— タイトルから、精度・安定性に懸念があり「advisory(参考情報止まり)」に格下げする意図が読み取れる[本文未取得、タイトルのみの確認]。
- HN `jgraettinger1`・`denisdev1`・`toniantunovi`のコメント(上記Practitioners参照)— 「AIレビューは常に何か見つける」「シグナル/ノイズの選別が仕事になる」という実務上の摩擦。
- `gh search code` は403レート制限に到達し、`"crit story"`等の追加検索が実行できなかった — 認証済みでも検索APIのレート制限は実運用上の制約として記録しておく。

**バイアスの明記**: issue trackerは否定寄りに偏る(問題が起きたときだけissueが立つ)。HN Show HNは肯定的な自己宣伝に偏る。gh search codeの母集団はpublicリポジトリのみで、企業の内部ハーネス実装(まさにこの調査対象のharnessのような設計)は不可視。

---

## サマリーテーブル

| ツール/研究 | pre-PRローカル? | fan-out/multi-agent? | verify pass? | auto-fix? | plan gating | 数値 |
|---|---|---|---|---|---|---|
| Claude Code `/code-review` | ○(ローカルコマンド) | ○(PR時Code Reviewはmulti-agent; ローカルは単一だがultraでcloud multi-agent) | ○(PR時: "verification step checks candidates against actual code behavior") | オプトイン(`--fix`) | PR時マネージドはTeam/Enterprise、ローカルは全プラン無料 | PR時 $15–25/review(公式) |
| Codex `/review` | ○ | 記述なし | 記述なし | なし(作業ツリー変更せず) | 不明 | なし |
| GitHub Copilot | △(IDE内のみ) | 不明 | approve assessment(既定off) | 手動適用/Fix with Copilotボタン起点 | ライセンス無しでも組織有効化可 | なし |
| CodeRabbit | ○(CLI "before you commit") | 不明 | ○("run cr --agent one more time") | なし(所見のみ) | 有料プラン主体(詳細未確認) | 採用10,208リポジトリ(gh search) |
| Cursor Bugbot | △(`/review-bugbot`でpush前も可) | 不明 | 記述なし | **あり、Cloud Agentが直接ブランチへpush** | 個人/チーム/enterpriseで課金体系分岐 | ルール別acceptance rateのみ、集計非公開 |
| Graphite Diamond | 不明 | 不明 | 不明 | 「fixを提案」の記述のみ | 不明 | 未確認 |
| Sourcery | △(IDE統合) | 不明 | 不明 | エージェント修正機能あり(詳細不明) | 不明 | なし |
| Qodo Merge | 不明(PR時中心) | 記述あり(specialized agent suite) | 不明 | AIコーディングアシスタント向けプロンプト生成 | 不明 | 自社ベンチマーク(数値非公開) |
| crit (tomasz-tomczyk) | ○(人間がdiff/plan/live appをレビュー) | ×(人間1人が起点、エージェントは修正のみ) | ×(人間の承認がverification) | agentが人間コメントを受けて修正 | OSS無料 | star 1.1k(WebFetch要約、未再検証) |
| arXiv 2603.12123 (CCR) | — | — | 測定対象そのもの | — | — | **CCR F1=28.6% > SR 24.6% > SA 23.8% > SR2 21.7%** |
| arXiv 2607.21656 (Cross-Model) | — | — | 測定対象そのもの | — | — | Claude review Codex: 71.6%→89.7%; Codex review Claude: 91.4%→82.8%(悪化) |
| arXiv 2603.11078 (CR-Bench) | — | — | — | — | — | 「resolution率だけで測ると誤る」(signal-to-noise trade-off、数値は非開示の予備研究) |
| METR (2025-07) | — | — | — | — | — | AI許可群は19%遅い(コードレビュー起因かは不明) |

---

## 検証(verdict): preflightの5段階のうちどれを支持するか

**preflightの5段階**: ① Collect diff → ② fan-out AI review(multi-agent) → ③ judge screens findings → ④ auto-apply accepted fixes → ⑤ lint/build gate → content-hash marker

1. **② fan-out(multi-agent)review — 自動化として維持を支持する証拠が強い。**
   Claude Code自身のPR時Code Reviewが「multiple agents analyze... in parallel」という同型設計を公式機能として採用している。CR-Bench論文とHN実務者コメント(jgraettinger1, denisdev1)は「単一パスのAIレビューは常に何か見つけるバイアスがある」ことを示しており、複数レンズで拾って後段でふるいにかける設計はこのバイアスへの対処として理にかなう。ただし「fan-outであること」自体の効果を単独で測った研究は見つからなかった — 支持は間接的。

2. **③ judge screens findings — 自動化として維持を強く支持する証拠がある。**
   Claude Code公式ベストプラクティスが「A reviewer prompted to find gaps will usually report some, even when the work is sound... Tell the reviewer to flag only gaps that affect correctness」と明言し、REVIEW.mdでnit上限を設定する運用を推奨。CR-Bench論文の「resolution率だけで測ると見誤る、signal-to-noise trade-offがある」も同じ方向。HNの「8個は必ず見つかる」観察も screening の必要性を裏付ける。**この段階を削除する(judge無しでfindingsをそのまま流す)ことを支持する証拠は無い。**

3. **④ auto-apply accepted fixes — 条件付きでのみ支持される。無条件の自動適用を支持する証拠はない。**
   ベンダーの大半(Codex, GitHub Copilot, CodeRabbit, Sourcery)は**所見を出すが自動適用しない**のがデフォルト。Claude Codeの`--fix`もオプトイン。自動でブランチに直接pushまでするのはCursor Bugbotだけで、かつ検証パスの記述がない(=preflightの④単独に一番近いが、judgeに相当する screening 記述がない)。CodeRabbit CLIは明示的に「適用後にもう一度チェックを走らせる」ことを推奨しており、**「auto-applyするなら、その後に検証を挟め」という一次資料の指示**がある。CCR論文は"apply"の効果ではなく"review"の精度を測っているため、④そのものへの直接証拠ではないが、judgeで screening 済みのfindingsだけを自動適用するpreflightの設計は、無審査でauto-applyするより一次資料の推奨に沿っている。**「judge screeningを経た上でのauto-apply」までは支持できるが、「screeningなしのauto-apply」を支持する証拠はどこにもない。**

4. **⑤ lint/build gate — 決定論的ゲートとして維持を強く支持する。**
   HN実務者(toniantunovi)の「deterministic tools (linters, SAST, SCA) handle what they're definitively good at... reserve the AI layer for things human」という主張、Claude Code公式の「Stop hookによる決定論的ゲート」推奨、`BertCalm/XO_OX-XOmnibus`の`/preflight`(lint→build→test→benchmark、AIレビューなし)という実例。**AIレビューと決定論的チェックを分離すること自体は、ベンダー・実務者・実例のいずれからも一致して支持される。** 提案されている置き換え案の「Stop-hook typecheck/lint」はこの段階の代替として妥当。

5. **content-hash marker(冪等性マーカー) — 直接の precedent は見つからなかった。**
   これに相当する仕組み(同じdiffに対して再実行しない)を明示的に論じた一次資料は本調査の範囲では発見できなかった。ただし、Claude Code Code Reviewの「Reviewing on every push runs the most reviews and costs the most」という課金構造の記述は、**再実行コストを抑える仕組みへの実務上のニーズ**を間接的に裏付ける。

6. **「同一モデル/同一セッションが自分の出したfindingsを直す」ことの当否 — 単純な「ダメ」ではなく、条件付きで悪化しうる、というのが正確な読み。**
   CCR論文(2603.12123)は「同一セッション内(SR)」も「文脈付きサブエージェント(SA、Claude Codeの`/code-review`が実際にこれに近い)」も、完全に独立した新規セッション(CCR)に有意に劣ると測定した。一方Cross-Model論文(2607.21656)は「別モデルなら常に良い」わけでもないことを示した(Codex review Claudeは悪化)。**提案されている置き換え案「`/code-review` → session fixes」は、CCR論文の定義でいうSA相当(文脈を引き継いだサブエージェント)にとどまり、測定上もっとも精度が高かったCross-Context(完全独立セッション)の条件を満たさない。** これはpreflightのような独立ワークフロー実行(別プロセス起動、生成時の会話履歴を持たない)の方が、この一点に関しては測定上優位な設計であることを示す、本調査で最も具体的な数値根拠である。

## 「先例なし」と明記する項目

- Google/Meta/Microsoftなど大手による社内AIレビュー運用の公開論文・数値(探索したが未発見)。
- content-hash markerによる冪等性チェックの一次資料(業界の議論として明示的に扱われた例は未発見)。
- crit(tomasz-tomczyk/crit)を実際のCI/pre-PRワークフローに組み込んだ公開リポジトリの実例(Show HNの反応はあるが、`.github/workflows`や`.claude/`での採用実例をgh検索では確認できなかった — ただし検索はGitHubのレート制限で途中打ち切りとなっており、「存在しない」ではなく「見つからなかった」)。
- 「fan-out(multi-agent)であること」単独の効果を、single-agent reviewと比較統制した研究(CCR論文は"context separation"を測っており"multi-agent vs single-agent"ではない)。
- Cursor Bugbotのauto-fix(見つけたら即ブランチへpush)が事故を起こした/起こさなかったことを示す定量データ。
