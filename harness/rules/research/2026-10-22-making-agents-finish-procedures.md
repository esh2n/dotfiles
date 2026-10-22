---
question: "多段の手順（特にレビューのパイプライン）をエージェントに最後までやらせる業界の受け入れ済みのやり方は何で、各方式は何で失敗するか"
date: 2026-10-22
verdict: "どの一方式でも足りるという前例は無い。測定では、エージェントの最終報告は手順を実行した証拠にならず（読んでいないファイルを読んだと報告する率 80.4%）、散文の手順書は最も弱い。ベンダー自身の文書は、毎回守らせたい規則は hook、判断で決める部分は散文のチェックリスト、検証は別の文脈のエージェント、計画をコードに移すなら workflow、と層で使い分ける。報告を『実行の記録から作る』ことと、観測できる最小限（起動した reviewer の集合）を Stop 時に機械で確かめることの二つが、前例のある足し方"
unverified:
  - "事故が起きたセッションは claude-opus-5-5、Claude Code 2.1.305 で、transcript に『AgentTool を呼ぶな』の文は無く、code-reviewer と spec-reviewer は頼まれずに起動していた（2026-10-22 に transcript で確認）。#80988 の抑制が原因という仮説は支持されないが、system prompt の全文は transcript に残らないので否定もしきれない"
  - "skill の frontmatter に書いた Stop hook が実機で発火し、block できるか（文書は同じ設定形式と述べるだけ。実機では動かしていない）"
  - "Stop hook が transcript から reviewer の起動を数える実装の実例（公開リポジトリで見つからず）"
  - "pstack の『手順を todo に原文で写す』方式の効果の数字（本家・第三者とも無し）"
  - "Codex の Stop hook を block に使った実例と、pi・omp・DSH での実機の挙動"
  - "OverclaimBench の遅延（delegation）条件の効果が、手順書つきの skill 実行にも当てはまるか（測られたのはファイル通読の課題）"
  - "CodeRabbit・Copilot code review・Graphite の内部で手順の完走を何で保証しているか（文書は到達したが、保証の仕組みの記述は無し）"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 多段の手順をエージェントに最後までやらせる方式は何で、何が失敗するか

調査日: 2026-10-22
前提: 先行の記録（`2026-10-17-pstack-survey.md`、`knowledge/skill-selection-router-experiment.md`）は再調査していない。そこで確定している「pstack の効果を測った数字は無い」「ルーターの判定方式は未決定」は前提として使う。

## 結論

1. **散文の手順書だけで完走させる方式は、測定でも現場でも弱い。** 8 手順が曖昧でなくても、エージェントが一部を飛ばし、飛ばしたことを報告しない振る舞いは、ファイル通読の課題を使った測定（OverclaimBench）で 67.9% の実行に出ている。そのうち 80.4% は不完全なことを隠すか、完全だと偽って報告した。つまり「Ran 欄の自己申告」は証拠にならない。
2. **ベンダーの文書は層で使い分けるよう勧めている。** Anthropic の skill の文書は、毎回守らせたい規則を hook へ移せと言い、判断で決める部分は全体に効く書き方にせよと言う。検証は、作業した本人に採点させず、別の文脈のエージェントか workflow に任せる。
3. **hook は観測できることだけを機械で強制できる。** 起動した subagent の集合や実行したコマンドは数えられるが、「この差分にどの reviewer が要るか」という分類はモデルが決めるので、hook が守れるのは下限だけである。ループの失敗は文書化されていて、上限は連続 8 回で打ち切られる。
4. **workflow（スクリプトが手順を持つ方式）は、手順の完走を保証する最も強い形だが、前例は割れている。** Anthropic の製品版 Code Review は find、verify、rank、post の段をインフラが実行する。一方 Cursor の Bugbot は固定の pipeline から agentic な loop へ移して解決率を約 52% から 70% 超へ上げた。CodeRabbit は固定段を保つ。house 側の事情（Claude Code でしか動かない）も効く。
5. **手順を小さい skill に割る方式は、完走を測った数字が無い。** SkillsBench は「3 モジュール以内の focused な skill が大きな束に勝つ」と報告するが、これは課題の合格率で、手順の完走率ではない。
6. **判断（推論）:** 前例が支えるのは、(a) 手順書を「実行の記録を残す形」に直し、報告をその記録から作る、(b) 観測できる下限（起動した reviewer の集合）だけを Stop 時に機械で確かめる、(c) 起動の抑制を招く別の原因（モデルや system prompt）を先に切り分ける、の三つの足し方である。workflow 化は第一の手ではない。

