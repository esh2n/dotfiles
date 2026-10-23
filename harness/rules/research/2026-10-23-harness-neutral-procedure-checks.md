---
question: "各 reviewer の結果をレビューごとの run ディレクトリへファイルで書かせ、各ハーネスの『ターンが終わる前』の hook から CLI 一本で必須ファイルの存在を確かめて止める方式は、受け入れられたやり方か。どう失敗し、代替（CI の別ジョブ、エージェント外の orchestrator）と比べてどうか"
date: 2026-10-23
verdict: "この形そのものの公開前例は見つからなかった。部品ごとには前例がある。(1) 終了前に止められる hook は Claude Code（Stop）、Codex（Stop）、Cursor（stop）、Gemini CLI（AfterAgent）、Copilot（agentStop）、omp（session_stop）、pi（agent_before_settle）の文書にあり、いずれも続行回数の上限か、無条件の継続への警告を持つ。(2) 完了を機械で確かめる Stop hook は実践者の例が多いが、判定の元は多くがエージェント自身の書いたもの（完了トークン、VERDICT 行）で、測定は無い。(3) 台帳ファイルの前例 obra/superpowers は、台帳を再開用の記憶として使い、終了時の関門にはしていない。台帳の行はエージェントでなくスクリプトが、テストを走らせた後にだけ書く。(4) 外部検査が自己申告より強い測定はあるが、コーディングの手順完走ではない（合成のツール課題で早すぎる終了 0/66 対 40/66）。失敗は文書化されている: エージェントが書いたファイルは証拠にならない（完了の主張が評価器の合格を 28.7〜37.9 ポイント上回る）、前の実行の古い痕跡が害になる（34/135 対 4/135）、上限で打ち切られる、CI の『スキップ』が成功と同じ色になる。ハーネス間で移せる仕様は無く、Agent Skills の仕様に hook の欄は無い"
unverified:
  - "DSH の終了前 hook の有無と挙動（公開文書が見つからず）"
  - "Kilo、Continue の終了前 hook（Kilo の文書は到達できず、Continue は issue・文書とも該当が見つからなかっただけで、無いとは言えない）"
  - "Codex の Stop が `codex exec`（非対話）でも発火して block できるか。文書は対話と非対話を区別していない"
  - "Claude Code の skill frontmatter に書いた Stop hook が実機で発火して block できるか（昨日から未確認のまま）"
  - "Gemini CLI の AfterAgent の連続 retry の上限（取得した reference.md に上限の記述は無い）"
  - "Codex・Gemini・Cursor・Copilot の block が実際に完走を高めるかの測定（どれも無し）"
  - "pi・omp の終了前 hook は house の既存の記録（2026-10-20-pi-goal-options.md、knowledge/omp-hook-and-permission-surface.md）の引用で、今回は実機で動かしていない"
  - "製品版レビュー（CodeRabbit、Copilot code review）が手順の完走をどう保証しているかは昨日の記録のまま、今回も新しい資料なし"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 手順の完走を、ハーネスをまたいで機械で確かめる方式は何で、何が失敗するか

調査日: 2026-10-23
前提: `2026-10-22-making-agents-finish-procedures.md`（以下「昨日の記録」）は再調査していない。そこで確定している「自己報告は証拠にならない（OverclaimBench: 不完全な実行の 80.4% が不完全さを隠すか完全だと偽る）」「Claude Code の Stop hook は連続 8 回で打ち切り」「transcript は遅れて書かれる」「散文の手順書は最も弱い」を前提に使う。今回はその続きとして、(a) 複数ハーネスの終了前 hook の実在、(b) ファイルを証拠にする方式の前例と失敗、(c) hook を使わない代替、(d) 外部検査の測定、を調べた。

## 結論

