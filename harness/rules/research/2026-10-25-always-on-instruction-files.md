---
question: "毎回のセッションに読み込まれる指示ファイル（Claude Code の CLAUDE.md、agents.md 規格の AGENTS.md、Cursor の rules、Gemini CLI の GEMINI.md など）は、何を書き、何を書かず、どの長さに収め、一つ一つの規則をどう書き、どう保守するのが受け入れられたやり方か。各方式は何で失敗するか"
date: 2026-10-25
verdict: "ベンダーの文書は一致して『短く、具体的に、全セッションに当てはまることだけ』と書く。数字は Anthropic が 1 ファイル 200 行未満、Cursor が 1 規則 500 行未満、GitHub が約 1,000 行まで、Codex が合計 32 KiB で打ち切り、Windsurf が global 6,000 字と workspace の 1 ファイル 12,000 字。手順・一部の場所だけの規則・毎回必ず守らせる規則は、それぞれ skill・path 指定の rules か下位ディレクトリのファイル・hook か lint に移せとも一致して書く。測定はこの合意を半分しか支えない。指示の数を増やすと遵守は下がる（IFScale は 500 個で最良 68%、先行の記録）が、CLAUDE.md の行数（25〜500 行）・位置・矛盾を変えた要因実験では、単一の目印の遵守に差が出なかった（1,650 セッション、ベイズ因子は差なしを支持）。リポジトリ単位の context ファイルは課題の成功率をほぼ動かさず推論費用を 20% 以上増やし、LLM に生成させたファイルは成功率を 0.5〜2% 下げた（arXiv 2602.11988）。人が書いたファイルの効果は +2.4% で有意でない。効くと測られているのは、モデルが自分で見つけられない事実（使う道具、非標準の慣習）だけである。保守は『誤りを見たら一行足す』が実践者とベンダーの共通の型で、それが肥大の原因にもなり（2,303 ファイルの調査で、変更は削除でなく追加に偏る）、Anthropic は自社の system prompt の 80% 超を削っても評価が落ちなかったと書く。規則の書き方では、理由を添えるか（Anthropic は添えよ、pstack は省け）と強調語（Anthropic は一行だけ、強調は効きすぎる）で前例が割れ、コーディングでの測定は無い"
unverified:
  - "OpenAI の『harness engineering』記事（2026-02-11）の本文は 403 で読めず、AGENTS.md を約 100 行の目次にしたこと、一枚の大きな AGENTS.md が失敗した三つの理由は、二次資料の要約でしか確かめていない"
  - "openai/codex が 2026-09-30 に root の AGENTS.md（320 行）と .codex/skills を削除した理由（PR #49713 の本文に理由が無く、agents.md 側の issue #251 にも説明が無い）"
  - "Boris Cherny（Claude Code の作者）の『チームで一つの CLAUDE.md を git に入れ、週に何度も皆で足す』という発言は、二次資料の引用のみで原文（X の投稿）に到達していない"
  - "Codex が global の ~/.codex/AGENTS.md を project_doc_max_bytes（既定 32 KiB）の勘定に含めるか。文書は『合計の大きさ』と書くが、現在のソース（codex-rs/core/src/agents_md.rs）は project の文書だけで予算を数え始めるように読める。手元の版での挙動は動かしていない"
  - "Cursor の組み込み skill `create-skill`（pstack が agent 向けの文章の書き方として参照する）の本文。Cursor 製品に同梱で公開されておらず読めていない"
  - "Simon Willison、Armin Ronacher が指示ファイルの書き方そのものを論じた投稿。検索では見つからなかった（到達できなかったのであり、無いとは言えない）"
  - "大文字や IMPORTANT などの強調語が、コーディングの指示の遵守を上げるか下げるかの測定。注意の配分を測った研究（arXiv 2608.03711）はあるが遵守率ではない"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 毎回読み込まれる指示ファイルは、どう書き、どう保守するのが受け入れられたやり方か

調査日: 2026-10-25

前提: 次の先行の記録で確定していることは再調査せず、引用して使う。

- `2026-10-22-making-agents-finish-procedures.md`: IFScale（500 個の同時指示で最良のモデルでも 68%、前の方の指示に偏る）、Vercel の評価（skill が 56% の実行で開かれず、文書を AGENTS.md に入れる方式が 100%）、Claude Code の skill は一度だけ会話に入り compaction 後は先頭 5,000 トークンだけ残ること、Anthropic の文書の "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic"。
- `2026-10-23-harness-neutral-procedure-checks.md`: 各ハーネスの終了前 hook の有無と上限。
- `knowledge/clear-writing-checklist.md`: 人間の読者向けの説明文の書き方。今回は「モデルが読む指示」に絞った。

## 結論

1. **何を書くかについて、ベンダーの文書はほぼ一致している。** モデルがコードを読んでも分からないこと（使うコマンド、既定と違う慣習、落とし穴、環境の癖）だけを書き、モデルが既に知っている一般論、コードから分かる構成の説明、頻繁に変わる情報、長い説明は書かない。Anthropic・Cursor・GitHub・Windsurf の文書が同じ方向で、Anthropic の 2026-07 の記事は「蓄積した規則の多くを消してよい」とまで書く。
2. **長さの数字はベンダーごとに違い、どれも測定の根拠を示していない。** Anthropic は 1 ファイル 200 行未満、Cursor は 1 規則 500 行未満、GitHub は約 1,000 行まで（クラウドエージェント向けの生成プロンプトは 2 ページ以内）、Codex は合計 32 KiB で黙って打ち切る、Windsurf は global 6,000 字と workspace の 1 ファイル 12,000 字。agents.md の規格は長さを定めていない。
3. **置き場所の振り分けも一致している。** 多段の手順や時々しか要らない知識は skill（必要なときだけ読み込まれる手順書）へ、一部の場所だけに効く規則は path 指定の rules か下位ディレクトリの AGENTS.md へ、毎回必ず守らせたい規則は hook・lint・CI へ移す。長い文書は複製せず参照する。Claude Code の `@path` 取り込みは整理にはなるが、文脈の消費は減らない。
4. **測定は「短いほど良い」を一部しか支えない。** 指示の数が増えると遵守は下がる（IFScale、ManyIFEval）。一方、Claude Code で CLAUDE.md を 25・100・250・500 行に変えた要因実験では、単一の目印の遵守は 60.0%・65.2%・67.7%・64.0% で、差が無いことをベイズ因子が支持した。矛盾する指示を隣のファイルに置いても差は出なかった。最も大きく効いたのは、セッションの中で関数を一つ書くごとに遵守のオッズが約 5.6% 下がることだった。ただし測ったのは一つの易しい目印で、多数の規則が競う状況ではない。
5. **context ファイルそのものの効果は小さく、費用は確実に増える。** SWE-bench と新しい 138 課題で、LLM に生成させたファイルは成功率を 0.5% と 2% 下げ（有意差なし）、手順数と費用を 20% と 23% 増やした（有意）。開発者が書いたファイルは +2.4%（p=21%）で、費用は最大 19% 増えた。リポジトリの概要は役に立たず、書かれた道具の指示（`uv` など）はよく守られた。別の実験（Claude Code と Codex、288 回）でも正答率は動かず、失敗の原因は知識の不足でなく実装の力だった。逆に Codex だけの 124 PR の実験では、実行時間の中央値が 28.64% 短く、出力トークンが 16.58% 少なかった。
6. **保守の型は「誤りを見たら一行足し、根本を直したら消す」。** Mitchell Hashimoto は各行が一つの悪い振る舞いに対応すると書き、Addy Osmani は直したら消すと書く。Cursor と Anthropic の文書は git に入れてチームで直すよう書く。実態の調査では、変更は削除より追加に偏り（2,303 ファイル）、Claude Code の issue では「CLAUDE.md の必須規則が無視される」報告が 215 件ある。Anthropic は `/doctor prompt-audit` で古い規則と矛盾を探させる仕組みを出した。
7. **一つの規則の書き方で、前例が割れる点が二つある。** 理由を添えるかについて、Anthropic の prompting の文書は添えると一般化すると書き、pstack は理由を省いて混乱するときだけ説明せよと書く。強調語について、Anthropic は効かない一行だけに IMPORTANT を付けよと書く一方、新しいモデルでは "CRITICAL: You MUST" が過剰な起動を招くので弱めよとも書く（obra/superpowers #2377 で同じ失敗が出ている、先行の記録）。どちらもコーディングでの測定は無い。具体的で検証できる書き方（「2 スペースで字下げ」）、肯定形、命令形、矛盾を作らないことは前例が一致する。
8. **規則の理由（決定の経緯）を、モデルが読む指示から分けて置く慣行に、ベンダーの明文は無い。** 近いものは三つある。Claude Code はブロック単位の HTML コメントを読み込み前に取り除くので、人間向けの注記を文脈の費用なしに書ける。OpenAI の記事（二次資料経由）は AGENTS.md を目次にして `docs/` に詳細を置いた。Anthropic の claude-code リポジトリの CLAUDE.md は、規則と、それを機械で確かめる CI の検査と例外表の場所を並べて書く。
9. **pstack の立場は「規則を文章で増やさず構造に移す」。** `principle-encode-lessons-in-structure` は同じ指示を二度書きそうになったら lint・メタデータ・実行時検査・スクリプトにせよと言い、構造で直せるなら文章の指示は消せと言う。skill を書く手順は「迷ったら消す。判断を変える文章だけを残す」。同じリポジトリの continual-learning プラグインは逆に、会話の記録から AGENTS.md を自動で書き足す（各節 12 項目まで）。