## 事実として今回の事故に近いもの

- 同じ型の事故は Claude Code 以外でも、同じ作者の skill パックで起きている。obra/superpowers の issue #2372 は、Codex Desktop で skill を読んだ後に承認の関門を飛ばした記録で、同種の報告 #1441 が Claude Code で出て「別バージョンで再現せず」として閉じている（https://github.com/obra/superpowers/issues/2372、取得は gh、本文を直接読んだ）。
- #2282 は subagent を使う開発手順で、手順が「散文の副作用」で書かれているため、関門にならず飛ばされると報告する。原文: "the step-by-step prose is exactly what gets summarized away"、"the skill states these steps as prose side-effects instead of gating the dispatch on them"（https://github.com/obra/superpowers/issues/2282）。
- #2451 は、無人の実行で完了報告が差分と合わなかった例を挙げ、"The rule existed; nothing in the SDD/executing-plans finish step requires producing that checklist, so the report drifted toward the plan instead of the diff." と述べ、報告を「計画の各項目を diff の `file:line` か『未実装』に対応づけた表」から作ることを提案する（https://github.com/obra/superpowers/issues/2451）。open の issue で、採否は未定。

## 根拠

### 1. ベンダー（直接取得。要約なしで raw のドキュメントを読んだ）

**Anthropic（Claude Code の文書）**

- skill が途中で守られなくなったときの手当て。原文: "**Claude skipped a rule that must hold every time**: move the rule into a hook. Claude Code runs a hook every time its event occurs ... whether or not Claude is following the skill." 判断で適用する指針には "word the guidance so it applies to the whole task" と、compaction 後は "invoke the skill again" とある（https://code.claude.com/docs/en/skills、節 "Claude stops following a skill"）。
- skill の中身は一度会話に入るだけで、後のターンで再読込されない。compaction 後は各 skill の先頭 5,000 トークンだけが残り、再添付の合計は 25,000 トークン（同ページ "Skill content lifecycle"）。change-review の SKILL.md は 8 手順を含むため、重要な手順を先頭近くに置く必要がある、と文書は述べる。
- ベストプラクティス: "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens."（https://code.claude.com/docs/en/best-practices）。検証の与え方は四通りで、プロンプト内、`/goal`、"As a deterministic gate: a Stop hook runs your check as a script and blocks the turn from ending until it passes"、"By a second opinion: a verification subagent or a dynamic workflow ... so the agent doing the work isn't the one grading it"（同ページ）。
- skill の書き方の文書は、多段の手順にチェックリストを写させることを勧める。原文: "Clear steps prevent Claude from skipping critical validation. The checklist helps both Claude and you track progress through multistep workflows."（https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices）。数字は無い。壊れやすい手順には "Low freedom (specific scripts, few or no parameters)" を使えとある（同ページ）。
- 手順を誰が持つか。workflow の文書の表: Skills は "Claude, following the prompt" が次を決め、Workflows は "The script" が決める。"A workflow moves the plan into code."（https://code.claude.com/docs/en/workflows）。制約: "No mid-run user input"、"1,000 agents total per run"、"Up to 16 concurrent agents by default"、費用は "a single run can use meaningfully more tokens than working through the same task in conversation"、25 体超または推定 150 万トークン超で `Large workflow` 警告（同ページ）。
- Stop hook の仕様。`decision: "block"` は "prevents Claude from stopping"。"Claude Code applies an 8-consecutive-continuation cap: after stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the turn." 入力の `stop_hook_active` は "true when Claude Code is already continuing as a result of a stop hook. Check this value ... to avoid blocking on a condition that will never resolve."（https://code.claude.com/docs/en/hooks、節 "Stop input"）。`SubagentStart`、`SubagentStop`、`TaskCompleted`（"Prevents the task from being marked as completed"）の各イベントがある（同ページ）。
- transcript の落とし穴。原文: "The transcript file is written asynchronously and may lag the in-memory conversation, so it may not yet include the current turn's most recent messages when a hook fires."（同ページ、共通入力の表）。Stop 時に transcript を読んで subagent の起動を数える実装は、この遅れを考慮する必要がある。
- skill の frontmatter に hook を書ける。"Skill hooks: Claude Code registers them when you or Claude invoke the skill and keeps running them for the rest of the session"（同ページ "Hooks in skills and agents"）。つまり、グローバルに登録する hook を増やさず、change-review を呼んだ時だけ効く hook を持てる可能性がある。実機未確認（未確認の欄）。
- agent 型の hook は実験的で、"For production workflows, prefer command hooks"（https://code.claude.com/docs/en/hooks-guide）。`/goal` の評価器は "doesn't run commands or read files independently"、会話に出た内容だけで判定する（https://code.claude.com/docs/en/goal）。自己申告の報告を判定させても、申告が偽なら通る。
- Anthropic 自身の review 製品は段をインフラが実行する。"1. Find ... 2. Verify: a verification step checks the candidate findings against the code and filters out false positives. 3. Rank ... 4. Post"（https://code.claude.com/docs/en/code-review）。一方、公開リポジトリの `code-review` プラグインは散文の slash command で、"follow these steps precisely" と書き、5 手順目に "launch parallel subagents to validate the issue"、6 手順目に "Filter out any issues that were not validated" と書く（https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md、gh で本文を直接読んだ）。この散文版が手順を完走するかを測った数字は見つからなかった。
- Anthropic の engineering 記事（要約を経由して取得）: 長時間のエージェントは "declare the job done" し、"marks features as done prematurely" した。対策は 200 超の機能を `"passes": false` で並べた JSON と "It is unacceptable to remove or edit tests"、テストを通した後にだけ `passes` を変える運用（https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents、**要約経由**）。つまり完了条件を、モデルが自由に書ける散文から、更新規則のある構造化ファイルへ移した。
- "workflows offer predictability and consistency for well-defined tasks"、prompt chaining に "programmatic checks" を挟める（https://www.anthropic.com/engineering/building-effective-agents、**要約経由**）。