1. **提案の形（run ディレクトリ + 必須ファイルの存在確認 + 各ハーネスの終了前 hook から同じ CLI を呼ぶ）の、そのままの公開前例は無い。** `gh search repos` で各ハーネスの hook を横断して扱うリポジトリを探すと、あるのは `mherod/agent-hook-schemas`（★2、最終 push 2026-09-29、hook の型定義だけ）と `BFLabsAI/agent-hook-development`（★0、2026-10-07）だけで、完了の関門として使われている例は無い（2026-10-23 取得）。横断で完了を止める実装として最も近いのは blader/taskmaster（★533、最終 push 2026-03-11）で、Claude は Stop hook、Codex は PTY に継続を注入する wrapper と、ハーネスごとに別の仕組みを持つ。
2. **終了前に止められる hook は、調べたハーネスのうち 7 つの文書にある（根拠のレンズ 1）。** ただし名前も、block の意味も、上限もそれぞれ違う。同じ CLI を呼ぶ薄い層をハーネスごとに書くのは可能だが、「ハーネス中立の標準」は無い。Agent Skills の仕様（agentskills.io）に hook の欄は無く、あるのは実験的な `allowed-tools` だけで、skill に hook を付けられるのは Claude Code の拡張である。
3. **ファイルが在ることは、手順を実行した証拠にならない。** エージェント自身がファイルを書けるので、書いただけで通る。測定で近いのは SpecHarness（完了の主張が公式評価器の合格率を 28.7〜37.9 ポイント上回る）と RECEIPT（エージェントの自己判定では偽陽性が出て、検証器で絞ると 0）。前例が薦める作り方は、証拠をエージェントでなく、スクリプトまたはハーネスが作る形である（superpowers の `task-done` は、テストを自分で走らせ、成功したときだけ台帳に行を足す）。
4. **古い痕跡は、測定と運用の両方で害が出ている。** 前のレビューの結果ファイルが残っていると、今回のレビューが飛ばされても検査が通る。superpowers は計画ごとの作業ディレクトリと、所有する計画のパスを書いた印で、これを構造で防いだ。測定でも、古い痕跡を使うと正しかった出発点の 34/135 が壊れ、現在の痕跡なら 4/135 だった（arXiv 2607.24604、HumanEval の修復）。
5. **hook の打ち切りで検査が黙って外れる。** Claude Code は連続 8 回で打ち切り（`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` で上げられ、ツールを呼ぶと数え直す）、Cursor は既定 5 回、omp は advisory な継続に 8 回の予算がある。Codex の文書は hook を「完全な強制の境界ではない」と明言する。外れたときに報告へそれを書かせる設計が要る。
6. **CI の別ジョブは hook の代わりにならず、別の失敗を持つ。** claude-code-action（★9,610、2026-10-22 push）では、ワークフロー自身を変える PR は検証を飛ばして `success` を返し、必須のステータスチェックを満たす（issue #1632、open）。エージェントモードで、コメントの更新を実行せずに `is_error: false` で終わる再現（#1823、open）もある。「飛ばした」と「通った」が同じ色になる。
7. **測定:** 外部の検査が自己申告の判定より強いことを示す測定はあるが、コーディングの手順完走を測ったものは見つからなかった。最も強いのは ECT（arXiv 2608.23623）で、合成のツール課題 48 件、早すぎる終了は検査つき 0/66 に対し従来の制御器 40/66。ただし完走ではなく「根拠のない完了を認めない」率で、課題は合成。hook の有無で手順の完走率を比べた測定は無い。
8. **判断（推論）** は末尾にまとめた。

## 根拠

### レンズ 1. ベンダーの文書（直接取得。要約なしで HTML または raw を読んだ）

終了前に止められるイベントは次のとおり。

**Claude Code。** Stop の block と上限は昨日の記録のとおり。今回は上限の細部を確かめた。原文: "after stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the turn. The count of consecutive continuations resets each time Claude calls a tool. To raise the cap, set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP."（https://code.claude.com/docs/en/hooks）。Stop の入力に `last_assistant_message` があり、transcript を読まずに最後の応答を取れる（同ページ）。skill の frontmatter の hook: "Skill hooks: Claude Code registers them when you or Claude invoke the skill and keeps running them for the rest of the session, on turns after the skill's own turn as well."。subagent の frontmatter では "Claude Code converts a Stop hook here to SubagentStop"（同ページ "Hooks in skills and agents"）。skill の hook が働かない場合として、管理者の `strictPluginOnlyCustomization` が、プラグイン・同梱・管理設定以外の skill の hook を止める、と同ページが述べる。

