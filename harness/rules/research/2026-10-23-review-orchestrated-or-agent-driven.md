---
question: "複数段のコードレビュー手順（差分の分類、専門 reviewer の起動、指摘ごとの別文脈での検証、大きい変更での別モデルの二度目のレビュー、報告）の段取りは、コード（決定的な orchestrator）が持つのが受け入れられたやり方か、エージェントが書かれた skill に従って進め、宣言的な機械検査だけを足すのが受け入れられたやり方か。それぞれ何で失敗するか"
date: 2026-10-23
verdict: "業界は二つに割れていて、割れ目は『誰の実行環境か』で説明できる。ベンダーが自前の実行環境で動かす製品版は、外枠をコードが持ち、各段の中でエージェントを使う（Anthropic の Code Review は find・verify・rank・post をインフラが実行、CodeRabbit は自称で pipeline の中でモデルが推論）。ただし固定の外枠は品質の上限になることがあり、Cursor の Bugbot（解決率 52% から 70% 超、ただし 40 回の実験全体の数字）と Greptile（v2 の flowchart から v3 の loop で action rate 34.75% から 59.24%）は固定 pipeline から agentic な loop へ移した。一方、利用者の手元で動くレビューは散文の skill が主流で、Anthropic 自身のローカル /code-review も同梱 skill、公開の code-review プラグインも散文の command である。複数ハーネスの設定ツール（rulesync ★1,545、ruler ★2,951、wshobson/agents ★41,573、superpowers ★303,789）は全て宣言的で、実行エンジンを持たない。唯一の例外は別プロジェクトの TAKT（★1,416、約 9 か月、v0.72.0）で、『プロンプトや skill に規則を足しても手順は強制できない』と明言して YAML の workflow が手順を持つが、9 つの provider の SDK 追従を毎日している。code が手順を持つ側の失敗は、費用の暴走（Workflow ツールの code-review で 46 体・約 300 万トークン、別件で約 180 体・36.6M トークン・約 $606）、特定のハーネスへの固定、規則が読めなくなること。agent が手順を持つ側の失敗は、飛ばしと偽りの完了報告（前日までの記録）。手順の完走を、orchestrator 有りと無しで比べたコーディング・レビューの測定は無い。測定で近いのは、決定的な routing の守りが確認の飛ばしを直した決済課題（最大 +93.8 ポイント）と、手順の指示をプログラムに変換して不整合の失敗率を 42.50% から 15.83% に下げた報告（いずれもコーディングではない）"
unverified:
  - "Cursor Bugbot の 52% から 70% 超は『ローンチ後の 40 回の大きな実験の合計』で、agentic への切り替え単独の効果は分離されていない（本文に費用と遅延の数字も無い）"
  - "Greptile の v2 から v3 の数字は自社データで、独立の再測定は無い。v3 は v2 の約 3 倍の文脈トークンを使い、推論費用が約 75% 下がったのは自社ホスト版だけで、キャッシュヒット率による（本文の説明）"
  - "Graphite の Diamond（現 Graphite Agent）の内部構造の公開記述は見つからなかった。Cursor への合流の記述は検索結果の要約のみ"
  - "Codex の GitHub レビューと `/review` の内部手順（固定の段か agent 主導か）は文書に記述が無い。文書が述べるのは AGENTS.md の Code Review Rules に従うことと P0・P1 だけを出すことまで"
  - "CodeRabbit の CEO の発言『a pipeline in a way, and a lot of the work goes into preparing the context』は第三者の解説記事の要約経由で、原文は未確認"
  - "Hamel Husain と Eugene Yan の、この問い（決定的な orchestration とエージェントの自律）を直接扱った投稿は検索で見つからなかった（到達できなかったのであり、無いとは言えない）"
  - "COVENANT（arXiv 2607.25400）の 50.00% から 83.33% の課題の種類は確認していない。コーディングかどうかは不明"
  - "Workflow ツールの issue はどれも一人の報告で、Anthropic の確認は読めていない。費用の数字は報告者の申告"
  - "前日の記録から引き続き、skill の frontmatter の hook が実機で発火して block できるかは未確認"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 段取りをコードが持つか、エージェントが持つか。レビューと手順一般の受け入れられたやり方

調査日: 2026-10-23
前提: `2026-10-22-making-agents-finish-procedures.md`（以下「10-22 の記録」）と `2026-10-23-harness-neutral-procedure-checks.md`（以下「10-23 の記録」）は再調査していない。そこで確定している「散文の手順書だけでは完走しない（OverclaimBench: 不完全な実行の 80.4% が誤解を招く報告）」「Stop hook は連続 8 回で打ち切り」「Bugbot は固定 pipeline から agentic で 52% から 70% 超（10-22 では要約経由だった）」「ハーネス中立の hook の標準は無い」を前提に使う。今回は、その上に残っていた問い、(a) 製品版と公開プラグインはどちらの形か、(b) 一般の設計指針と測定、(c) code が持つ側の失敗、(d) 複数ハーネスの設定ツールは orchestrator を持つか、を調べた。