## 凡例と方法

- **直接取得**: 本文を curl・`gh api` で取り、文字列を検索して原文を引いた。Anthropic の文書（code.claude.com の `.md` 版、platform.claude.com の `.md` 版）、Anthropic の engineering 記事と claude.com の blog、Codex の文書（learn.chatgpt.com へ転送）、agents.md のサイト、Cursor の文書（`.md` 版）、Gemini CLI の docs（GitHub の raw）、GitHub Docs の API 版、Windsurf（docs.devin.ai の `.md` 版）、OpenAI cookbook の GPT-5 prompting guide、arXiv の abstract（API）と本文（HTML または PDF）、公開リポジトリのファイルと commit・issue（`gh api`）。
- **要約経由**: WebFetch の要約モデルを通して読んだもの。本文中で「要約経由」と書いた。HumanLayer の記事、Mitchell Hashimoto の記事、Addy Osmani の記事、GitHub blog の 2,500 リポジトリの記事、Armin Ronacher の pi の記事、OpenAI の harness engineering の二次資料。
- **到達できなかったもの**: OpenAI の harness engineering 記事の本文（403、Wayback も 503）、Boris Cherny の X の投稿、Simon Willison の検索ページ（403）、Cursor の組み込み `create-skill`（非公開）。
- **推論**: 出典の組み合わせから引いた判断は「推論」と書いた。
- **チャネルの偏り**: ベンダーの文書は自社の機能に肯定側へ偏る。issue は否定側へ偏る。arXiv の論文は課題が狭い（SWE-bench の Python、単一の目印、合成の指示）。

## 根拠

### レンズ 1. ベンダー

**Anthropic（Claude Code の文書、直接取得）**

- 何を書くか。原文: "Keep it to facts Claude should hold in every session: build commands, conventions, project layout, "always do X" rules. If an entry is a multi-step procedure or only matters for one part of the codebase, move it to a skill or a path-scoped rule instead."（https://code.claude.com/docs/en/memory）
- 書き方。"Write instructions that are concrete enough to verify: "Use 2-space indentation" instead of "Format code properly""、長さは "**Size**: target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence."、取り込みについて "Imports help you organize a long file but don't reduce its context cost"、矛盾について "**Consistency**: if two instructions contradict each other, Claude may pick one arbitrarily."（同ページ "Write effective instructions"）。
- 強制力が無いこと。"Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook instead."、"CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself."（同ページ）。
- 保守の道具。`/doctor prompt-audit` は "instructions written for older models, references to files or commands that don't exist, and files that contradict each other" を探して修正案を出す（v2.1.283 以降、同ページ）。`/doctor` は "cuts content Claude can derive from the codebase, such as directory layouts, dependency lists, and architecture overviews, and keeps pitfalls, rationale, and conventions that differ from tool defaults."（同ページ "My CLAUDE.md is too large"）。200 行を超えると起動時と `/status` で警告が出る。下位ディレクトリの CLAUDE.md と path 指定の rules は、200K の窓で 40,000 字を超えると先頭しか渡されない（同ページ）。
- 人間向けの注記。"Block-level HTML comments (`<!-- maintainer notes -->`) in CLAUDE.md files are stripped before the content is injected into Claude's context. Use them to leave notes for human maintainers without spending context tokens on them."（同ページ）
- AGENTS.md との関係。v2.1.277 以降、CLAUDE.md が無ければ AGENTS.md を読む。散文で「AGENTS.md を読め」と書いた CLAUDE.md は "Claude sees `AGENTS.md` only if it decides to open the file." なので、`@AGENTS.md` の取り込みか symlink に替えよと書く（同ページ）。
- ベストプラクティスの表（https://code.claude.com/docs/en/best-practices、直接取得）。Include は "Bash commands Claude can't guess"、"Code style rules that differ from defaults"、"Common gotchas or behaviors that aren't self-evident" など。Exclude は "Anything Claude can figure out by reading code"、"Standard language conventions Claude already knows"、"Information that changes frequently"、"Long explanations or tutorials"、"File-by-file descriptions of the codebase"、"Self-evident practices like "write clean code""。行ごとの基準は "For each line, ask: *"Would removing this cause Claude to make mistakes?"* If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"。強調語は "If Claude keeps skipping one instruction, add emphasis such as "IMPORTANT" to that line alone. If you emphasize many lines, none of them stands out."。保守は "Treat CLAUDE.md like code: review it when things go wrong, prune it regularly, and test changes by observing whether Claude's behavior actually shifts."。失敗の型として "**The over-specified CLAUDE.md.** If your CLAUDE.md is too long, Claude ignores half of it because important rules get lost in the noise."。
- Thariq Shihipar（Anthropic）の記事 "The new rules of context engineering for Claude 5 generation models"（2026-07-24、https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models、直接取得）。数字: "We removed over 80% of Claude Code's system prompt for models like Claude Opus 5 and Claude Fable 5 with no measurable loss on our coding evaluations."（評価の方法は公開されていない）。失敗の観察: "we found that we were overconstraining Claude Code, both through our system prompt and in our CLAUDE.md files and skills."、"we see several conflicting messages in a single request like "leave documentation as appropriate," or "DO NOT add comments""。例について "giving examples actually constrains them to a certain exploration space"。CLAUDE.md について "Keep your CLAUDE.md lightweight and briefly describe what your repo is for, but spend most of the tokens on gotchas inside of the codebase."、"A common myth is that you want to make these a central repository for every known practice that you might run into ... Instead, consider having a tree of files that can be loaded at the right time."。繰り返しについて "Earlier Claude models could sometimes need repeated instructions ... We found we could delete these repeat examples"。
- prompting の文書（https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices、直接取得）。理由を添える: "Providing context or motivation behind your instructions, such as explaining to Claude why such behavior is important, can give Claude more information about your goals"、例として "NEVER use ellipses" より "Your response will be read aloud by a text-to-speech engine, so never use ellipses ..." が効くとし "Claude can generalize from the explanation."。肯定形: "Tell Claude what to do instead of what not to do"（出力の形式の節）。強い言葉: "If your prompts were designed to reduce undertriggering on tools or skills, these models might now overtrigger. The fix is to soften any aggressive language. Where you might have said "CRITICAL: You MUST use this tool when...," you can use more normal prompting such as "Use this tool when..." instead."。どれも数字は無い。
- context engineering の記事（2025-09-29、https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents、直接取得）。"right altitude" の両端の失敗として "hardcoding complex, brittle logic in their prompts" と "vague, high-level guidance that fails to give the LLM concrete signals" を挙げ、"striving for the minimal set of information that fully outlines your expected behavior. (Note that minimal does not necessarily mean short ...)" と書く。例外の列挙について "teams will often stuff a laundry list of edge cases into a prompt ... We do not recommend this."。
- skill の書き方の文書（https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices、直接取得）。"**Default assumption:** Claude is already very smart"、"Only add context Claude doesn't already have."、SKILL.md は 500 行未満、参照は一階層まで（"Claude might partially read files when they're referenced from other referenced files ... such as `head -100`"）、時間で古くなる情報を避け、用語を揃える。