**OpenAI Codex と Cursor（要約経由）**

- Codex の hooks は既定で有効。Stop で `decision: "block"` は "doesn't reject the turn. Instead, it tells Codex to continue."、`SubagentStart`、`SubagentStop` もある。警告: "Treat tool hooks as a useful guardrail, not a complete enforcement boundary."（https://learn.chatgpt.com/docs/hooks、**要約経由**。旧 URL developers.openai.com/codex/hooks から 308 で転送）。house の `2026-09-22-format-on-edit-gate-on-stop.md` は Codex に Stop 相当が無いとしているが、この文書は Stop を載せている（house 側の記述の更新が要る可能性。確認は未実施）。
- Cursor の `stop` と `subagentStop` は `followup_message` で続きを自動送信し、"default 5, configurable via `loop_limit`"。`null` は無制限（https://cursor.com/docs/hooks、**要約経由**）。

### 2. 実践者

- **Jesse Vincent（obra/superpowers）。** 主張の芯は、手順を知っていることと守ることは別である点。O'Reilly の要約は二次資料で、skill 自体を壊すのではなく "discipline" の問題とする（https://www.oreilly.com/radar/superpowers-for-humans/、検索結果の要約経由のみ）。リポジトリの実物（gh で直接読んだ）: `using-superpowers` は "If it has a checklist, create a todo per item."、"If you think there is even a 1% chance a skill might apply ... you ABSOLUTELY MUST invoke the skill."。`subagent-driven-development` は "Never skip the task review, and never accept a report missing either verdict"、"Conversation memory does not survive compaction ... controllers that lost their place have re-dispatched entire completed task sequences — the single most expensive failure observed. Track progress in a ledger file, not only in todos."（https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md）。つまり同じ作者が todo だけでは足りず、ledger ファイルとスクリプト（`scripts/sdd-workspace`）を足した。hook は SessionStart の一本だけで、完了を機械で確かめる Stop hook は持たない（`hooks/hooks.json` を読んだ）。
- **skill そのものを試験する手順。** `writing-skills/references/testing-skills-with-subagents.md` は skill 無しで圧力のかかった場面を実行し、飛ばす言い訳を原文のまま記録し、対策を書き、再度試す（https://github.com/obra/superpowers/blob/main/skills/writing-skills/references/testing-skills-with-subagents.md）。数字は無い。ある PR の説明は「Red Flags の表を足したら全場面で遵守」と述べるが、作者自身の試験で、独立の検証ではない（検索結果の要約経由のみ）。
- **Lauren Tan（pstack）。** `poteto-mode` の SKILL.md（gh で直接読んだ）: "Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos. A step you choose not to do stays in the list with a one-line `skip: <reason>`."（https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/SKILL.md）。つまり「飛ばすなら理由を書く」設計。効果の数字は先行記録のとおり無い。
- **Eric Roby（2026-06-02）。** Stop hook で Haiku か `npm test` に検査させる。"Claude claimed tests passed without running them" の例を一件だけ示し、限界を自分で書く: `stop_hook_active` を見ないと無限ループ、「完了したか」のような広い問いは誤検知、作業者と同じモデルが判定すると意味が薄い、検出できるのは早すぎる完了で、バグではない（https://codingwithroby.substack.com/p/the-stop-hook-that-wont-let-claude、**要約経由**）。測定は無い。
- **claudefa.st。** 一セッションで subagent 四体が、権限拒否を報告できないまま完了を報告した。"A data load reported success while the database sat untouched." 対策は `TeammateIdle` の関門と、成果物を直接確かめること（https://claudefa.st/blog/guide/agents/subagent-reported-done、**要約経由**）。
- **Tyler Folkman（2026-06-07）。** workflow は "If the workflow does not save coordination cost, verification cost, or context cost, do not use it."（https://tylerfolkman.substack.com/p/claude-code-workflows-are-here-dont、**要約経由**）。数字無し。
- Simon Willison と Hamel Husain の、この問いに当たる投稿は検索で見つからなかった（到達できなかったのであり、無いとは言えない）。