取得の区別。「直接」は、gh api の本文、curl、または全文がそのまま返ったページ。「要約経由」は WebFetch の要約器を通したもの。「検索要約」は検索結果の要約だけで、本文を読んでいない。

## 結論

1. **レビュー製品の構造は、実行環境の持ち主で分かれる。** 製品版（ベンダーが自前の基盤で動かす）は、外枠の段をコードが持ち、段の中でエージェントを使う。Anthropic の Code Review は "Find ... Verify ... Rank ... Post" の四段をインフラが実行する。CodeRabbit は自社の説明で固定段の中でモデルが推論する hybrid を選ぶ。利用者の手元で動くレビューは散文である。Anthropic の `/code-review` は "a bundled skill: its instructions are built into Claude Code"、公開の `code-review` プラグインは散文の command が 4 体の reviewer と検証 subagent を起動させる。
2. **固定の外枠は品質の上限になることがあり、二つの製品がそこから離れた。** Bugbot は "Run eight parallel passes with randomized diff order" から始まる七段の固定手順から agentic な loop へ移し、Greptile は v2 の flowchart の硬さを理由に v3 の loop へ移した。どちらも自社の数字で、独立の再測定は無い。逆向き（agentic から固定段へ戻した）の公開例は、レビュー製品では見つからなかった。
3. **一般の設計指針は『単純な方から始め、決まった手順なら code』で割れていない。** Anthropic は "workflows offer predictability and consistency for well-defined tasks"、OpenAI の Agents SDK は "orchestrating via code makes tasks more deterministic and predictable, in terms of speed, cost and performance"、LangChain の Chase は "most agentic systems in production are a combination of workflows and agents"。三者とも混在を前提とし、片方を勧めない。
4. **手順の完走を、code が持つ場合と agent が持つ場合で比べたコーディング課題の測定は無い。** 近い測定は二つあり、どちらもコーディングではない。決済の確認手順で 18 モデル中 10 が確認を飛ばし、決定的な routing の守りと prompt の変更で最大 +93.8 ポイント改善した（arXiv 2605.06457）。手順の指示をプログラムに変換する COVENANT は、不整合の失敗率を 42.50% から 15.83% に下げた（arXiv 2607.25400、課題の種類は未確認）。
5. **code が持つ側の失敗は、費用の暴走と、実行環境への固定と、硬さ。** Claude Code の Workflow ツールで、code-review の orchestration が 46 体の Opus subagent と約 2,986,845 トークンを使った報告（#66023）、547 体を計画して約 180 体が走り 36.6M トークン・約 $606 に達した報告（#95816）、検証役 33 件が全て `pass: false` を返して 137 回の呼び出しで使える出力が無かった報告（#94911）がある。Workflow は Claude Code の機能で、他のハーネスでは動かない。
6. **複数ハーネスの設定ツールは、調べた全てが宣言的で、実行エンジンを持たない。** rulesync の `checks` は、レビューの観点を Markdown で書き、各ツール（Cursor の `BUGBOT.md`、Amp の checks、TAKT の `quality_gates`）の形式に書き出すだけである。手順を実行するエンジンを自前で持つ唯一の例は、別プロジェクトの TAKT で、そこでは provider の SDK への追従が日常の作業になっている。なぜ他が宣言的に留まるかを書いた資料は見つからなかった。
7. **判断（推論）は末尾にまとめた。**

## 根拠

### レンズ 1. ベンダー

#### 製品版

**Anthropic Code Review（管理された製品）。**（直接。全文が返った）
- 段取り: "A review runs on Anthropic infrastructure in four stages: 1. Find: several agents examine the diff and the surrounding code in parallel. 2. Verify: a verification step checks the candidate findings against the code and filters out false positives. 3. Rank ... 4. Post"（https://code.claude.com/docs/en/code-review）。モデルは製品が選び、"its admin settings don't offer a model choice"。つまり段の列は code、各段の中は agent。
- 制約と限界: "a review works from reading the diff and the surrounding code, without building or running your code"、"A review with no findings doesn't mean your code is error-free or secure."（同ページ）。
- 費用: 一回ごとの定価は無い。"Code Review has no flat per-review price"（https://code.claude.com/docs/en/code-review-costs）。10-22 の記録の「1 レビュー 15〜25 ドル」は、今回の検索でも二次資料のみ（検索要約: 同じ数字を『公式の文書が今は平均 15〜25 ドルと書く』と述べる記事があるが、費用ページの本文に数字は無い）。内部の効果の数字（実質的なコメントが PR の 16% から 54%、誤りとされた指摘が 1% 未満）も二次資料のみ（検索要約、一次の発表は読めていない）。
- 「検査の行が無ければ verdict なし」の扱いは 10-23 の記録のとおり。