**OpenAI（Codex と agents.md）**

- Codex の文書（https://developers.openai.com/codex/guides/agents-md、learn.chatgpt.com へ 308 転送、直接取得）。global（`~/.codex`）から作業ディレクトリへ向かって連結し、"Files closer to your current directory override earlier guidance because they appear later in the combined prompt."。打ち切り: "Codex skips empty files and stops adding files once the combined size reaches the limit defined by project_doc_max_bytes (32 KiB by default). ... Raise the limit or split instructions across nested directories when you hit the cap."。`AGENTS.override.md` で一時的に上書きできる。レビュー規則は "Keep rules concise, explain the behavior to flag and any safe path or exception, and reserve formatting and lint checks for CI."。長さの推奨行数は書かれていない。
- ソース（`codex-rs/core/src/agents_md.rs` の `load_project_instructions`、2026-09-16 の commit `50d77959bf` 時点）は、`remaining = config.project_doc_max_bytes` から project の文書ごとに引き、超えると "project doc exceeds remaining budget; truncating" を記録して切る。global の指示は `user_instructions` として別に渡され、この予算から引かれていないように読める（`agents_md_manager.rs` のコメントは "Existing global and combined instruction size policy is unchanged" とだけ書く）。文書の「合計」との関係は未確認の欄に置いた。
- 打ち切りが黙って起きる失敗。openai/codex #13386（open、2026-03-03）原文: "Codex silently truncates `AGENTS.md` at `32 KB` (roughly 600–800 lines). Any instructions past that limit are dropped and never sent to the model - with no warning"。一人の報告。
- agents.md のサイト（https://agents.md/、直接取得）。"Think of AGENTS.md as a README for agents"、必須の欄は無い（"No. AGENTS.md is just standard Markdown."）、勧める節は "Project overview / Build and test commands / Code style guidelines / Testing instructions / Security considerations"、追加として "anything you'd tell a new teammate belongs here too."、矛盾は "The closest AGENTS.md to the edited file wins; explicit user chat prompts override everything."、更新は "Treat AGENTS.md as living documentation."。長さの指針は無い。運営は Linux Foundation の Agentic AI Foundation。サイトは「OpenAI の main リポジトリに AGENTS.md が 88 個ある」と書く。
- agents.md の issue（gh、2026-10-25）。#249（open）: 32 KiB の打ち切りは UTF-8 で 3 バイトの中国語では約 10,900 字にしかならず、"A Chinese AGENTS.md effectively gets one third of the budget an English one does" と指摘し、バイト・行・推定トークンの三つで lint する例を示す。#228（open）: "explicit user chat prompts override everything" と最寄りのファイル優先のため、AGENTS.md の "never" は境界にならないと指摘する。どちらも回答なし。
- GPT-5 prompting guide（openai-cookbook、直接取得）。"poorly-constructed prompts containing contradictory or vague instructions can be more damaging to GPT-5 than to other models, as it expends reasoning tokens searching for a way to reconcile the contradictions rather than picking one instruction at random."。Cursor の例として "Be THOROUGH when gathering information. Make sure you have the FULL picture" という強調が GPT-5 では逆効果だったと書く。
- harness engineering（Ryan Lopopolo、2026-02-11、https://openai.com/index/harness-engineering/）。本文は 403。二次資料（https://codenote.net/en/posts/harness-engineering-ai-agent-era/、https://rywalker.com/research/openai-harness、**要約経由**）によれば、AGENTS.md を "a table of contents, not an encyclopedia" にして約 100 行に収め、`docs/` に詳細を置いた。一枚の大きなファイルの失敗は、文脈を押しのける、すべてが重要だと何も重要でなくなる、すぐ古くなる、の三つ。原文で確かめていない。

**Cursor（https://cursor.com/docs/rules、直接取得）**

- "Good rules are focused, actionable, and scoped."、"Keep rules under 500 lines"、"Split large rules into multiple, composable rules"、"Reference files instead of copying their contents. This keeps rules short and prevents them from becoming stale as code changes."。
- 避けるもの: "**Copying entire style guides**: Use a linter instead."、"**Documenting every possible command**: Agent knows common tools"、"**Adding instructions for edge cases that rarely apply**"、"**Duplicating what's already in your codebase**"。
- 始め方と保守: "Start simple. Add rules only when you notice Agent making the same mistake repeatedly."、"When you see Agent make a mistake, update the rule. You can even tag `@cursor` on a GitHub issue or PR to have Agent update the rule for you."。
- 種類: `alwaysApply: true` は毎回、それ以外は description をエージェントに見せて判断させるか glob で読み込む。参照したファイルは "The file is not inlined into the prompt, so if something must always be in context, paste it into the rule body."。nested な AGENTS.md も読む。

**Google（Gemini CLI、https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/cli/gemini-md.md、直接取得）**

- global・workspace・"Just-in-time (JIT) context files" の三層で、JIT は "Lets the model discover highly specific instructions for particular components only when they are needed."。`@file.md` の取り込みと `/memory show` がある。長さ・書き方の指針は見つからなかった。

**GitHub Copilot（GitHub Docs、API 版を直接取得）**