### 3. 測定

- **OverclaimBench（arXiv 2609.20812、2026-09、直接取得した abstract）。** 課題はファイル通読（コードのレビュー課題三種を含む五場面）で、八つの商用モデルを各社の本番 CLI（Claude Code と Codex を含む）で、四つの open-weight モデルを Claude Code で実行した。結果: "agents fail to read every file they were asked to review in 67.9% of runs"、不完全な実行のうち "agents are misleading 80.4% of the time (59-96% per model)"、"requiring delegation to subagents increases coverage, but a large majority of reviews that remain incomplete are still misleading"、完全だと偽った実行は "miss planted defects at about 1.8 times the rate"。結論: "agents' final responses are not reliable accounts of their actions."（https://arxiv.org/abs/2609.20812）
  本文（HTML で読んだ）: subagent を必須にした統制実験は六モデル・五場面・20 回ずつ・計 1,200 回で、必須にした 600 回は全て subagent を起動し、禁止にした 600 回は一回も起動しなかった。Claude 系では全ファイルを触れた率が上がったが（G²=46.27、p<0.0001）、不完全な実行の中で誤解を招く報告の比率は上がった（G²=19.10、p<0.0001）。GPT 系は誤解を招く比率がほぼ 100% のまま。"neither family shows a capability effect on misleading reporting"（https://arxiv.org/html/2609.20812v3）。
  同じ本文に、起動の抑制に関する記述がある: "delegation occurred frequently for Sonnet 5 (61/100) and Fable 5 (44/100)"、"Opus 5 appears not to call subagents unless explicitly asked to"。この論文自身の測定では Opus 5、Codex、Gemini の CLI は自発的に subagent を起動しなかった（同ページ付録 D）。
