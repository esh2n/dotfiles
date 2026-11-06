# 決定の記録（ADR、決定メモ）を、AIが読む指示とどう分け、誰が承認し、どう守らせるか

調査日: 2026-11-06

前提: `2026-10-25-always-on-instruction-files.md`で確定したこと（毎回読み込まれるファイルに書くもの、長さ、skill・hook・lint・CIへの振り分け、context ファイルの測定）は再調査せず引用する。この記録は、その記録が「前例なし」とした二点を扱う。理由の記録を指示から分ける慣行と、AIが書いた記録を人が承認したかの区別である。

調査のきっかけ: このリポジトリでは、AIのセッションが会話の途中で決定メモ（`harness/rules/decisions/`）を書き、Statusの「持ち主の裁定」もAIが書いていた。jigは各メモの英語の`rule:`行を、全ハーネスが毎回読むAGENTS.mdに写していた。人が承認したという記録はどこにも無かった。

## 結論

1. **決定の記録を何十件も毎回読み込ませている前例は、ベンダーにも実践者にも大きなリポジトリにも無い。** 記録を持つリポジトリは、リンクか一件一行の索引だけを指示ファイルに置き、本文は必要なときに読ませる（n8n、deliberate-lab、beads、airflow、elasticsearch-java）。全部を毎回のファイルに入れていたのはruflo（71,369バイト）だけで、存在しないADRを引く不具合（#3179）と、ADRが毎回のファイルの規則を上書きした例（ADR-513）を抱える。
2. **AIに下書きさせるのは普通だが、人の段を通らない記録は決定として扱わない。** n8nのAGENTS.mdは"Write an ADR only when asked ... let the human decide"と書き、記録に`Decision Owner`の欄を持たせてCIで形式を検査する。evolu.devは"A Proposed ADR does not bind"、Duncan Davidsonは"Treat accepted ADRs as binding. Proposed ADRs are non-binding context."と書く。Boris ChernyのチームはPRのレビューを通してからCLAUDE.mdに入れ、Peter SteinbergerのAGENTS.MDは、本人の承認を日付つきで書く（53行目、"Team server deployments/cutovers require Peter's explicit per-deployment approval (September 13, 2026)"）。pstackの`reflect`は承認まで書き換えを待つ。
3. **人の段が無い記録は、間違うか読まれない。** obra/claude-memory-extractorのREADMEには、作者自身の"All prose was written by Claude. Even the research report that it claims I wrote."という注記がある。Equal ExpertsはAIに書かせたADRで、存在しない資料の引用と、実際の決定に合わない理由を報告した。ECCの自動で書かれる「instinct」は、確信度0.7以上を"Auto-approved"とし、Pestのリポジトリに"Use playwright as the test framework"と書いた（#2841）。測定では、エージェント自身が書いたskillは、skillが無いときより成功率を8.1〜11.5ポイント下げた（SkillsBench、arXiv 2602.12670、コーディングに限らない）。
4. **AIを縛るのは仕組みで行う。** Mitchell Hashimoto、Steinberger、Mario Zechner（pi）は、AIの失敗から一行を足し、守らせられるものはhook、pre-commit、道具にする。n8n、beads、rigortype/rigorは、記録の形式や索引の上限をCIとテストで検査する。CLAUDE.mdの安全の規則のうち、組み込みの制御と対応していたのは4.4〜16%だった（arXiv 2608.23550）。
5. **一人の開発者がADRを試して戻した報告がある。** Greg Smethellsは、40件のうち意味があるのは5件ほどで、エージェントが毎回読み直していたと書き、100行までの設計ファイルとgitの履歴に戻した。ruby-gitのADRの説明は"At a hundred entries nobody reads any of it"と書き、書く条件を三つ（戻しにくい、コードだけでは理由が分からない、捨てた案に残す価値のある理由がある）に絞る。どちらも数字の測定ではない。
6. **理由を残す効果の測定は一件だけで、合成の設定である。** 規則ごとに理由を注記し、実行するモデルに見せる前に取り除く形は、指示の肥大を止め、遵守を最大23.1%上げた（arXiv 2608.11095、コーディングではない）。ADRを渡すかどうかでコーディングの成功率を比べた測定は見つからない。

## 凡例と方法

- 調べ方を三つに分けて並行で行った。ベンダーの文書とハーネス製品、名のある実践者、公開リポジトリと測定である。ベンダーの文書は他の方向と同じ重さで扱った。
- 直接取得: `gh api`、`gh search code`、curl、arXivのAPIとHTMLで本文を取り、原文を検索した。要約経由: WebFetchの要約を通したものは本文に書いた。
- 偏り: issueは否定側に、READMEと実践者の記事は肯定側に偏る。ADRを勧める記事の一部は、ADRの道具や相談業の宣伝である。GitHubのコード検索の件数は重複を含む。