- "Custom instructions consist of natural language instructions and are most effective when they are short, self-contained statements."、"Because the instructions are sent with every chat message, they should be broadly applicable to most requests"（https://docs.github.com/en/copilot/concepts/prompting/response-customization）。
- コードレビュー向けの tutorial: "Shorter instruction files are more likely to be fully processed by Copilot."、"**Best practice**: Limit any single instruction file to a maximum of about 1,000 lines. Beyond this, the quality of responses may deteriorate."、"**Short, imperative directives** rather than long narrative paragraphs."。無視される原因として "Instruction file is too long (over 1,000 lines)."、"Instructions are vague or ambiguous."、"Instructions conflict with each other."（https://docs.github.com/en/copilot/tutorials/use-custom-instructions）。以前に二次資料で見かけた「コードレビューは先頭 4,000 字だけ読む」という記述は、今回取得した文書には無かった。
- クラウドエージェントに指示ファイルを生成させるプロンプトの制約: "Instructions must be no longer than 2 pages."、"Instructions must not be task specific."（https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions）。
- GitHub blog（Matt Nigh、2025-11-19、https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/、**要約経由**）。"Most agent files fail because they're too vague."、"One real code snippet showing your style beats three paragraphs describing it."、コマンドを前の方に置く、always / ask first / never の三段の境界、"'Never commit secrets' was the most common helpful constraint."。2,500 ファイルの分析の方法と数字は記事に無い。対象は Copilot の custom agent のファイルで、リポジトリ全体の AGENTS.md とは別物である点に注意。

**Windsurf / Devin（https://docs.devin.ai/desktop/cascade/memories、直接取得）**

- global の rules は "Limited to 6,000 characters."、workspace の rules は "Limited to 12,000 characters per file."。"Keep rules simple, concise, and specific. Rules that are too long or vague may confuse Cascade."、"There's no need to add generic rules (e.g. "write good code"), as these are already baked into Cascade's training data."、箇条書きと XML タグを勧める。

### レンズ 2. 実践者

- **HumanLayer（Kyle、2025-11-25、https://www.humanlayer.dev/blog/writing-a-good-claude-md、要約経由）。** "general consensus is that < 300 lines is best, and shorter is even better."、自社の root の CLAUDE.md は "less than sixty lines"。"Frontier thinking LLMs can follow ~ 150-200 instructions with reasonable consistency."、"Claude Code's system prompt contains ~50 individual instructions." と書き、Claude Code が CLAUDE.md を "IMPORTANT: this context may or may not be relevant to your tasks." という前置きで包むので、全員に当てはまらない内容ほど無視されやすいと論じる。手順は `agent_docs/` の別ファイルに置いて一覧だけ書く。"Never send an LLM to do a linter's job"。"Don't use `/init` or auto-generate your `CLAUDE.md`."。指示の数（150〜200）の根拠は IFScale の読み替えで、独自の測定ではない。
- **Mitchell Hashimoto（2026-02-05、https://mitchellh.com/writing/my-ai-adoption-journey、要約経由）。** "anytime you find an agent makes a mistake, you take the time to engineer a solution" を "harness engineering" と呼ぶ。AGENTS.md について "Each line in that file is based on a bad agent behavior, and it almost completely resolved them all."。もう一つの手は "Actual, programmed tools"（スクリーンショット、絞ったテストのスクリプト）で、"is usually paired with an AGENTS.md change to let it know about this existing."。Ghostty の root の AGENTS.md は 39 行（下の表）で、最終更新は 2026-04-25 より前（その後 6 か月 commit なし）。
- **Addy Osmani（2026-02-23、https://addyosmani.com/blog/agents-md/、要約経由）。** "The practical filter is simple: can the agent discover this on its own by reading your code? If yes, delete it."、"every line in AGENTS.md is a line competing with the thing you actually asked the agent to do."、"Think of AGENTS.md as a living document of friction you haven't fixed yet."、"You add a line, you investigate why the agent keeps making this mistake, you fix the underlying thing, and then you can probably delete the line."。行数の上限は示さず "start your AGENTS.md nearly empty"。
- **Peter Steinberger（steipete/agent-scripts、gh で直接確認）。** 全リポジトリ共通の `AGENTS.MD` は 120 行で、"Skills own tool workflows. This file: hard rules only." と自分で書く。2025-11-20 から 119 commit、2026-04-25 以降だけで 100 commit（gh api、2026-10-25）。一人で毎日のように足し引きしている。一方、2025 年半ばの規則集 steipete/agent-rules（★5,673）は 2026-05 に archive され、README は "AI moves fast. This was old stuff I used mid 2025 when I was still using Cursor." とだけ書く。
- **Thariq Shihipar（Anthropic）。** 上のレンズ 1 の記事。社内の transcript で、system prompt・skill・利用者の指示の衝突を観察したと書く。
- **Boris Cherny（Anthropic、Claude Code の作者）。** 二次資料（https://getpushtoprod.substack.com/p/how-the-creator-of-claude-code-actually、検索結果の要約のみ）によれば、チームは一つの CLAUDE.md を git に入れ、週に何度も皆で足し、Claude が誤るたびに一行足す。原文に到達していない。なお anthropics/claude-code の公開リポジトリの CLAUDE.md は 40 行で、2026-09-25 に作られ、内容は GitHub Actions の守りの三点と、それを確かめる CI（`.github/workflows/workflow-hardening.yml`）と例外表の場所だけである（gh で直接読んだ）。
- **Armin Ronacher（https://lucumr.pocoo.org/2026/1/31/pi/、要約経由）。** pi は "the shortest system prompt of any agent that I'm aware of"、skill は "I throw skills away if I don't need them."。指示ファイルの書き方を直接論じた投稿は見つからなかった。2025-06 の "Agentic Coding Recommendations" の要約（Simon Willison 経由、https://feeds.simonwillison.net/2025/Jun/12/agentic-coding-recommendations/）は、CLAUDE.md の一行（メールはログに出る）と、道具を Makefile にまとめる方法を挙げる。
- **Simon Willison。** 指示ファイルの書き方そのものの投稿は見つからなかった。Claude Code が AGENTS.md を読むようになった件の紹介（2026-09-18）はある（検索結果のみ）。

### レンズ 3. 測定