**Anthropic ultrareview（クラウドの fleet）。**（直接）
- "launches a fleet of reviewer agents in a cloud sandbox"、"every reported finding is independently reproduced and verified"。研究プレビュー。所要は "roughly 15 to 25 minutes"、費用は無料枠 3 回のあと "typically $5 to $25 in usage credits"。差分の上限は既定で 500 ファイルと 8,000 行（https://code.claude.com/docs/en/ultrareview）。Bedrock などのサードパーティ経由、ZDR、HIPAA では使えず、その場合は "runs a local review in your session instead"。

**Anthropic のローカル `/code-review`（同梱 skill）。**（直接）
- "`/code-review` is a bundled skill: its instructions are built into Claude Code, so there is no `SKILL.md` file on disk"。"The review runs as a background subagent with its own context window"。"Replace the command: a project or personal skill named `code-review` runs in place of the bundled one"、"Build your own reviewer: write a reviewer subagent or a review skill"（https://code.claude.com/docs/en/code-review-local）。Anthropic の文書自身が、手元のレビューを散文の skill か subagent として自作する道を公式に挙げる。
- 同ページは、v2.1.223 より前の `/review` が "a separate command that ran a single-pass, read-only review" だったと述べる。単発から多段の skill に変わったが、どちらも code が段取りを持つ形ではない。

**Anthropic の公開 `code-review` プラグイン（散文の command）。**（直接。gh ではなく GitHub のページを要約器で読んだため、段の列は要約経由）
- 手順: 1. haiku が PR の状態を確認、2. haiku が CLAUDE.md の場所を返す、3. sonnet が要約、4. "Launch 4 agents in parallel"（CLAUDE.md の遵守を sonnet 2 体、バグを Opus 2 体）、5. "For each issue found ... launch parallel subagents to validate"、6. "Filter out any issues that were not validated"（https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md）。持ち主の想定する手順（分類、reviewer の並列、指摘ごとの検証）と同じ形で、これを散文のままで配っている。完走率の測定は 10-22 の記録のとおり無い。

**claude-code-action（Anthropic の GitHub Actions）。**（直接、gh api）
- 文書の標準例は、一つの `prompt`（"Please review this pull request with a focus on: ..."）と許可ツールの一覧だけで、段取りを持たない。agent に一回任せる形（https://github.com/anthropics/claude-code-action/blob/main/docs/solutions.md）。★9,611、最終 push 2026-10-22、open issue 832（gh api）。

**Cursor Bugbot。**（直接。ブログの本文を curl で読んだ）
- 原文: 初期の流れは "Run eight parallel passes with randomized diff order" から始まる（"Combine similar bugs into one bucket"、"Majority voting to filter out bugs" と続く）。"We saw the largest gains when, this fall, we switched Bugbot to a fully agentic design. The agent could reason over the diff, call tools, and decide where to dig deeper instead of following a fixed sequence of passes."
- 数字: "Since launch, we have run 40 major experiments that have increased Bugbot's resolution rate from 52% to over 70%, while lifting the average number of bugs flagged per run from 0.4 to 0.7. This means that the number of resolved bugs per PR has more than doubled, from roughly 0.2 to about 0.5."（https://cursor.com/blog/building-bugbot）。この数字は 40 回の実験全体で、agentic への切り替え単独ではない。費用と遅延の数字は本文に無い。フォーラム版は同じ内容（要約経由、https://forum.cursor.com/t/building-a-better-bugbot/149040。BugBench と、マージ時の AI 判定で測ったとある）。

**Greptile。**（直接。本文を curl で読んだ）
- v2: "Crudely, v2 was a flowchart"。限界: "The rigidity of the flowchart prevents the system from using new information that it gets from the search step."
- v3: "We let the system run in a loop, with access to some key tools such as codebase search and accessing learned rules."（要約経由で確認した文）
- 数字（表）: upvote/downvote 比 1.44 から 5.13、action rate 34.75% から 59.24%。"v3 uses caching far more effectively. In spite of using more context tokens than v2 (around 3 times more), it actually has 75% lower inference costs for our self-hosted customers, thanks to extremely high cache hit rates."（https://www.greptile.com/blog/greptile-v3-agentic-code-review）。全て自社データ。Claude Agent SDK 上に作られたという事例記事がある（検索要約、https://claude.com/customers/greptile）。