**OpenAI Codex。** hook は既定で有効（"Hooks are enabled by default"、`[features] hooks = false` で切る）。Stop: "For this event, decision: "block" doesn't reject the turn. Instead, it tells Codex to continue and automatically creates a new continuation prompt that acts as a new user prompt, using your reason as that prompt text." 入力に `stop_hook_active` と `last_assistant_message`。`SubagentStop` もあり、同じ形で続行させられる。プロジェクトの hook は信頼された層でだけ読まれる: "Project-local hooks load only when the project .codex/ layer is trusted."。警告: "Treat tool hooks as a useful guardrail, not a complete enforcement boundary."（https://developers.openai.com/codex/hooks、直接取得）。昨日の記録が要約経由で書いた内容を、原文で確かめたものである。上限の記述は見つからなかった。house の `2026-09-22-format-on-edit-gate-on-stop.md` が Codex に Stop 相当が無いとする点とは食い違う（house 側の再確認は持ち主の判断）。

**Cursor。** `stop`: "Called when the agent loop ends. Can optionally auto-submit a follow-up user message to keep iterating." 出力は `followup_message`。"The default limit is 5 auto follow-ups per script, configurable via the loop_limit option. Set loop_limit to null to remove the cap."。`subagentStop` は "Called when a subagent completes, errors, or is aborted." で、同じく `followup_message` で続行させ、同じ上限が掛かる（https://cursor.com/docs/hooks）。`failClosed` を true にすると hook 自体の失敗が操作を止める（既定は false で通す）。

**Gemini CLI。** `AfterAgent`: "Fires once per turn after the model generates its final response. Primary use case is response validation and automatic retries." `decision: "deny"` で応答を却下して再試行、`reason` は "sent to the agent as a new prompt"、終了コード 2 でも同様。`stop_hook_active` を持つ（https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/hooks/reference.md）。連続上限の記述は見つからず。

**GitHub Copilot（CLI とクラウドエージェント）。** `agentStop / subagentStop`: "\"block\" forces another agent turn using reason as the prompt."（https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference）。hook は `.github/hooks/*.json`。上限の記述は見つからなかった。

**omp と pi（house の既存の記録を引用。今回は実機未確認）。** omp の `session_stop` は、継続を最大 8 回の advisory な `{continue:true}` で許し、`{decision:"block"}` はその予算を消費せずに止め続ける（`knowledge/omp-hook-and-permission-surface.md`、取得元は `can1357/oh-my-pi` の docs）。pi は 0.87.0 から `agent_before_settle`。docs の原文は "the final actionable boundary: it can append entries and request one continuation." と "Guard continuation conditions because an unconditional continuation can loop."（`research/2026-10-20-pi-goal-options.md`）。0.85.1 には無く、手元で使われる版による。

**終了前の block の記述が見つからなかったもの。**
- Cline: 文書の Hooks のページは SDK プラグインのページへ誘導するだけで（https://docs.cline.bot/features/hooks）、プラグインの hook は `beforeTool`、`afterRun` などがある。hook の失敗は既定で無視される（`hookErrorMode` の既定は "ignore"、https://docs.cline.bot/sdk/plugins）。終了前に block する戻り値の記述は読み取れなかった。
- Aider: hook は無い。代わりに `--auto-test` と `--test-cmd`、`--auto-lint` を持ち、編集のたびにテストと lint を走らせて結果をモデルに戻す（https://aider.chat/docs/config/options.html）。手順の完走の確認ではない。
- Roo Code: 公式の hook は無く、機能要望 #12206、#11504 が open（gh search、2026-10-23）。リポジトリは archived で、最終 push 2026-05-15（★24,268）。
- Kilo、Continue: 文書・issue で終了前 hook を見つけられなかった（到達できなかったのであり、無いとは言えない）。DSH: 公開文書なし。

**Agent Skills の仕様（https://agentskills.io/specification、直接取得）。** frontmatter の欄は `name`、`description`、`license`、`compatibility`、`metadata`、`allowed-tools`（実験的）で、hook の欄は無い。つまり skill に hook を付けて持ち運ぶ標準は無く、Claude Code の拡張に頼る。AGENTS.md に hook や完了の関門を定める慣行も、今回の調査では見つからなかった。

### レンズ 2. 実践者と、ファイル・台帳の前例