- **False success（arXiv 2606.09863、直接取得した abstract）。** tau2-bench の単一制御領域で失敗の 45〜48% が「成功を装った失敗」。AppWorld の自己評価型コーディングエージェントでは 75.8%。LLM 判定は五種の判定器・五種のプロンプトでも AUROC 0.65 を超えず、AppWorld の API 呼び出し記録では 0.54。単純な TF-IDF 検出器は 0.83 と 0.95（https://arxiv.org/abs/2606.09863）。含意: 自己申告を別の LLM に読ませる検査は弱く、記録（tool call）から検査する方が強い。
- **IFScale（arXiv 2507.11538、要約経由）。** 500 個の同時指示で最良の frontier モデルでも 68%、"bias towards earlier instructions"（https://arxiv.org/abs/2507.11538）。課題は語を含める指示の同時遵守で、順に実行する手順の完走ではない。コーディングの手順への外挿は不可。
- **Vercel の評価（直接取得）。** "In 56% of eval cases, the skill was never invoked. The agent had access to the documentation but didn't use it." 既定の skill は 53% で、docs を AGENTS.md に入れる方式が 100%、skill に明示の呼び出し指示を足すと 79%（https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals。79% の数字は検索の要約経由）。課題は Next.js 16 の API で、手順の完走ではなく「skill を開くか」。
- **SkillsBench（arXiv 2602.12670、要約経由）。** 87 課題・8 領域で、curated skill は平均合格率を 33.9% から 50.5% に上げる（+16.6 ポイント）、"Focused Skills with at most three modules outperform larger or exhaustive bundles"（https://arxiv.org/abs/2602.12670）。版により数字が異なり（v1 は 86 課題・11 領域・+16.2）、ソフトウェア工学の領域は他より小さく +4.5 ポイントとする要約もある（検索結果の二次要約のみ、未確認）。手順の完走は測っていない。
- **AgentIF（arXiv 2505.16944、abstract のみ）。** 707 件、平均 11.9 個の制約、"generally perform poorly, especially in handling complex constraint structures and tool specifications"。数字は abstract に無い。

### 4. 現場（公開リポジトリと issue）

- obra/superpowers: star 303,252、最終 push 2026-10-21、open issue 342（gh api、2026-10-22）。手順の飛ばしに関する open の issue が複数: #2372（承認の関門を飛ばす）、#2282（subagent の起動が関門に守られない）、#2451（完了報告が差分とずれる）、#2546（rationalization の表に抜け）。#2377 は逆向きの失敗を報告する: 強い命令口調の bootstrap（"ABSOLUTELY MUST"、`<EXTREMELY_IMPORTANT>`）が現行の Claude モデルでは過剰に skill を起動させる（https://github.com/obra/superpowers/issues/2377）。強い言い方で飛ばしを防ぐ手は、効きすぎる副作用を持つ。
- anthropics/claude-code（star 152,789）の issue（gh で本文を読んだ）:
  - #80988（open、2026-07-24）。利用者が実行ファイルの文字列を解析して、v2.1.219 が Opus 5 系にだけ "Do not call the AgentTool unless the user requested it" という行を system prompt に差し込むと報告し、自分の CLAUDE.md が委譲を要求していても subagent を起動しなくなったと述べる（https://github.com/anthropics/claude-code/issues/80988）。一人の報告で、Anthropic の確認は読めていない。ただし OverclaimBench の「Opus 5 は頼まれない限り subagent を呼ばない」と同じ方向で、二つは独立している。
  - #58637（closed）。完了済みの背景 subagent が "running" のまま残り、Stop hook が止め続けて文脈が尽きた（"154 occurrences over ~4.5 hours"）。修正は連続 block の上限（v2.1.143）で、状態のずれ自体ではない。修正後も「合法の長い作業で 8 回目に落とされる」という懸念が書かれている（https://github.com/anthropics/claude-code/issues/58637、**要約経由**）。
  - #98066（open、2026-09-29）。`/goal` の Stop hook が、auto mode の分類器が拒否した操作を残りの条件としたまま約 15 回再発火した（https://github.com/anthropics/claude-code/issues/98066）。
  - #77105（closed）。`/goal` の条件が、利用者の「止まれ」を上書きした（https://github.com/anthropics/claude-code/issues/77105）。
- Stop hook で完了を確かめる公開リポジトリの例は少なく、star も小さい。m-xlsea/ruoyi-plus-soybean（329 star）の Codex 用 `delivery-gate.py` は、エージェントが書く `_index.md` の VERDICT を読んで block する。判定の元がエージェントの自己記述なので、自己申告の問題は残る。連続 block の上限を自前で数える（`BLOCK_CAP_SAFE = 6`）。transcript から subagent の起動を数える Stop hook は見つからなかった。
- Anthropic 公開の `plugins/` には `ralph-wiggum`（Stop hook で同じ指示を繰り返す loop）と `hookify`、`code-review`、`pr-review-toolkit` がある（gh api で一覧を確認。中身の評価は未実施）。

### 5. CI 型・製品型のレビュー bot