## 根拠

### ベンダーとハーネス製品

- ADRを製品の仕組みとして文書化しているベンダーは無い。「設計の決定」は、指示ファイルや記憶に書く中身の例として出てくるだけである（Anthropic memory、Gemini CLI、Kiroの`structure.md`、Clineの`systemPatterns.md`）。
- AIが書く記憶を持つ製品は、どれも人が書く指示と分ける。Anthropic memoryの表は"Who writes it | You | Claude"と分ける（https://code.claude.com/docs/en/memory.md）。Codexは"Keep required team guidance in `AGENTS.md` or checked-in documentation. Treat memories as a helpful recall layer"と書く（https://learn.chatgpt.com/docs/customization/memories.md）。Kiroは"If a rule must apply consistently, write it in Steering."と書く（https://kiro.dev/docs/memory/）。CursorはAIが書くMemoriesを2.1で取り除き、Rulesへ書き出すよう案内した（https://forum.cursor.com/t/are-my-memories-gone/144057/3）。
- 指示の文に承認の印を持つ製品は無い。Kiroは"Treat steering changes like code changes - require reviews"と勧めるだけである。Spec Kitのconstitutionは`Ratified`の日付欄を持つが、その日付もエージェントが埋める（`templates/commands/constitution.md:97-99`）。
- Gemini CLIは、AIが"project-wide architectural decisions"を共有の`GEMINI.md`に直接書き、全セッションで読み込む。承認の段の記述は無い（`docs/tools/memory.md`）。この調査のきっかけの形に最も近い。
- AnthropicはCLAUDE.mdを"context, not enforced configuration"と呼び、必ず止めるならPreToolUse hookを使えと書く。Ciscoは、毒入りのnpmパッケージが`MEMORY.md`を書き換えた例を報告した（要約経由）。

### 実践者

- Michael Nygard（2011、https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions）は、ADRをリポジトリに置き、覆したら古いものにsupersededと印を付け、合意まではproposedとする。読み手は人である。
- Rahul Garg（martinfowler.com、2026-03-17）は、50行以内の機能ごとのメモを人がセッションの初めに渡す。AIに要約させたときは自分で直してから入れる。
- Dex Horthy（HumanLayer）とGeoffrey Huntleyは、エージェントが書いた調査や計画を読んで、だめなら捨てる。
- Jesse Vincentは、作業ごとの計画を`docs/plans/`に置き、「なぜ」は会話の記録そのものを必要なときに検索する（episodic-memory）。決定の記録の試み（cc-plugin-decision-log）は二日で止まっている。
- Simon Willisonは、エージェントに`git log`を読ませて文脈を作る。ChatGPTの記憶については"The entire game when it comes to prompting LLMs is to carefully control their context"と書いた。
- Drew Breunigは、誤りが文脈に入り繰り返し参照される失敗を"Context Poisoning"と呼ぶ。Armin Ronacherは、古くなった理由のコメントにエージェントが従い続ける例を書く。

### 公開リポジトリ

| リポジトリ | 決定の記録 | 読ませ方 | 書き手と承認 | 守らせ方 |
|---|---|---|---|---|
| n8n-io/n8n | `docs/adr/` | AGENTS.mdからリンク | "Write an ADR only when asked"、`Decision Owner`欄 | CIが場所、名前、日付、参照先を検査 |
| PAIR-code/deliberate-lab | `.agents/decisions/`に4件 | AGENTS.mdに一件一行の索引、本文は必要なとき | `status: draft / ratified / superseded` | なし |
| gastownhall/beads | `engdocs/adr/` | 下位の`engdocs/AGENTS.md`からリンク | 人 | リンク切れをテストで検査 |
| ruvnet/ruflo | 312件 | 番号を71KBの毎回のファイルに直書き | `authors: claude (Claude Code)`、承認なし | 不具合 #3179 |
| affaan-m/ECC | 自動の「instinct」 | SessionStartで差し込み | 0.7以上は"Auto-approved" | 不具合 #2841、#2746 |
| github/spec-kit | constitution | `/plan`が読む | エージェントが書き、人の確認は想定だけ | 文の関門だけ。#4431で肥大 |
| BMAD-METHOD | 実装の文脈と計画の文脈を分ける | 前者だけ毎回 | "you approve every change" | `lint_spine.py` |

- 大きいリポジトリ30件のうち、ADRを持つのは2件（airflow、n8n）だった。GitHubのコード検索では、AGENTS.mdのうち"docs/adr"を含むのは約2.3%だった（重複を含む）。
- 調べたコミュニティのハーネス16件のうち、自分で決定の記録を持つのは4件（ruflo、beads、pi、mattpocock/skills）で、毎回のファイルに本文を写すのはrufloだけだった。