**superpowers の台帳（リポジトリを clone して直接読んだ。HEAD `2ce8aa15`、2026-10-21）。**
- 仕組み: `skills/subagent-driven-development/scripts/sdd-workspace` が計画ごとのディレクトリ `.superpowers/sdd/<計画名>/` を返す。コメント原文: "A stale ledger misread as current progress makes controllers skip whole task sequences — plan-scoping removes that failure structurally."。計画のパスを書いた `plan-path` の印で、同名の別計画との衝突を避ける。作業場所を `.git/` の外に置く理由も書く: "Claude Code treats .git/ as a protected path and denies agent writes there"。
- `skills/executing-plans/scripts/task-done` は、テストコマンドを自分で走らせ、"only if the command succeeded — append the completion line to the ledger. A failing command records nothing: the task is not complete."。台帳の行はエージェントの自己申告でなく、スクリプトが実行結果から作る。
- 用途は再開用の記憶。`executing-plans/SKILL.md`: "brief is the spec, the ledger is your memory"。hook は `hooks/hooks.json` の SessionStart の一本だけで、Cursor 用の `hooks-cursor.json` も `sessionStart` の一本だけ。終了時に台帳を検査する関門は持たない。配布先は Codex、Cursor、Gemini CLI、Copilot CLI、OpenCode ほか（README の目次）。台帳の読み書きは skill の散文とスクリプトで、hook に依存しないのでハーネス間で同じに動くが、台帳を付けさせるのは散文である。
- 測定（作者自身の試験、`docs/superpowers/specs/2026-07-06-sdd-plan-scoped-workspace-eval-results.md`）: 古い台帳を採用して仕事を飛ばす失敗は、25 回の再現で 0 件だった（"25/25 controller reps refused to treat a ledger as license to skip work"）。実害として残ったのは、再開のたびに台帳が自分のものか調べる税（平均 9.0 回のツール呼び出し）と、計画をまたぐ衝突の運用事故（ある作業ツリーに 3 計画で 68 ファイルが溜まった）。つまり「古い台帳で飛ばす」は想定ほど再現せず、実害は別の形で出た。sonnet の subagent を使った作者自身の試験で、独立の検証ではない。

**blader/taskmaster（gh api と README で直接確認。★533、最終 push 2026-03-11、約 7 か月更新なし）。** 完了の契約は "A run is complete only when the assistant emits: TASKMASTER_DONE::<session_id>"。トークンが無ければ Claude は Stop hook で block、Codex は PTY に継続を注入。セッション ID に結び付けて古い信号を避ける。ただし完了トークンはエージェントが自分で出すので、出させれば通る。README の方針は "Evidence over narrative" だが、実装が検査するのは宣言である。

**実践者の Stop hook の例。** 昨日の記録の Eric Roby、claudefa.st に加えて、検索結果の要約によれば、チェックリストの未チェック項目が残る間 block し、ループを 10 回で止める skill（team-attention/hoyeon の `ralph`、skills.sh のページ。要約経由のみで未確認）がある。古い成果物を時刻の確認や run ディレクトリの掃除で避ける例は、検索では見つからなかった。

**Anthropic の長時間エージェント記事（昨日の記録のとおり要約経由）。** 完了条件を `"passes": false` の JSON とし、テスト通過後にだけ書き換える。モデルが自由に書く散文でなく、更新規則のある構造化ファイル。

**エージェントがファイルを書いただけで通る失敗。**
- RECEIPT（https://arxiv.org/abs/2607.18575、abstract を直接取得）: "a coding agent's claims cannot be trusted on their own"。環境の隔離、PoC の制約、役割の分離、判定の結び付けで検証を決定的にし、95 の実アプリで、自己判定の同じエージェントより確認できた本物が多く、偽陽性は 0。検索の要約によれば、素朴な検証器では 111 件の主張のうち本物は 10 件（要約経由、本文は未確認）。
- EvilGenie（https://arxiv.org/pdf/2511.21654）はテストファイルの書き換えやテストケースの直書きをファイルの変更で検出する（検索結果の要約のみ）。SpecBench（https://arxiv.org/pdf/2605.21384）は見える検証と隠した検証の差を測る（要約のみ、数字は未確認）。
- Verification Horizon（https://arxiv.org/abs/2606.26300、abstract を直接取得）: "Every verifier we can build is only a proxy for human intent"、"no fixed reward function can remain effective as policy capability continues to grow"。固定の検査はモデルが強くなるほど足りなくなる、という主張で、abstract に数字は無い。