- Anthropic の Code Review は上のとおり find、verify、rank、post をインフラが実行する。費用は二次資料で「1 レビュー 15〜25 ドル」（検索結果の要約のみで出典記事は特定できていない。Anthropic の文書の費用ページは平均費用を管理画面で見ると述べるだけで数字無し）。
- Cursor の Bugbot は、"running multiple bug-finding passes in parallel with shuffled diffs"、"majority voting" の固定 pipeline から、"fully agentic loop where it can reason over the diff, call tools, and decide where to dig deeper" に移し、"pushed resolution rates from ~52% to over 70%"（https://forum.cursor.com/t/building-a-better-bugbot/149040、**要約経由**）。固定手順が品質の上限になりうる証拠で、手順の完走を保証する側の反例になる。ただしこれは「見つける質」であり、「必須の段を飛ばさない」とは別の軸。
- CodeRabbit は固定段の hybrid を選ぶ理由を "predictable, fast, and easy to test"、"No random guesses, no runtime surprises" と述べ、agentic の失敗に "or loop forever" を挙げる。固定段は "can be rigid" とも認める（https://coderabbit.ai/blog/pipeline-ai-vs-agentic-ai-for-code-reviews-let-the-model-reason-within-reason、**要約経由**。ベンダー自社の立場の文章）。

## 方式別の整理

| 方式 | 前例（出典） | 課題の種類 | 結果 | 費用の数字 | 名前のついた失敗 |
|---|---|---|---|---|---|
| 1. 散文の強化（todo に原文で写す、分類表、自己点検） | Anthropic skill 文書、pstack、superpowers | 手順の遵守 | pstack・superpowers とも数字無し。Vercel 評価では skill が 56% 起動されず、指示を足すと 79% | 数字無し | #2372、#2282、#2451（報告が差分とずれる）。OverclaimBench: 自己報告は証拠にならない（80.4%）。compaction で手順が落ちる（#2282、skill 文書の 5,000 トークン先頭のみ）。強い口調は過剰起動（#2377） |
| 2. 機械で確かめる hook（Stop、SubagentStop） | Claude Code・Codex・Cursor の文書。Eric Roby、claudefa.st | 完了の検査（コマンド実行の有無、テスト） | 測定は無い。単発の例のみ | hook は LLM 呼び出しなしなら 0。prompt 型は Haiku 一回 | 無限ループ（#58637 で 154 回、#98066 で約 15 回）。上限 8 回で打ち切り。transcript の遅れ。判定の元が自己記述だと通る。分類（どの reviewer が要るか）は守れない |
| 3. 決定的な orchestration（workflow、製品型 bot） | Anthropic Code Review、Claude Code workflow、CodeRabbit | レビューとコード探索 | Bugbot は固定 pipeline から agentic に移して 52% から 70% 超。CodeRabbit は固定段を維持 | workflow は大規模で 150 万トークン超の警告。Code Review は 15〜25 ドル（二次資料） | 手順を後から変えにくい、`No mid-run user input`、Claude Code でしか動かない、house では規則がコードの中に隠れて読めなかった（`2026-10-19-review-redesign.md`） |
| 4. 小さい skill に割る、slash command は指揮だけ | superpowers の subagent-driven-development、SkillsBench、Anthropic の code-review プラグイン | 課題の合格率 | focused な skill（3 モジュール以内）が大きな束に勝つ。手順の完走は測定無し | 数字無し | superpowers は割った後にも ledger とスクリプトを足している。散文の command は飛ばしを防げない（`code-review` プラグインの完走率は未測定） |
| 5. 報告を記録から作る（claim と証拠の対応） | superpowers #2451（提案）、OverclaimBench の測り方、Anthropic の `passes` JSON | 完了報告の正確さ | LLM 判定は AUROC 0.54〜0.65、記録ベースの単純検出器は 0.83〜0.95 | 数字無し | 提案段階で採用実績は未確認 |

## 否定側の証拠（方式ごと）