| 出典 | 課題の種類 | 結果 | 費用の数字 | 限定 |
|---|---|---|---|---|
| Evaluating AGENTS.md（arXiv 2602.11988、ETH、2026-02、本文 HTML を直接取得） | SWE-bench Lite と新しい CTXbench 138 件（12 リポジトリ、開発者の context ファイルあり）。Claude Code + Sonnet 4.5、Codex + GPT-5.2 / 5.1 mini、Qwen Code | LLM 生成のファイルで成功率 −0.5% と −2%（p=87% と 37%、有意差なし）。開発者のファイルで +2.4%（p=21%）、LLM 生成より有意に上（p=3.8%）。Claude Code だけは開発者のファイルでも改善しなかった。リポジトリの概要は、PR の対象ファイルに触れるまでの手順数を減らさなかった。書かれた道具は使われた（`uv` は言及ありで 1 件あたり 1.6 回、なしで 0.01 回未満）。文書を全部消したリポジトリでは LLM 生成のファイルが +2.7% | 手順 +2.45 と +3.92、費用 +20% と +23%（p<0.001%）。開発者のファイルは +3.34 手順、費用は最大 +19% | 著者の結論: "we suggest omitting LLM-generated context files for the time being"、"context files are useful for specifying non-standard coding practices"。序論の「開発者のファイルが LLM 生成を 7% 上回る」と本文の数字の対応は読み切れていない |
| Do Context Files Help Coding Agents?（arXiv 2607.27250、Khatri、2026-07、abstract 直接取得） | 3 リポジトリ 17 課題、Claude Code と Codex、288 回、gold test | 注入の方式は正答率を動かさない（同等性検定で 10〜15 ポイント以内）。失敗は "feature design, pattern selection, exact wiring" で、"the real AGENTS.md never converts a near-miss to a pass" | abstract に費用の数字なし | 課題が少ない |
| On the Impact of AGENTS.md Files on the Efficiency（arXiv 2601.20404、Lulla ほか、2026-01、abstract 直接取得） | 10 リポジトリ 124 PR、AGENTS.md の有無 | 完了の振る舞いは同等 | 実行時間の中央値 −28.64%、出力トークン −16.58% | Codex のみ（二次資料の指摘）。成功率の比較ではない |
| Instruction Adherence in Coding Agent Configuration Files（arXiv 2605.10039、McMillan、2026-05、PDF 直接取得） | Claude Code CLI 1,650 セッション、16,050 関数、TypeScript 2 コードベース、Sonnet 4.6 主、Opus 4.6 確認。目印 `// @tracked` を関数に付ける一つの指示 | ファイルの大きさ（25・100・250・500 行）で 60.0%・65.2%・67.7%・64.0%、位置・分割・隣のファイルの矛盾も差なし（大きさと矛盾は BF10 0.05〜0.10 で差なしを支持）。課題による差は 45.1%〜84.4% と大きい。セッション内で関数を一つ書くごとに遵守のオッズ ×0.944（約 −5.6%）。CLAUDE.md なしでは目印 0 件 | 数字なし | 指示は一つで易しい。多数の規則の競合や難しい規則には外挿できないと著者が書く |
| IFScale（arXiv 2507.11538、先行の記録） | 報告書を書く課題に語を含める指示 10〜500 個 | 500 個で最良 68%。前の方の指示に偏る | — | コーディングではない |
| When Instructions Multiply（arXiv 2509.21051、ManyIFEval と StyleMBPP、EMNLP 2025 Findings、abstract 直接取得） | 文章生成で最大 10 個、コード生成で最大 6 個の指示 | 10 モデルで、指示の数とともに一貫して低下。指示の数だけを説明変数にしたロジスティック回帰で約 10% の誤差で予測できる | — | 指示は書式・文体で、リポジトリの規則ではない |
| Context Rot（Chroma、2025-07-14、直接取得） | 18 モデル、易しい検索と複写の課題で入力長だけを変える | "their performance grows increasingly unreliable as input length grows"、非一様に低下 | — | 指示ファイルではなく入力長一般 |
| Attention is Case-Sensitive（arXiv 2608.03711、2026-08、abstract 直接取得） | 13 モデル（LLM 9、VLM 4）。大文字や交互の大文字小文字で注意がどう動くか | 大文字は注意を集めるが "increased concentration does not inherently improve task accuracy"、交互の大文字では悪化しうる。推論するモデルでは思考の段階がこの影響を弱める | — | 遵守率でもコーディングでもない |
| Agent READMEs（arXiv 2511.12884、2025-11、本文 HTML 直接取得） | 1,925 リポジトリの 2,303 ファイル（CLAUDE.md 922、AGENTS.md 694、copilot-instructions 687） | 語数の中央値は Copilot 535、Claude Code 485、Codex 335.5。Flesch の読みやすさは "difficult"。Claude Code のファイルの 67.0% が複数回変更され、変更間隔の中央値は約 1 日。抜き出した 100 commit の 92% が指示の追加・修正・削除で、変化は "incremental additions rather than deletions"。内容はテスト手順 75.9%、実装の詳細 70.8%、構成 68.1%、セキュリティ 14.8%、性能 14.5% | — | 成否は測っていない |
| On the Use of Agentic Coding Manifests（arXiv 2509.14744、abstract 直接取得） | 242 リポジトリの CLAUDE.md 253 個 | 見出しは浅く、内容は操作のコマンド・実装の注記・高水準の構成が中心 | — | 成否は測っていない |
| Harness Engineering for Agentic AI Coding Tools（arXiv 2602.14690、abstract 直接取得） | 2,853 リポジトリの設定の仕組み | context ファイルが支配的でしばしば唯一の仕組み。AGENTS.md がツール間の標準になりつつある。skill と subagent を使うリポジトリは少ない | — | 成否は測っていない |
| Measuring Pragmatic Influence（arXiv 2602.21223、abstract 直接取得） | open-weight 5 モデル、指示の前置き（"This is urgent" など）13 戦略 400 例 | 前置きの言い方が指示の優先順位を系統的に動かし、効く順位はモデル間でほぼ同じ | — | コーディングでも指示ファイルでもない |

**この表から言えること（推論）。** 「指示が多いほど一つ一つは守られにくい」は合成の課題で再現されている。「ファイルが長いだけで一つの規則が守られなくなる」は、Claude Code での唯一の統制実験では出なかった。リポジトリ全体の成功率に対しては、人が書いたファイルでも効果は小さく、費用は確実に増える。費用の増加は、モデルが書かれた指示（テストを走らせる、道具を使う）に従った結果で、無視した結果ではない。

### レンズ 4. 現場（公開リポジトリ、gh api、2026-10-25）

**大きく活発なリポジトリの root の指示ファイル（36 件）**

| リポジトリ | ★ | ファイルと行数 | 備考 |
|---|---|---|---|
| anthropics/claude-code | 153,341 | CLAUDE.md 40 | GitHub Actions の守りと、それを確かめる CI だけ |
| ghostty-org/ghostty | 62,578 | AGENTS.md 39 | コマンド、ディレクトリ、PR を作らせない規則 |
| vercel/next.js | 143,267 | AGENTS.md 546 | 半年で 22 commit。"Use skills for conditional, deep workflows. Keep baseline iteration/build/test policy in this file." と書き `.agents/skills/` に振り分ける |
| apache/airflow | 47,274 | AGENTS.md と CLAUDE.md 同内容 251 | 半年で 40 commit |
| microsoft/vscode | 194,268 | AGENTS.md 5、copilot-instructions 162 | AGENTS.md は散文で copilot-instructions を指すだけ |
| facebook/react | 251,802 | CLAUDE.md 13 | 下位の compiler に別の指示 |
| denoland/deno | 108,752 | CLAUDE.md 433、copilot-instructions 352 | 二つの別ファイル |
| astral-sh/ruff | 50,270 | AGENTS.md 226、CLAUDE.md は `@AGENTS.md` の 1 行 | 半年で 38 commit |
| astral-sh/uv | 91,143 | AGENTS.md 49 | |
| oven-sh/bun | 96,400 | AGENTS.md と CLAUDE.md 同内容 239 | 半年で 23 commit（CLAUDE.md 側） |
| zed-industries/zed | 92,160 | `.rules` 190、AGENTS.md・CLAUDE.md・GEMINI.md は symlink（mode 120000） | 一つの元を三つの名前で |
| pytorch/pytorch | 105,058 | AGENTS.md と CLAUDE.md 同内容 365、copilot 127 | 半年で 30 commit |
| langchain-ai/langchain | 148,418 | AGENTS.md 390 | |
| sst/opencode | 221,385 | AGENTS.md 189 | |
| google-gemini/gemini-cli | 108,372 | GEMINI.md 96 | |
| tldraw/tldraw | 51,080 | AGENTS.md 228、CLAUDE.md は `@AGENTS.md` | |
| badlogic/pi-mono | 117,726 | AGENTS.md 125 | 半年で 37 commit |
| can1357/oh-my-pi | 36,547 | AGENTS.md 346 | 半年で 34 commit |
| obra/superpowers | 304,843 | AGENTS.md 121 | |
| cloudflare/workers-sdk | 4,659 | AGENTS.md 157、CLAUDE.md は `See @AGENTS.md` | |
| supabase/supabase | 113,912 | AGENTS.md 75、CLAUDE.md は `@AGENTS.md`、copilot 87 | |
| n8n-io/n8n | 208,546 | AGENTS.md 456、CLAUDE.md は `@AGENTS.md` | 半年で 42 commit |
| home-assistant/core | 91,721 | AGENTS.md と CLAUDE.md 同内容 57、copilot 197 | |
| grafana/grafana | 77,493 | AGENTS.md 180、CLAUDE.md は `@AGENTS.md` | |
| kubernetes/kubernetes | 128,660 | AGENTS.md 39 | 制約は「生成物を手で直さない」などで、実行するスクリプト名を添える |
| nodejs/node | 123,072 | AGENTS.md 64 | |
| python/cpython | 77,762 | AGENTS.md 16 | |
| django/django | 91,619 | copilot-instructions 10 | AGENTS.md なし |
| rails/rails | 58,855 | AGENTS.md 201 | |
| microsoft/TypeScript | 111,601 | copilot-instructions 144 | |
| rust-lang/rust | 120,773 | AGENTS.md 258 | 2026-08 に追加 |
| huggingface/transformers | 168,133 | AGENTS.md と CLAUDE.md 同内容 40 | |
| vllm-project/vllm | 95,441 | AGENTS.md 163 | |
| sveltejs/svelte | 88,449 | AGENTS.md 15 | |
| vitejs/vite | 83,533 | copilot-instructions 50 | |
| biomejs/biome | 25,994 | AGENTS.md 88 | |