**CodeRabbit。**（要約経由）
- 自社の説明: pipeline の利点を "predictable, fast, and easy to test"、agentic の失敗に "or loop forever"、固定段には "But they can be rigid." と書き、"let the model reason within reason" という hybrid を選ぶ（https://coderabbit.ai/blog/pipeline-ai-vs-agentic-ai-for-code-reviews-let-the-model-reason-within-reason）。数字は pipeline と agentic の比較には無い。
- 文書の構成図: "Specialized AI agents working in parallel: Review, Verification, Chat, Pre-Merge Checks, and Finishing Touches"、"50+ static analyzers"。ただし "doesn't list the review pipeline as ordered stages"、核の段が固定か agent 主導かは書かれていない（https://docs.coderabbit.ai/overview/architecture）。

**GitHub Copilot code review。**（要約経由）
- "Copilot code review utilizes agentic capabilities to extend its functionality."、"uses GitHub Actions to run the agentic capabilities"。Actions が使えないと "code reviews will fall back to a more limited review"。"Copilot is not guaranteed to spot all problems or issues in a pull request."（https://docs.github.com/en/copilot/concepts/agents/code-review）。段取りの記述は無い。

**OpenAI Codex。**（要約経由）
- GitHub では `@codex review`。"Codex searches your repository for `AGENTS.md` files and follows the applicable code review rules."、"Codex flags only P0 and P1 issues"、"Code review rules guide Codex; they don't replace tests, branch protections, or required approvals."（https://learn.chatgpt.com/docs/third-party/github）。CLI の `/review` は "Run a dedicated review against uncommitted changes, a commit, or a base branch." と "reports prioritized findings without modifying your working tree"（https://learn.chatgpt.com/docs/codex/cli）。内部の段取りの記述は無い。

**Qodo PR-Agent。**（要約経由）
- "Each tool (`/review`, `/improve`, `/ask`) uses a single LLM call (~30 seconds, low cost)." と "PR Compression strategy"。agentic でも orchestrated でもない、一回呼びの形。Qodo が "a community-maintained legacy project of Qodo" と呼び、財団への寄贈の途中（https://github.com/qodo-ai/pr-agent）。gh api で ★13,557、最終 push 2026-10-22、open issue 26。

**Graphite（Diamond、現 Graphite Agent）。**（検索要約のみ）
- 内部構造の公開記述は見つからず。自社の数字は「負のコメント率 5% 未満」「96% が好意的」（方法の記述なし）で、Cursor に合流するとの記述がある（https://graphite.com/guides/ai-code-review-false-positives など。本文は未取得）。

### レンズ 2. 設計指針と実践者

- **Anthropic "Building effective agents"**（要約経由）。"Workflows are systems where LLMs and tools are orchestrated through predefined code paths."、"we recommend finding the simplest solution possible, and only increasing complexity when needed."、"Agentic systems often trade latency and cost for better task performance"。フレームワークには "they often create extra layers of abstraction that can obscure the underlying prompts"（https://www.anthropic.com/engineering/building-effective-agents）。
- **Claude Code の workflow 文書**（直接。全文）。"The difference is who holds the plan"。Skills は "Claude, following the prompt" が次を決め、Workflows は "The script" が決める。"A workflow moves the plan into code."、"Moving the plan into code also lets a workflow apply a repeatable quality pattern ... independent agents adversarially review each other's findings before they're reported"。例に "Review every changed file and write one summary" を挙げる。保存先は `.claude/workflows/`、プラグインで配布でき、"Distribute a workflow in a plugin"。制約は 10-22 の記録のとおり（"No mid-run user input"、1,000 agents total per run、16 並列）。加えて新しく確認した点: `Date.now()`、`Math.random()` は script 内で throw し、再開時に同じ呼び出しを繰り返せるようにする。サブエージェントの結果は schema で検証され、五回失敗すると呼び出しが失敗する（https://code.claude.com/docs/en/workflows）。つまり orchestrator を使う側の設計も、決定性を保つ制約を入れている。
- **OpenAI Agents SDK**（要約経由）。"Orchestrating via LLM ... great when the task is open-ended"、"orchestrating via code makes tasks more deterministic and predictable, in terms of speed, cost and performance."、"You can mix and match these patterns."（https://openai.github.io/openai-agents-python/multi_agent/）。
- **Harrison Chase / LangChain**（要約経由）。"most agentic systems in production are a combination of workflows and agents"、"Reliability does not track 100% with predictability, but in practice they can be closely related."、"The hard part of building reliable agentic systems is making sure the LLM has the appropriate context at each step."（https://www.langchain.com/blog/how-to-think-about-agent-frameworks）。
- **Dex Horthy（12-factor agents、factor 8 "Own your control flow"）**（要約経由）。制御の持ち主をコードにする理由として、人の承認のための中断、長い作業の中断と再開（"we need to be able to interrupt a working agent and resume later"）、tool call の実行前の承認、要約・キャッシュ・LLM による判定の差し込みを挙げる（https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-08-own-your-control-flow.md）。レビューの完走ではなく、中断と承認が理由。
- **Anthropic の multi-agent research system**（要約経由）。orchestrator-worker で "outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval"、"multi-agent systems use about 15× more tokens than chats"、"most coding tasks involve fewer truly parallelizable tasks than research"。初期の失敗は "50 subagents for simple queries"（https://www.anthropic.com/engineering/multi-agent-research-system）。調査課題で、コーディングではない。
- **Simon Willison**（要約経由）。subagent の章で "A code reviewer agent can review code and identify bugs, feature gaps or weaknesses in the design." を例に挙げ、"the main value of subagents is in preserving that valuable root context" として、専門 subagent を何十も作ることには注意を促す。決定的な orchestration との比較は書いていない（https://simonwillison.net/guides/agentic-engineering-patterns/subagents/）。
- **Hamel Husain、Eugene Yan**: この問いを直接扱った投稿は見つからなかった（検索要約のみ。到達できなかったのであり、無いとは言えない）。