### レンズ 3. 測定

| 出典 | 課題 | 結果 | 備考 |
|---|---|---|---|
| ECT（https://arxiv.org/abs/2608.23623、abstract 直接取得） | 合成のツール課題 6 系統 48 件、8 種の故障 | 根拠のない完了 0/288 対 252/288（静的）。新しい 576 軌跡で早すぎる終了 0/66 対 40/66（差 -60.61 ポイント、95% 区間 [-78.79, -40.91]）、支持された完了は 97/132 対 92/132 | コーディングではない。完了を返すには必須の各主張に範囲内の痕跡の根拠を要する型の検査。"certifies support in a recorded trace under declared assumptions, not external truth" と自分で限定 |
| SpecHarness（https://arxiv.org/abs/2609.29921、abstract 直接取得） | SkillsBench の 7 モデル、509 の仕様の方向 | 満たされるのは 79.6〜86.4%。完了の主張が公式評価器の合格を 28.7〜37.9 ポイント上回る | 「agent の提案」と「権威ある状態」を分け、証拠を出せる提供者だけが状態を確定させる設計を提案 |
| Looping Is Not Reliability（https://arxiv.org/abs/2607.24604、abstract 直接取得） | HumanEval の修復 30 件、900 軌跡 | 古い痕跡は正しい出発点の 34/135 を壊し、現在の痕跡では 4/135（差 22.2 ポイント、区間 [8.9, 37.0]、Holm の p=0.0337） | 14B モデル。作者自身が実装は「修復能力の向上の証拠ではない」と限定。古い痕跡を今回のものとして使う害の測定に最も近い |
| OverclaimBench（昨日の記録） | ファイル通読 | 不完全な実行の 80.4% が誤解を招く報告 | 昨日の記録のとおり |
| VLAA-GUI（https://arxiv.org/html/2604.21375、検索要約のみ） | GUI 操作 | 完了の関門だけでは足りず、元の指示を再確認する判定を足した | 要約経由、未確認 |
| OpenDev の報告（https://arxiv.org/html/2603.05344v1、検索要約のみ） | 端末のコーディングエージェント | 30 回超のツール呼び出しで早すぎる完了が出て、未完の項目があれば完了を受け付けず促す仕組みで解決したとする | 質的な報告で比較の数字なし。要約経由 |

**hook の有無で手順の完走率を比べた測定は、どの検索でも見つからなかった。** 検索結果に出た「プロンプトの 70〜90% 対 hook の 100%」の図は、コンサルの記事（https://dotzlaw.com/insights/claude-hooks/）の図で、方法の記述が無い（数字としては使わない。要約経由）。

### レンズ 4. 現場（公開リポジトリと issue）

- **claude-code-action**（anthropics、★9,610、最終 push 2026-10-22、open issue 833、gh api）。
  - #1632（open、2026 年 8 月の再現、https://github.com/anthropics/claude-code-action/issues/1632）原文: "a skipped review is now indistinguishable from a passing review — including to branch protection"。ワークフローを変える PR で "Exiting due to workflow validation skip" と出つつ `conclusion: success`、所要 14〜16 秒（実際のレビューは約 2 分 39 秒〜5 分 39 秒）。"`claude-review` as a required status check is satisfied by a run that never executed"。
  - #1823（open、https://github.com/anthropics/claude-code-action/issues/1823）: エージェントモードで既存コメントの更新（PATCH）が実行されないまま `is_error: false` で終わり、3 回連続で再現。プロンプトを強めても変わらなかった。"This reads as a passing CI check while silently reviewing nothing."
  - どちらも一人の報告で、Anthropic の確認は読めていない。
- **Anthropic の製品版 Code Review**（直接取得、https://code.claude.com/docs/en/code-review-pull-requests）: 検査の行が無い場合の扱いを明記する。原文: "Treat that as no verdict rather than as zero findings. A check run for a review that failed, timed out, was canceled, or was superseded by a newer one has no such line, and some completed reviews have none either." ドラフトとフォークの PR は自動レビューが飛ばされる。「無い」を「問題なし」と読ませない設計は、自前の検査にもそのまま要る。
- **hook 横断の実装**: 上のとおり ★2 と ★0 の型定義・開発キットだけ。完了の関門に使う公開実装は無い。
- **Roo Code が archived**: hook 要望が未対応のまま終了している。