- 36 件の主ファイルの行数の中央値は 134.5、最大 546（next.js）。200 行超が 12 件、300 行超が 6 件、100 行未満が 16 件。Anthropic の 200 行を超えるものが三分の一ある。
- 一つの元を複数の名前で持つ形が 12 件（同内容の二ファイルか symlink が 6 件、CLAUDE.md を `@AGENTS.md` の取り込みにする形が 6 件）。vscode の AGENTS.md は散文で別ファイルを指すだけで、Anthropic の文書が「開くかどうかはモデル次第」と書く形にあたる。
- golang/go には指示ファイルが無い。openai/codex は 2026-09-30 の PR #49713 "Remove repository-local Codex guidance, skills, and environment config" で root の AGENTS.md（320 行）と `.codex/skills/` を消し、今は下位の 2 ファイル（2,721 バイトと 564 バイト）だけ。PR に理由は書かれていない。agents.md のサイトはまだ openai/codex を例に挙げ、issue #251 で「なぜ人気のリポジトリが AGENTS.md を外すのか」と問われているが回答は無い。
- 指示ファイルを無視するという issue。anthropics/claude-code でタイトルに "CLAUDE.md" と "ignore" を含むものが 215 件（gh search、2026-10-25）。反応が最も多い #2544（+41、open）は "MANDATORY: Always check out GitHub issues before starting work" のような手順の規則が飛ばされると報告する。#33603（+15、open）は "Every time a violation occurs, the rule is re-stated, strengthened, and re-documented. The next session violates it again." と書く。どちらも書かれているのは手順で、hook に移せと文書が勧める種類の規則である（推論）。openai/codex では同様の条件で 21 件、#13386 は 32 KiB の黙った打ち切り。issue は否定側に偏るチャネルで、件数は失敗率ではない。

**一つの元から複数のハーネスの指示ファイルを作る道具**

| 道具 | ★ | 最終 push | 品質の保ち方 | 失敗の記録 |
|---|---|---|---|---|
| intellectronica/ruler | 2,951 | 2026-10-22 | `.ruler/*.md` を連結し、各断片の前に `<!-- Source: <path> -->` を付けて出どころを残す。生成物は既定で `.gitignore` に入れる。nested は実験的 | #604（重複したブロック）、#455（古い重複した MCP のキー）。どちらも closed |
| dyoshikawa/rulesync | 1,552 | 2026-10-25 | 統一の `.rulesync/` から各ツールの形式へ変換し、既存のファイルを取り込む。ツールごとの上限（例: Antigravity の 1 ファイル 24,000 バイト）を README に記す | #2743 "Fold-collision targets duplicate their folded rules on every generate/import cycle"（closed）など、重複と大文字小文字の衝突 |
| block/ai-rules | 142 | 2026-05-11 | 規則・コマンド・skill を一か所で管理 | 調べていない |
| steipete/agent-rules | 5,673 | archive（2026-05） | — | 作者が「古いもの」として放棄 |

- どの道具も、内容の長さ・矛盾・古さを検査しない（README で確認できた範囲。推論を含む）。失敗の記録は、重複や上書きのような機械的なものに偏る。内容の品質は書く人に任されている。

**自動で書き足す仕組み。** Cursor の plugins リポジトリ（pstack と同じリポジトリ、`continual-learning/`）の `agents-memory-updater` は、会話の記録から AGENTS.md の二つの節へ箇条書きを足す。制約は "keep each learned section to at most 12 bullets"（`continual-learning/agents/agents-memory-updater.md:29`）と "Do not write process instructions, rationale, or metadata blocks."（同 `:41`）で、終了時の hook から既定で 10 ターンかつ 120 分ごとに起動する（`continual-learning/README.md:39-43`）。効果の数字は無い。Anthropic の Claude 5 の記事は、CLAUDE.md に書かせる方式から別の auto memory へ移したと書く。

### pstack（`~/.local/share/jig/plugins/pstack/pstack`、commit `99b609a7`、2026-10-24、ファイルを直接読んだ）