### レンズ 3. 測定

| 出典 | 課題 | 結果 | 備考 |
|---|---|---|---|
| Bugbot（自社ブログ） | PR のレビュー | 解決率 52% から 70% 超、1 実行あたりの指摘 0.4 から 0.7、PR あたりの解決 0.2 から 0.5 | 40 回の実験全体の数字。固定 pipeline から agentic への切り替えが最大の寄与と書くが、分離した数字は無い。費用・遅延なし |
| Greptile（自社ブログ） | PR のレビュー | 上の表。action rate 34.75% から 59.24% | 自社データ。文脈トークン約 3 倍。費用 75% 減は自社ホスト版のみ |
| 第三者の比較（Martian、検索要約） | PR のレビュー | CodeRabbit が 10 ツール中 1 位、F1 51.2%（適合率 49.2%、再現率 53.5%） | 検索要約のみ。Claude Code Review を含む独立の結果は見つからず。ベンダー自身の比較は順位が食い違う（Augment: Bugbot 適合率 60%・再現率 41%・F1 49%、Entelligence は自社 1 位）。Greptile 自社の 82% は独立の再実行で低いとされる |
| c-CRAB（https://arxiv.org/abs/2603.23448） | レビューエージェントの評価 | "the existing review agents taken together can solve only around 40% of the c-CRAB tasks"（PR-agent、Devin、Claude Code、Codex を評価） | abstract のみ。pipeline 対 agentic の比較ではない |
| CodeRabbit の実地（https://arxiv.org/abs/2607.03316） | 239 リポジトリの 31,073 件 | "36.4% were accepted and 7.3% triggered discussion, while 56.3% were rejected"。agentic なレビューは機能面を多く指摘するが、無効になりやすい | abstract のみ。採否は開発者の反応で、真の正解ではない |
| Agentless（https://arxiv.org/abs/2407.01489） | SWE-bench Lite の修正 | 三段（特定・修正・検証）の固定手順で "32.00%, 96 correct fixes"、"low cost ($0.70)" | 2024 年の結果で、当時の open-source のエージェントを上回った。レビューではなく修正。固定手順が強いという最も古い測定で、その後に agentic な製品が上回ったかは今回測っていない |
| Scaling agent systems（https://arxiv.org/abs/2512.08296） | 複数エージェント構成の比較 | 単一エージェントに対し "+80.8% on decomposable financial reasoning" から逐次の計画で -70.0% まで。"architectures without centralized verification tend to propagate errors more than those with centralized coordination" | 課題の種類に依存する。複数の reviewer を並列にする設計は分解できる課題の側、逐次の手順は不利な側。abstract のみ |
| Beyond Task Completion（https://arxiv.org/abs/2603.03116） | tau-bench | "27-78% of benchmark reported successes are corrupt successes concealing violations" | 手順の違反が成功に隠れる。コーディングではない |
| Workflow Fidelity（https://arxiv.org/abs/2605.06457） | 決済の手順 | "10 of 18 models systematically skip a confirmation checkpoint"。"Prompt changes and deterministic routing guards ... gains up to +93.8 percentage points for previously struggling models" | 手順の飛ばしを、決定的な routing の守りが直した例。コーディングではない。守りと prompt の変更の寄与は分離されない |
| COVENANT（https://arxiv.org/abs/2607.25400） | 手順の指示を workflow の構文木に変換して実行 | "improves benchmark success from 50.00% to 83.33%"、"workflow-misalignment failure rate from 42.50% to 15.83%" | abstract のみ。課題の種類は未確認 |
| Progressive Crystallization（https://arxiv.org/abs/2607.07052） | クラウド網の運用（AIOps） | "increased deterministic execution from 0% to 45% over eight months"、per-incident の agent 費用が 70% 超減 | 探索は agent、定着した手順は決定的な workflow に移す。レビューではない |
| OverclaimBench（10-22 の記録） | ファイル通読 | 不完全な実行の 80.4% が誤解を招く | 10-22 のとおり |