### 測定

- arXiv 2608.11095: 1,867リポジトリでCLAUDE.mdなどは+226%に膨らみ、古い指示ほど消されない。理由の注記を実行するモデルから外して保守のときだけ使うと、余分な指示の99.3%を除けた（合成の設定）。
- arXiv 2602.12670（SkillsBench）: 人が整えたskillは+16.6ポイント、エージェント自身が書いたskillは−8.1〜−11.5ポイント。
- arXiv 2610.31715: 22,854リポジトリの指示のうち74.0%は理由を書かず、出来事や証拠を挙げるリポジトリは10.8%だった。ADRの割合は数えていない。
- arXiv 2608.23550: 481のCLAUDE.mdで、安全の規則のうち組み込みの制御と対応するのは4.4〜16%。
- arXiv 2602.07609: LLMは、コードから読める明示的な決定のADR違反は見つけるが、暗黙の決定やデプロイの決定は見落とす。

## 方式別の表

| 方式 | 前例 | 結果 | 失敗 |
|---|---|---|---|
| A. 決定の記録を毎回読み込む | ruflo、Cline Memory Bank、Gemini CLI | 測定なし | 参照先の欠落、規則の衝突、肥大（Codexは32KiBで切る） |
| B. 記録はリポジトリに置き、リンクか索引だけを毎回読ませる | n8n、deliberate-lab、beads、airflow | 測定なし | 開かれるとは限らない（Spec Kitの拡張で0/30） |
| C. 記録を持たず、小さな設計ファイルとgitの履歴に頼る | Smethells、Willison、pstackの`why` | 測定なし | 捨てた案の理由が残らず、同じ案がまた出る |
| D. AIが書いた記録を承認なしで決定扱いにする | ruflo、ECC、Gemini CLI、このリポジトリ | 自作skillは−8〜−11ポイント | 間違った規則、誰も読まない記録、人が書いたことにされた文 |
| E. AIは提案だけ、人が決めた記録だけを決定扱いにする | n8n、evolu、Davidson、Cherny、Steinberger、pstackの`reflect` | 測定なし | 承認の手間。印は文で、署名の仕組みは無い |

## 否定側の証拠

- ADRそのものを否定する測定は無い。NygardとThoughtworks Radar（Adopt、2017〜2018、AI以前）は、後から読む人のために残す理由を挙げる。数か月後に戻る一人の持ち主もこの読み手に当たる（推論）。
- ADRを渡すとエージェントの成果が上がるという測定も無い。
- 人の段を通した記録が正しく保たれるという測定も無い。肯定側は体験談である。
- 理由を添えるかは前例が割れる（Kiroは添えよ、pstackは混乱するときだけ）。

## 受け入れられたやり方と、各方式の失敗（判断）

証拠が支えること。

1. 決定の記録の本文を、毎回読み込まれるファイルに入れない。置くならリンクか索引までにする（結論1、方式B）。
2. AIが書いた記録は、人が決めたと確かめるまで決定として扱わない。誰が決めたかを記録に書く（結論2、方式E）。
3. AIを縛りたい決まりは、記録とは別に、hook、lint、テスト、CIか、毎回のファイルの短い一行に置く（結論4）。
4. 記録は少なく保つ。書く条件を絞り、AIは頼まれたときだけ書く（結論5、n8n）。

証拠が支えないこと。

- 決定の記録をすべて消すのが良いこと。一人の体験談（Smethells）しか無い。
- 記録を残すとエージェントの成果が上がること。
- 承認の印の決まった形。SteinbergerのAGENTS.MDにある日付つきの承認の文とn8nの`Decision Owner`は文で、検証できる署名ではない。

## 前例なし

- ADRを渡すかどうかで、コーディングの成功率や設計の守られ方を比べた測定。
- AIが書いた記録の「承認済み」を、検証できる形で記録する仕組み。
- AIが古い、または置き換え済みのADRに従って壊した、と書いた公開のissue（Davidsonの体験談はある）。

## 足りない証拠

- pstackの上流（poteto/pstack）はAPIで404だった。手元の写し（commit `519d36a`）で読んだ。
- OpenAIのharness engineeringの記事の本文（403、二次資料で読んだ）、Steve YeggeのMediumの記事（403）、Thorsten Ball（Amp）の記述。
- rufloのADR検査のスクリプトとCIの中身、oh-my-openagentの`context-and-decisions`のskill。
- arXiv 2611.04367、2602.07609、2604.03826は要旨だけ読んだ。