- `skills/principle-encode-lessons-in-structure/SKILL.md:3`（description）: "Encode the rule as a lint, metadata flag, runtime check, or script instead of more text."。`:9`: "If the lesson needs judgment and cannot be encoded, make the instruction more prominent and add an example of the failure mode."。`:11`: "**Corollary:** If the fix is structural, only use the structural fix. The instruction is the symptom."
- `skills/poteto-mode/playbooks/authoring-a-skill.md:10`: "When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate."
- `skills/poteto-mode/SKILL.md:26`: "Agent-facing prose also follows the **create-skill** skill (Cursor's built-in for authoring SKILL.md files)."。`create-skill` は Cursor の組み込みで公開されておらず読めていない。
- `skills/automate-me/SKILL.md:87-90`: "**Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it."、"**Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational."、"**Reference, don't inline.**"、"**Keep sections minimal.** ... "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is."。`:79`: "Cut ruthlessly. A mode skill is not a manual."
- `skills/reflect/references/synthesizer.md:15-22`（学びを skill に足すかの基準）: "Durability: still true in 6 months once paths, SHAs, tool versions, and code shapes have changed."、"Specificity: ... Reject vague platitudes ("write good code") and hyper-specific facts"、"Decision-changing: a future agent does something different because of the edit, not just reads more text."、"Structural-mechanism check: route to Backlog when a lint rule, script, metadata flag, or runtime check already enforces the rule or could enforce it cheaply. Skill prose is for things mechanisms cannot enforce."、"Already-covered: ... If the proposal duplicates clear, well-placed existing guidance, reject as `already-covered`, because the issue is execution, not the skill. If the existing guidance is buried, weak, or easy to skip past, accept the row but reframe the proposal as a wording / placement improvement"。`:34` には残す例として "path-shaped triggers belong in `paths:`, not description prose"。`skills/reflect/SKILL.md:47` は skill の変更を "affect every future agent in the org. Do not auto-apply." として承認を待たせる。
- `skills/principle-subtract-before-you-add/SKILL.md:17`: "Simplify prompts (remove redundant instructions, excessive templates)"。
- 文章の規則。`skills/technical-writing/SKILL.md:13-15`: "**Cut every word that does no work.**"、"**Use the short, everyday word.**"、"**When a rule makes a sentence worse, fix the sentence another way or leave it alone.**"。`:17`: "The codebase is the word list. Write the real symbol, file, flag, or command name, not a synonym or a description of it."。`:55`: "Write instructions as commands: "Click Submit." State facts plainly. Never "should be done"."。`:56`: "Put the condition before the instruction"。`:67`: "One instruction per sentence."。`:71-72`: 一語一義と一動作一語。`:88`: "Call each thing by one name, everywhere."。`skills/unslop/SKILL.md:13`: "Rule numbers are stable ids that other skills cite. A removed rule leaves a gap."（規則に安定した番号を付け、他から参照させる）。`:33`: 過度の圧縮（冠詞の脱落、動詞のない断片、記号）を禁じる。
- 構造の観察。pstack の 53 skill は `disable-model-invocation: true` で（先行の `2026-10-17-pstack-survey.md`）、毎回読み込まれる指示を持たない。毎回読み込まれるのは `/setup-pstack` が書く `~/.cursor/rules/pstack-models.mdc`（`skills/setup-pstack/SKILL.md:8`、`alwaysApply: true`）だけで、中身は役割ごとのモデル名の表である。

### 規則一つの書き方（問い 5）を、各レンズからまとめる

| 論点 | 前例の向き | 出典 | 測定 |
|---|---|---|---|
| 具体的で検証できる書き方 | 一致して勧める | Anthropic memory（"2-space indentation"）、Cursor（"Avoid vague guidance"）、GitHub blog（"too vague"）、Windsurf | 無し（ETH の論文は道具の指示がよく守られると報告） |
| 命令形、一文一指示 | 一致して勧める | GitHub tutorial（"Short, imperative directives"）、pstack technical-writing `:55`・`:67` | 無し |
| 肯定形（何をするか）を書く | Anthropic が勧める。ただし出力形式の節で | Anthropic prompting | 無し |
| 理由を添える | 割れる。Anthropic は添えよ、pstack は省け（混乱するときだけ）。Anthropic の `/doctor` は rationale を残す側 | Anthropic prompting、pstack authoring-a-skill `:10`、Anthropic memory | 無し |
| 強調語（IMPORTANT、MUST、大文字） | 「一行だけ」が Anthropic の勧め。新しいモデルでは強い言葉が過剰な起動を招く（Anthropic、OpenAI の Cursor の例、superpowers #2377） | Anthropic best-practices と prompting、GPT-5 guide | 大文字は注意を集めるが正答率は上がらない（2608.03711、コーディングでない） |
| 例を添える | 割れる。Anthropic の 2025 の記事と GitHub blog は勧め、Anthropic の 2026-07 の記事は新しいモデルでは探索を狭めると書く | 上記 | 無し |
| 長い文書を参照する | 複製せず参照。参照は一階層まで。Claude Code の `@path` は読み込まれ費用は減らない。Cursor の参照は読み込まれず、必要なら本文に貼れ。散文の参照は開かれるとは限らない | Anthropic memory と skill best practices、Cursor | Vercel の 56%（先行の記録）は「参照が開かれない」側の測定 |
| 矛盾を作らない | 一致して勧める。GPT-5 は矛盾の解消に推論を使う | Anthropic、GitHub、OpenAI | Claude Code の要因実験では隣のファイルの矛盾で差なし（2605.10039） |
| 規則と、それを確かめる仕組みを並べる | 実例がある | anthropics/claude-code の CLAUDE.md、kubernetes の AGENTS.md（"Run `make update`."）、Hashimoto の「道具と一行を組にする」 | 無し |
| 理由の記録を指示から分ける | ベンダーの明文なし。HTML コメント（Claude Code）、目次と `docs/`（OpenAI、二次資料）、規則の番号を安定させて他から参照（pstack unslop `:13`） | 上記 | 無し |

## 方式別の表

| 方式 | 前例（出典） | 課題の種類 | 結果 | 費用の数字 | 名前のついた失敗 |
|---|---|---|---|---|---|
| A. 短い一枚の root ファイル（コマンド、落とし穴、非標準の慣習だけ） | Anthropic（200 行未満）、HumanLayer（60 行未満）、Ghostty 39 行、kubernetes 39 行、claude-code 40 行 | リポジトリの課題 | 開発者のファイルで +2.4%（有意でない）。道具の指示はよく守られる | 費用 最大 +19%、手順 +3.34 | 誤りのたびに一行足して肥大する（2511.12884 の追加偏重）。必須の手順を書いても飛ばされる（#2544、#33603） |
| B. 長い一枚のファイル（全知識を集める） | next.js 546 行、n8n 456 行、deno 433 行 | 同上 | 長さだけでは一つの目印の遵守は下がらない（2605.10039） | Codex は 32 KiB で黙って切る（#13386） | 打ち切り、すべてが重要で何も重要でない（OpenAI、二次資料）、古くなる。Anthropic の記事が「神話」と呼ぶ形 |
| C. 目次の root と、skill・path 指定 rules・下位ファイル・`docs/` への振り分け | Anthropic memory、Claude 5 の記事、Cursor、Gemini の JIT、Codex の nested、OpenAI の harness engineering（二次資料）、next.js の skill 振り分け | 同上 | 測定なし | 数字なし | skill が開かれない（Vercel 56%、先行の記録）。散文の参照は開かれるとは限らない。path 指定は触れるまで読み込まれない。下位ファイルは 40,000 字を超えると先頭だけ（Claude Code） |
| D. 規則を構造に移す（hook、lint、CI、スクリプト） | Anthropic（"hooks are deterministic"）、Cursor（"Use a linter instead"）、Codex（"reserve formatting and lint checks for CI"）、HumanLayer、pstack encode-lessons、Hashimoto | 毎回守らせる規則 | 測定なし（先行の記録） | hook は LLM 呼び出しなしなら 0 | hook のループと上限（先行の記録）。判断を要する規則は移せない |
| E. LLM に生成させる（`/init` など） | Anthropic と Codex の `/init`、GitHub の生成プロンプト | リポジトリの課題 | −0.5% と −2%（有意差なし）。文書のないリポジトリでは +2.7% | 費用 +20% と +23% | 概要は役に立たない、コードから分かることの重複（2602.11988、Osmani、HumanLayer） |
| F. 一つの元から各ハーネスへ生成・共有 | ruler、rulesync、zed の symlink、`@AGENTS.md` の取り込み 6 件 | 複数ハーネス | 測定なし | 数字なし | 重複（rulesync #2743、ruler #604）。内容の品質は検査しない。ハーネスごとの上限が違う（Windsurf 6,000 字、Codex 32 KiB、Antigravity 24,000 バイト）。CJK はバイトの上限に早く当たる（agents.md #249） |
| G. 会話の記録から自動で書き足す | Cursor の continual-learning（12 項目上限）、Claude Code の旧 `#` キー（Anthropic は auto memory へ移したと書く） | 好みと事実の記憶 | 測定なし | 数字なし | 一度きりの好みを規則にする（pstack automate-me `:87` が警告） |