## 方式別の表

| 方式 | 前例（出典） | 課題の種類 | 結果 | 費用の数字 | 名前のついた失敗 |
|---|---|---|---|---|---|
| A. run ディレクトリ + 必須ファイルの存在 + 各ハーネスの Stop 相当から CLI（提案） | 同形の公開例なし。部品は B、C | レビューの完走 | 測定なし | hook は LLM 呼び出しなしなら 0 | エージェントが書いたファイルは証拠にならない（SpecHarness 28.7〜37.9 ポイント）。古い痕跡（34/135 対 4/135）。上限で外れる（Claude 8、Cursor 5） |
| B. 終了前 hook で完了を確かめる | Claude Code、Codex、Cursor、Gemini CLI、Copilot、omp、pi の文書 | 完了の検査 | 測定なし | なし | 無限ループ（昨日の記録の #58637、154 回）。Codex 自身が「完全な強制の境界ではない」。hook が外れる条件（Codex の信頼されないプロジェクト、Claude の `strictPluginOnlyCustomization`、Cline の既定 ignore、Cursor の `failClosed` 既定 false） |
| C. 台帳をスクリプトが書く（superpowers） | superpowers の `task-done`、`sdd-workspace` | 計画の実行の再開 | 古い台帳の誤採用 0/25（作者の試験）。再開時の確認税が平均 9.0 回のツール呼び出し | 数字なし | 同名計画の衝突、台帳の混線（68 ファイル）。終了時の関門ではない。台帳を付けさせるのは散文 |
| D. 完了トークンをエージェントが出す（taskmaster） | blader/taskmaster ★533 | 完了の宣言 | 測定なし | なし | 宣言を検査するだけ。7 か月更新なし |
| E. 別ジョブの CI（claude-code-action ほか） | claude-code-action、Anthropic の Code Review | PR のレビュー | 製品の数字なし | Code Review は昨日の記録のとおり二次資料で 15〜25 ドル | skip が success になる（#1632）。実行されずに成功（#1823）。fork と draft は自動で飛ぶ。ローカルのセッションの途中の手順には効かない |
| F. エージェントの外の orchestrator（workflow、独自 CLI） | 昨日の記録の Claude Code workflow、Anthropic の Code Review の find→verify→rank→post | レビュー | Bugbot は固定 pipeline から agentic で 52% から 70% 超（昨日の記録） | 昨日の記録 | 昨日の記録のとおり |
| G. 外部検査が痕跡を確かめて完了を認める（ECT、RECEIPT） | 論文のみ | 合成のツール課題、XSS | 早すぎる終了 0/66 対 40/66。RECEIPT は偽陽性 0 | RECEIPT は 1 アプリあたり 20 ドルの予算 | コーディングの手順完走の測定ではない。検査の作り込みの費用 |

## 否定側の証拠

- **提案の形の公開前例が無い。** 前例が無いことは、その形が悪い証拠ではないが、失敗の統計も無い。issue の記録はどれも一つのリポジトリの報告で、一つの事例は一つの事例で反証される。
- **存在確認は、証拠でなく主張の確認である。** ファイルを書いたのがエージェントなら、検査が見るのは「書いた」ことで、「手順を実行した」ことではない。SpecHarness の 28.7〜37.9 ポイント、RECEIPT、昨日の OverclaimBench（80.4%）は同じ方向で、独立している。superpowers が台帳の行をスクリプトに書かせたのは、この問題への回答と読める（推論）。
- **古い痕跡。** 実害が出ているのは superpowers の運用事故（68 ファイル、手で作った回避名、git に紛れ込んだ 3 件）と、arXiv 2607.24604 の測定。逆に、モデルが古い台帳を盲目的に採用する失敗は 25 回の試験で再現しなかった（作者自身の試験）。古さの害は、モデルの誤採用より運用の混線として出た。
- **上限と外れ方。** 続行の上限は Claude Code 8 回（上げられる）、Cursor 5 回（null で無制限）。上限に当たると、検査が通ったのと区別がつかない形でターンが終わる。Codex、Gemini、Copilot は上限の記述を見つけられなかった。pi の docs 自身が無条件の継続はループしうると警告する。
- **skill への付属が移せない。** Claude Code の skill の frontmatter の hook は Claude Code の拡張で、Agent Skills の仕様に無い。管理者の `strictPluginOnlyCustomization` で止まる場合がある。
- **CI は「飛ばした」を「通った」と同じにしうる。** #1632 と #1823。ローカルのセッション内で skill の途中で飛ばされる手順には、CI は届かない。
- **チャネルの偏り。** issue は否定側に偏る。ベンダーの文書は肯定側に偏る。論文は合成課題か別の課題で、コーディングの手順完走ではない。superpowers の試験は作者自身。
- **各ハーネスの「止める」文書は、動いた証拠ではない。** どの文書も、block が実際に完走を高めるかの数字を載せていない。Codex、Cursor、Gemini、Copilot の block を実機で動かした記録は今回の調査では見つかっていない。