**測定の空白。** レビューの段取りを code が持つ場合と agent が持つ場合で、必須の段の完走率を比べた測定は、どの検索でも見つからなかった。製品側の数字（Bugbot、Greptile）が測るのは『指摘の質』で、『必須の段を飛ばさない』ではない。

### レンズ 4. 現場

**code が手順を持つ側（Claude Code の Workflow ツールの issue。gh で本文を直接読んだ。issue は否定側に偏る）。**
- #66023（open、2026-06-07）: "a code-review orchestration" の一回の実行が "46 subagents consuming ~2,986,845 subagent tokens / 791 tool uses in ~18 minutes" で、結果は捨てられた。subagent は主ループのモデル（Opus 4.8）を継承し、費用の確認が出なかった。
- #95816（open、2026-09-21）: 547 体を計画した検証段（"3 skeptics × ~180 findings, no cap"）で、約 180 体が走り "~36.6M tokens, ~$606, 4h15m"。
- #94911（open、2026-09-17）: 検証役が一回目で 33/33 全て `pass: false`、各 10〜26 件を指摘し、約 137 回の呼び出しで使える出力が無かった。報告者は検証の強さを課題の重みに結ぶ上限が無かったと書く。
- #96546（open）: 並行した別のセッションの内容が agent() の返りに混ざった報告。#93728（open）: rate limit のあとも待機中の agent を起動し続ける（circuit breaker 無し）。
- 数: Workflow に関する open の issue は、検索の上限の 12 件が全て該当（2026-10-23）。多くは Windows の改行、検証器の誤拒否、resume の不具合など、新しい機能の初期不良の類い。
- 文書側の対策は存在する: 25 体超または推定 150 万トークン超で `Large workflow` 警告。ただし警告は助言で、"it doesn't pause or limit the run"（workflow 文書）。

**code が手順を持つ、ハーネスをまたぐ外部ツール。**
- nrslib/TAKT: ★1,416、作成 2026-01-25、最終 push 2026-10-23、open issue 52、v0.72.0（gh api）。README: "Planning, implementation, review, and fix loops are defined in YAML workflow files, so the process is not left to the agent's discretion."、"Adding more rules to prompts, `CLAUDE.md`, or skills can help, but it cannot enforce the process."、"Reviews cannot be silently skipped."。provider は Claude Code・Codex・OpenCode・Pi・Cursor・Copilot CLI・Kiro・DeepSeek Harness（https://github.com/nrslib/takt）。維持の実態（issue 一覧、2026-10-23）: Pi SDK を 1.1.0 から 1.4.0 へ、DSH SDK を 0.2.1-alpha.2 から rc.2 へ更新する作業が open。provider ごとの SDK と権限の移行（`claude` が `claude-sdk` の別名になり古い `provider_profiles.claude` が効かなくなる点）を README が注意書きにする。OAuth の可否は provider ごとに違う旨の注意もある。これは、ハーネスをまたぐ orchestrator が負う維持の負担の実例で、TAKT が壊れているという証拠ではない（推論）。
- 他の大規模な orchestrator: ruvnet/ruflo ★78,512、code-yeongyu/oh-my-opencode ★70,277、Yeachan-Heo/oh-my-claudecode ★40,187（いずれも 2026-10-22 から 23 に push、gh api）。説明文のみを確認し、中身と品質は評価していない。レビュー手順の完走を測った数字は持たない。
- Anthropic のハーネス内蔵: Workflow ツールと `/workflows`（上記）。

**agent が手順を持つ側（10-22・10-23 の記録のとおり）。** superpowers の #2372・#2282・#2451、claude-code の #80988、claude-code-action の #1632・#1823。今回新たに確認した、手順を持つ側にまたがる数字は無い。

### レンズ 5. 複数ハーネスの設定・規則ツールは orchestrator を持つか

調べた範囲では、持たない。全て gh api と README を直接読んだ（2026-10-23）。