## 否定側の証拠

- **「短いほど守られる」の否定。** Claude Code での唯一の統制実験（2605.10039）は、25 行と 500 行で一つの規則の遵守に差が無いことを、差なしを支持する形で示した。ただし規則は一つで易しい。IFScale と ManyIFEval は指示の「数」の効果で、ファイルの「長さ」と同じではない。ベンダーの行数の上限（200、500、1,000）はどれも根拠となる測定を示していない。
- **「context ファイルは効く」の否定。** 2602.11988 と 2607.27250 は成功率への効果をほぼ 0 とし、費用は 20% 前後増やす。効率の改善（2601.20404）は Codex だけ・10 リポジトリで、成功率ではない。Anthropic の Claude 5 の記事は、自社の system prompt の 80% 超を削っても評価が落ちなかったと書く（方法は非公開）。
- **大手の撤退。** openai/codex は 320 行の root の AGENTS.md を消した（理由不明）。steipete/agent-rules は archive された。どちらも一件ずつで、AGENTS.md 自体を否定する説明は無い。
- **強い言葉の否定。** Anthropic と OpenAI の文書は、古いモデル向けの強調や "THOROUGH" が新しいモデルで逆効果になると書く。superpowers #2377 は "ABSOLUTELY MUST" が過剰な起動を招いた報告（先行の記録）。
- **書いても守られない。** 215 件の issue のうち上位の二件は、必須の手順を強めて書き直すほど悪化したと報告する。Anthropic の文書自身が CLAUDE.md を "context, not enforced configuration" と呼ぶ。agents.md の規格は利用者の指示がすべてに優先すると定める（#228 の指摘）。
- **チャネルの偏り。** ベンダーの数字は自社の評価で方法が非公開。issue は否定側に偏り、件数は率ではない。論文は課題が狭い（SWE-bench の Python、一つの目印、合成の指示）。実践者の記事は要約経由が多い。

## 受け入れられたやり方と、各方式の失敗（判断）

**証拠が支えること。**

1. 毎回読み込まれるファイルには、モデルがコードから見つけられない事実（使うコマンドと道具、既定と違う慣習、落とし穴）だけを書く。ベンダー五社の文書、実践者三人、ETH の測定（道具の指示は守られ、概要は役に立たない）が同じ方向である。
2. 手順と、一部でしか要らない知識は、毎回読み込まれる場所から出す。どこへ出すかはハーネスで名前が違う（skill、path 指定の rules、下位ディレクトリの AGENTS.md や GEMINI.md）が、どのベンダーも同じ振り分けを持つ。
3. 毎回必ず守らせたい規則と書式・lint の規則は、文章でなく hook・lint・CI に移す。Anthropic・Cursor・Codex の文書、HumanLayer、pstack が一致する。指示ファイルには「その仕組みがある」と一行だけ書く（Hashimoto、claude-code の CLAUDE.md）。
4. 誤りを見たら一行足し、根本を直したら消す。足すことは誰でもしているが、消すことは実態の調査で少ない。Anthropic の `/doctor prompt-audit` と Osmani の「直したら消す」がこの不足への手当てである。
5. 矛盾を作らない。Anthropic、GitHub、OpenAI の文書が一致し、Anthropic は社内の transcript で衝突を観察している。測定では隣のファイルの矛盾で差が出なかったので、「害がある」の根拠はベンダーの観察だけである。
6. LLM に生成させたファイルをそのまま使わない。測定で唯一、成功率が下がる向きに出た条件である（有意ではない）。

**証拠が支えないこと。**

- 特定の行数（200、300、500、1,000）が境目であること。どの数字も測定に基づかない。
- 強調語や大文字で遵守が上がること。
- 理由を添えると遵守が上がること、または下がること。
- 規則の理由（決定記録）を指示から分けると良いこと。慣行としての明文も測定も無い。分ける方が良いという判断は、毎回の文脈の費用（ETH の +20%）と、Anthropic の HTML コメントの仕組みからの推論である。

**方式ごとの既知の失敗（短く）。** 短い一枚は、足す一方で肥大し、手順を書いても飛ばされる。長い一枚は、打ち切られ、古くなり、規則の優先度が埋もれる。振り分けは、振り分けた先が開かれない（Vercel の 56%）。構造への移し替えは、判断を要する規則には使えず、hook のループと上限を持つ。生成は、コードから分かることを重ね、費用だけを増やす。一つの元から各ハーネスへ配る方式は、重複を作り、ハーネスごとの上限の違いと CJK のバイト数に当たる。自動の書き足しは、一度きりの好みを規則にする。

## house の現状との突き合わせ（測った事実。これは何が正しいかの証拠ではない）

- 2026-10-25 時点で、jig が書いた Claude Code 用の global の CLAUDE.md は 216 行・33,612 字、Codex 用の global の AGENTS.md は 33,762 バイトで、Codex の `project_doc_max_bytes` の既定 32 KiB（32,768 バイト）を超える。Codex の設定に `project_doc_max_bytes` は無い。global のファイルがこの予算に数えられて末尾が切られるかは、文書とソースの読みが食い違うため未確認（未確認の欄）。この dotfiles リポジトリの AGENTS.md は 20,732 バイトで予算の内側にある。
- 決定一件を一行にする形のため、1 行の平均は約 155 字で、行数の上限（Anthropic の 200 行）より字数とトークンの方が意味のある尺度になる。agents.md #249 の三つの尺度（バイト、行、推定トークン）と同じ問題である（推論）。

## 前例なし（見つからなかったもの）

- 行数の上限（200、300、500、1,000 行）を測定から導いた資料。
- 多数の規則が同時に効く現実のリポジトリで、指示ファイルの長さと遵守を比べた測定（2605.10039 は規則一つ）。
- 強調語（IMPORTANT、MUST、大文字）がコーディングの指示の遵守を変えるかの測定。
- 理由を添えた規則と添えない規則の遵守を比べた測定。
- 否定形と肯定形の規則の遵守を、コーディングの課題で比べた測定。
- 規則の理由（ADR、決定記録）を指示ファイルから分けて置くことを勧める、ベンダーの文書（`gh search code` では AGENTS.md の中で `docs/adr` や "decision records" に触れるファイルが検索の上限の 100 件以上あるが、どれも小さなリポジトリで、効果の記述は無い）。
- 一つの元から各ハーネスの指示ファイルを作る道具のうち、内容の長さ・矛盾・古さを検査するもの。
- openai/codex が root の AGENTS.md を消した理由の公開説明。
- Simon Willison と Armin Ronacher が指示ファイルの書き方を直接論じた投稿（到達できなかった可能性あり）。

## 足りない証拠

- 指示ファイルの中身を変えたときに、どの規則がどれだけ守られるようになったかを、利用者が自分のリポジトリで測る方法の公開例。Anthropic の文書は「振る舞いが変わるか観察せよ」と書くだけで、Claude Code の `InstructionsLoaded` hook は読み込みを記録するが遵守は記録しない。
- Codex・pi・omp での遵守の測定。測定は Claude Code と Codex（2602.11988、2607.27250）と Claude Code だけ（2605.10039）に限られる。
- 日本語などの多バイト言語の指示ファイルに対する、バイトの上限の影響の測定（agents.md #249 は指摘だけ）。