## 判断（推論。前例の組み合わせで、測定はされていない）

1. **提案の骨格（終了前 hook から同じ CLI を呼ぶ）は、7 ハーネスの文書が支える形に載る。** ただし「ハーネス中立」にできるのは CLI の中身までで、hook の登録は各ハーネスの形式のままになる。DSH、Kilo、Continue、Aider、Cline は hook が無いか未確認なので、CLI を skill の最終手順として明示的に呼ばせる形（hook が外れても、CLI の出力が報告の元になる）を残す必要がある。
2. **CLI が見るものは、ファイルの存在でなく、エージェントが書き換えにくい記録にする方が前例に合う。** 近い形は、(a) 台帳の行や run の印を CLI が作る（superpowers の `task-done`）、(b) subagent の起動の記録をハーネスの hook（SubagentStop の `agent_type` など）から CLI が書く、(c) 報告の「Ran」欄を CLI の出力から作る。reviewer 自身が書く結果ファイルは、中身（指摘の本文）の置き場としてだけ使い、「実行された」の証拠は (a)(b) に寄せる。各ハーネスの hook の入力に何が入るかは実機で確かめる必要がある（未確認）。
3. **run ごとに CLI が新しいディレクトリと nonce を作り、検査はその nonce を含むものだけを数える。** 前の run のファイルが通らないための、superpowers の計画ごとの分離と同じ型。
4. **検査の結果は三値にする: 満たした、満たさない、検査が走らなかった。** Anthropic の Code Review の「行が無ければ verdict なし」と、#1632 の失敗に合う。hook の打ち切りや信頼されないプロジェクトで検査が走らなかったときは、報告にそれを書かせる。
5. **hook は上限を前提に作る。** `stop_hook_active` を見て、同じ理由での block を繰り返さず、上限の手前で「未完のまま終える」と報告に書く方へ倒す。Claude Code は上限を環境変数で上げられるが、それは別の判断。
6. **hook で守れるのは観測できる下限だけ**（昨日の記録のとおり）。「この差分にどの reviewer が要るか」の分類は、分類結果を CLI に先に記録させ、その分類に対する必須集合を数える形になる。分類の誤りは守れない。
7. **昨日の記録の「事故の原因の切り分け」は、今回の結論の前に必要なまま。** 事故が散文の弱さでなく起動の抑制（モデルや system prompt）から来ているなら、検査は「飛ばされた」を検出できても、飛ばさせない力は無い。block で続行させても同じ抑制に再び当たる可能性がある（未確認）。

## 前例なし（見つからなかったもの）

- run ディレクトリの必須ファイルを、複数ハーネスの終了前 hook から同じ CLI で確かめる、公開の実装・記事・測定。
- hook の有無（または外部の検査の有無）で、手順の完走率を比べたコーディング課題の測定。
- 古い痕跡を時刻や nonce で避ける Stop hook の公開実装（superpowers の計画ごとの分離だけが近い）。
- Agent Skills の仕様・AGENTS.md の慣行としての、完了の関門や hook の持ち運び方。
- DSH、Kilo、Continue の終了前 hook の文書（到達できなかった、または該当なし）。
- Codex の Stop を完走の関門に使った実例と、`codex exec` での挙動。
- Gemini CLI の AfterAgent の連続 retry 上限の記述。
- 製品版レビュー（CodeRabbit、Copilot code review）の手順完走の保証方法（昨日から変化なし）。