| ツール | ★ | 最終 push | 扱うもの | 実行エンジン |
|---|---|---|---|---|
| dyoshikawa/rulesync | 1,545 | 2026-10-22 | rules・ignore・mcp・commands・subagents・skills・hooks・permissions・checks を 30 前後のツールの形式に書き出す | 無し。`checks` は `.rulesync/checks/*.md` を Cursor の `.cursor/BUGBOT.md`、Amp の `.agents/checks/`、TAKT の `quality_gates` に書き出す（`src/features/checks/*.ts`）。レビューの観点を宣言し、実行は各ツールが持つ |
| intellectronica/ruler | 2,951 | 2026-10-22 | rules、skills、subagents（"experimental, default: disabled"） | 無し。subagent の primitive が無いツールは "skipped with a warning" |
| wshobson/agents | 41,573 | 2026-10-19 | 一つの Markdown の出典から 7 つのハーネスへ plugin・agent・skill・command を生成 | 無し。"A harness is the coding tool that loads and runs the components"、commands は "Named workflows you invoke" で散文 |
| obra/superpowers | 303,789 | 2026-10-22 | skill、SessionStart の bootstrap、小さなスクリプト（台帳）。約 10 のハーネスに配る | 無し（10-23 の記録）。skill の振る舞いは別リポジトリの drill eval で試験 |
| pstack | 13,628（cursor/plugins） | 2026-10-22 | 散文の playbook | 無し（10-17 と 10-22 の記録） |
| nrslib/TAKT | 1,416 | 2026-10-23 | YAML の workflow | 有り。ただし設定の同期ツールではなく、実行する CLI |

- なぜ宣言的に留まるかを書いた資料は、README・文書・issue のどこにも見つからなかった。書かれているのは扱う対象の一覧と、機能が無いツールでは飛ばすという方針だけ。理由は推論の域を出ない（`[unverified]`: 各ハーネスの実行環境が違い、手順を実行する責任を設定ツールが負うと全ハーネスの実行環境に追従することになる、というのが TAKT の SDK 追従の実態と整合する）。
- 重なる点: rulesync は、実行エンジンを持つ TAKT に対しても宣言の書き出しだけを行う。宣言と実行を分けるという分担が、実装の中で見える。

## 方式別の表

| 方式 | 前例（出典） | 課題の種類 | 結果 | 費用の数字 | 名前のついた失敗 |
|---|---|---|---|---|---|
| A. 外枠をコードが持ち、段の中で agent（製品版） | Anthropic Code Review、CodeRabbit（自称）、ultrareview | PR のレビュー | 独立した比較は無い。Anthropic の内部数字は二次資料のみ | ultrareview は $5〜$25 と 15〜25 分。Code Review に定価無し | 固定の外枠の硬さ（Greptile v2、Bugbot の旧 pipeline）。skip が success になる（10-23 の #1632） |
| B. agent の loop が主導（製品版） | Bugbot の現行、Greptile v3、Copilot、claude-code-action | PR のレビュー | Bugbot 52% から 70% 超（40 実験全体）、Greptile の action rate 34.75% から 59.24%（自社） | Greptile は文脈トークンが約 3 倍、自社ホスト版は推論費用が 75% 減。Bugbot は数字無し | CodeRabbit が挙げる "loop forever"、"agents calling everything, just in case"。必須の段の保証は無い |
| C. 散文の skill が段取りを持つ（手元のレビュー） | `/code-review`（同梱 skill）、公開 code-review プラグイン、superpowers、pstack | 手元のレビュー、開発手順 | 完走率の測定は無い | skill の実行は通常の使用量 | 10-22 の記録（飛ばし、偽りの完了報告、compaction での脱落） |
| D. skill + 宣言的な機械検査 | 10-23 の記録（hook、台帳） | 完了の検査 | 完走率の測定は無い | hook は LLM 呼び出し無しなら 0 | 10-23 の記録（上限、古い痕跡、自己記述） |
| E. 決定的な routing の守りだけを足す | 決済の手順（arXiv 2605.06457） | 決済 | 飛ばす 10/18、守りと prompt で最大 +93.8 ポイント | 無し | コーディングではない |
| F. ハーネスに内蔵された workflow | Claude Code の Workflow | 大規模な調査・移行・レビュー | 完走率の測定は無い | #66023 の約 300 万トークン、#95816 の約 $606 | 費用の暴走、検証役の誤拒否（#94911）、Claude Code 限定、No mid-run user input |
| G. ハーネスをまたぐ外部の orchestrator | TAKT | 計画・実装・レビューの loop | 測定無し | 数字無し | provider の SDK への追従、権限と認証の移行、OAuth の規約の注意 |
| H. 宣言だけを書き出す設定ツール | rulesync、ruler、wshobson/agents | 設定の配布 | 手順の完走を測った数字は無い | 無し | 機能が無いハーネスでは skip（ruler の "skipped with a warning"） |

## 否定側の証拠（方式ごと）