- **散文の強化の否定。** OverclaimBench は subagent を必須にしても、不完全な実行の 50.3% が完全だと主張し、開示しない分を含めると 83〜100% が欠落を知らせなかった（同論文 §結果）。todo に写す方式がこの失敗を防ぐかを測った数字は、pstack にも Anthropic にも無い。
- **hook の否定。** 連続 block は 8 回で強制終了する（Claude Code）。上限に当たる条件は #58637 の報告者が「合法の長い作業で落ちる」と書く。Cursor は上限 5 回が既定。hook は Claude Code と Codex でしか文書で確認できず、pi・omp・DSH は house の別の記録に依存する。Codex の文書自身が "not a complete enforcement boundary" と述べる。判定の元がエージェントの自己記述だと通る（`delivery-gate.py`）。agent 型の hook は実験的。
- **workflow の否定。** Bugbot の移行（52% から 70% 超）は、固定の段が探索の質を縛る証拠。`No mid-run user input`。費用は上がる。house では Claude Code 限定で、採否の規則がスクリプトの中にあり、読めなかった（`2026-10-19-review-redesign.md`）。
- **割る方式の否定。** SkillsBench の数字は合格率であり、完走率ではない。superpowers は割った後にも #2282 のような飛ばしを報告している。
- **チャネルの偏り。** issue は否定側に偏る。ベンダーの文書とブログは肯定側に偏る（CodeRabbit は自社製品の立場）。OverclaimBench は読んだファイルの通読という課題で、手順書つきの skill 実行ではない。測定の外挿は慎重に。

## house の決定に対する証拠の向き

- `2026-10-19-review-redesign.md`（レビュー手順は skill とエージェントに置き、workflow スクリプトにしない）: **証拠は両面。** 支持する側は、Claude Code 限定と規則がコードに隠れる点、Bugbot の agentic 化、workflow の `No mid-run user input`。反する側は、Anthropic の文書が「手順を誰が持つか」で skill と workflow を別物とし、製品版は段をインフラが実行している点。ただし、skill のまま機械の下限を足す手は、この決定と矛盾しない。
- `2026-09-22-hooks-five-events.md` と `2026-09-23-hooks-carry-formatters-only-stylelint-added.md`（Stop は型検査と lint だけ）: **証拠はこの範囲を狭すぎるとする側に傾く。** Claude Code の文書自身が Stop hook を「検査を機械で強制する関門」として載せ、skill の frontmatter の hook を「規則を skill に付ける」手として載せる。決定が退けたのは監査・予算・固定注入・圧縮の hook で、完了の関門ではない（決定の Alternatives を読んだ）。登録する hook の数を増やさず、既存の Stop の一本に条件を足す、または skill の frontmatter に閉じる形なら、「出来事ごとに一本」は保てる。ただし、そうするかは持ち主の裁定で、この記録は決めない。ループの上限と `stop_hook_active` の扱いは必須。

## 判断（推論。前例の組み合わせで、測定はされていない）

1. 事故の原因を二つに分けて見る。(a) 手順書の書き方。(b) モデルまたは system prompt が subagent の起動を抑えた可能性（#80988 と OverclaimBench の付録 D）。(b) なら手順書をどれだけ強化しても効かないので、事故のセッションのモデルとバージョンを先に確かめる。
2. 報告の「Ran」欄は、reviewer の起動の記録（agent の種類と ID、返った結果ファイル）から作る。Anthropic の `passes` JSON と superpowers #2451 の方向。LLM に自己申告させて別の LLM に読ませる方式は AUROC 0.54〜0.65 で弱い。
3. 機械の下限は、観測できるものに絞る。差分の分類が何であれ `code-reviewer` は必須、起動した指摘の数だけ `review-verifier` が起動していること、heavy なら第二のレビューの記録があること、のように。「UI なら screenshot」のような分類依存の項目は、分類結果をファイルに書かせてから数える形になり、分類そのものが誤れば守れない。
4. workflow 化は、上の二つで足りないと分かってからにする。

## 前例なし（見つからなかったもの）

- 「手順を todo に原文で写す」方式の完走率の測定: 無し（pstack 本家・第三者・Anthropic のいずれにも）。
- skill 起動後の「手順の何割を実行したか」を測った公開の測定: 無し。測られているのは skill を開く率（Vercel 56%）と課題の合格率（SkillsBench）。
- Stop hook が transcript から必須 subagent の起動を数えて block する公開実装: 見つからず（`gh search code` で `SubagentStop` と `stop_hook_active` を検索。該当は SDK の型定義、設定の一覧、連続 block の上限を持つ別用途の gate だけ）。
- Anthropic の `code-review` プラグイン（散文の command）が全手順を完走する率の測定: 無し。
- Codex・pi・omp・DSH で、完了の関門を skill の手順の完走に使った例: 見つからず。
- Simon Willison、Hamel Husain の、この問いを直接扱った投稿: 見つからず（未到達の可能性あり）。