- **code が手順を持つ側の否定。** (1) 費用の暴走が、レビューの orchestration そのもので報告されている（#66023、#95816）。(2) 検証役の誤拒否で、使える出力が出ない（#94911）。(3) 固定の外枠は、見つけに行く先を実行中に変えられない（Greptile の例、"System will never see that third file"）。(4) ハーネス内蔵の workflow は Claude Code でしか動かない。(5) 外部の orchestrator は provider の数だけ追従の作業が生じる（TAKT）。(6) 規則がスクリプトの中に入り、読みにくくなる（10-22 の記録が引く `2026-10-19-review-redesign.md` の判断理由。house の記録は証拠として使わない）。
- **agent が手順を持つ側の否定。** 10-22・10-23 の記録のとおり。決済の課題で 10/18 モデルが確認を飛ばした測定が、別の領域で同じ向きを示す。
- **宣言的な検査の否定。** 10-23 の記録のとおり（エージェントが書いたファイルは証拠にならない、古い痕跡、上限）。今回新しく加わる点は無い。
- **『常に code が正しい』への否定。** Bugbot と Greptile は、固定の外枠から離れて質が上がったと自社で報告している。ただし、どちらも『必須の段を飛ばさない』という性質は、持ち主が求める保証と別の軸である。
- **『常に agent が正しい』への否定。** Anthropic は製品版では段の列をインフラに持たせている。Progressive Crystallization は、探索を agent、定着した手順を決定的な workflow に移す方向で費用を 70% 超下げた。
- **チャネルの偏り。** ベンダーのブログと文書は自社の選択を良く書く（Bugbot、Greptile、CodeRabbit は自社の数字）。issue は否定に偏り、どれも一人の報告。論文の多くは abstract のみを読み、決済・tau-bench・AIOps などコーディングではない。レビュー製品の第三者比較は、順位が測る側によって変わる。

## 判断（推論。前例の組み合わせで、測定はされていない）

1. **二者択一の前例は無く、前例が支えるのは混在である。** 製品版は外枠を code、段の中を agent にし、手元のレビューは散文の skill にしている。同じ Anthropic が両方を出している。違いは手順の質の好みではなく、実行環境の持ち主（基盤を持つか、利用者のハーネスの中か）で説明できる。
2. **jig のような複数ハーネスの設定ツールが実行エンジンを持つ前例は、調べた範囲に無い。** 宣言を各ハーネスの形式に書き出すところまでが共通で（rulesync、ruler、wshobson/agents、superpowers）、実行エンジンを持つのは別の CLI（TAKT）だけ。持つ場合、TAKT の issue 一覧が示すとおり provider の追従が継続の作業になる。これは house の既存の決定（実行エンジンを作らない、レビュー手順は skill と agent に置く）と矛盾しない向きの証拠だが、決めるのは持ち主である。
3. **手順の完走を守るために code が要るのは、観測できる下限に限るのが、前例と最も整合する。** 決済の測定は、決定的な routing の守りが確認の飛ばしを直したことを示す。レビューに当てはめると、起動した reviewer の集合、検証の件数、heavy のときの二度目のレビューの記録を数える層になる。これは 10-23 の記録の判断と同じ結論で、今回の調査で動いていない。
4. **ハーネス内蔵の workflow を、heavy な経路だけに使う選択肢は、前例の範囲にある。** 条件は、Claude Code でしか動かないこと、費用の暴走の報告があること、持ち主が決めた方式の外にあることの三つ。jig が実行エンジンを持たずに済む形で、他のハーネスでは skill と機械検査に落とす。ただしこの案に当たる完走率の測定は無く、#94911 の検証役の誤拒否は、検証段を code に移しても品質の問題は消えないことを示す。
5. **決定の前に残る確認。** 10-22 の記録の判断 1（事故の原因が散文の弱さか、subagent の起動の抑制か）は、今回の結論の前に必要なまま。起動の抑制が原因なら、orchestrator は効く可能性が高く（起動を code が決めるため）、宣言的な検査は『飛ばされた』の検出に留まる（推論）。

## 前例なし（見つからなかったもの）

- レビューの段取りを code が持つ場合と agent が持つ場合で、必須の段の完走率を比べた公開の測定。
- 固定の段取りの製品が、agentic な loop から固定の段に戻した公開例（レビュー製品で）。逆向き（固定から agentic）は Bugbot と Greptile。
- 複数ハーネスの設定・規則の同期ツールが、実行エンジンを持つ例（TAKT は別系統の CLI で、設定の同期をしない）。なぜ持たないかを説明した資料も見つからなかった。
- Codex の GitHub レビュー、Copilot code review、Graphite の内部の段取りの公開記述。
- Hamel Husain、Eugene Yan による、この問いを直接扱った投稿（到達できなかった可能性あり）。
- 独立した第三者の比較に Anthropic の Code Review と Bugbot の agentic 版を両方含むもの（Martian の結果は検索要約のみで、Claude Code Review は含まれていなかった）。
- Workflow ツールで作ったレビューの完走率や、他のハーネスへ移植した例。
