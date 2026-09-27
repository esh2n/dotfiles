# 一人に任せるサブエージェントと、大勢を並べる Swarm/agent teams — 一つの仕組みか、別々の仕組みか

日付: 2026-09-27。前提となる既存記録（再調査していない）:
- `harness/rules/research/2026-09-27-swarm-on-omp-pi.md`
- `harness/rules/research/2026-09-27-swarm/kimi-code.md`
- `harness/rules/research/2026-09-27-swarm/references.md`
- `harness/rules/research/2026-09-27-swarm/fit-omp-pi.md`
- `harness/rules/research/2026-09-22-orchestration-*.md`（否定側の背景）

確立済み（再確認しない）: Kimi Code は `Agent` と `AgentSwarm` を別の道具として持つ／Claude Code はサブエージェント（Agent 道具）と agent teams を別の仕組みにしている／omp はサブエージェントが `task` 一本で、Agent Hub で全部の子を見られる。

推奨は書かない。判断材料のみ。

---

## 方法・検証範囲

- 直接一次資料: ベンダー公式 docs の WebFetch（原文が返る形式のため実質一次）、GitHub REST API（`api.github.com`、認証なし curl）、GitHub raw README の直接 curl。
- 要約経由: 一部の WebFetch は「要約」と明記されたもの（omp docs の一部、GitHub issue の要約）。原文の逐語一致は未検証な箇所は都度「(要約経由)」と記す。
- gh CLI: 使用していない（認証トークン読み出し操作の回避、および既存記録がこのサンドボックスで `gh` の TLS 検証が失敗すると記録しているため）。全て `curl` 経由の未認証 REST API。
- 到達不能: X (Twitter) の発端投稿本文、omp CHANGELOG 差分、一部ブログの原文全体。

---

## 1. ベンダー

### Claude Code — 「別の仕組み」だが、実行時に境界が滲む一次資料

`https://code.claude.com/docs/en/agent-teams`（直接 WebFetch、原文取得）:

> "Before you set up a team, check whether a lighter option does the job. Subagents work within a single session... "

比較表(原文引用、抜粋):
> | Coordination | Main agent manages all work | Self-coordination through messages, plus a shared task list |

これは「別の仕組み」という設計だが、同じページに**「サブエージェントを使うと teams の一覧に出るのか」という持ち主の疑問に直接答える一次資料**がある:

> "Enabling agent teams also changes ordinary delegation. Claude may name a subagent on its own, and while agent teams are enabled, a subagent that Claude names launches as a teammate, so teams can form even when you didn't ask for one."

> "Subagents appear in the same agent panel as teammates, so the panel alone doesn't confirm a team formed. If Claude spawned subagents instead, ask again and explicitly request an agent team."

トラブルシューティング節にも同じ趣旨が明記されている:
> "### Claude spawns teammates instead of subagents / While agent teams are enabled, a subagent that Claude names in the lead's session launches as a teammate. Claude can name subagents on its own, so this can happen during delegation you never framed as team work."

→ Claude Code は「サブエージェント」と「agent teams」を**設計上は別の仕組み**として説明しながら、**表示（agent panel）は共有**しており、しかも**agent teams が有効なら「名前付きサブエージェント」は自動的に teammate として起動する**——つまり「サブエージェントを呼んだら勝手に teams 側の一覧に出る」という持ち主の予想は、Claude Code に関しては**部分的に正しい**（ただし「一律にそうなる」ではなく、agent teams フラグが有効な場合に限る、かつ無効化できる: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0`）。

なお agent teams は既定 off の実験的機能（`2026-09-27-swarm/references.md` 78-83行、既存記録で確認済み、再掲のみ）。

### omp — ネイティブには「swarm」という別概念がそもそも無い

`https://omp.sh/docs/subagents`（WebFetch、要約経由）:
> 列挙されるのは `scout`/`designer`/`reviewer`/`security-reviewer`/`librarian`/`task`/`sonic` の specialist 群のみ。「'swarm' 機能への言及はない」「全ての委譲作業は同じ Agent Hub の一覧に統一表示される」(要約経由)。

→ omp 本体には「一人 vs 大勢」を分ける道具が最初から存在せず、`task` 一本と Agent Hub 一覧だけ（`2026-09-27-swarm-on-omp-pi.md` の確立済み事実と一致）。この家で作った `swarm` 拡張は、omp ネイティブの区分を模したものではなく、**omp に無かった概念を持ち込んだもの**という位置づけになる。

omp の実際のソースツリー(`https://api.github.com/repos/can1357/oh-my-pi/contents/packages`, 直接 REST API, 2026-09-27 取得)には以下のパッケージのみ存在する:
```
agent, ai, browser-relay, catalog, coding-agent, collab-web, metaharness,
mnemopi, natives, omptype, snapcompact, stats, tui,
typescript-edit-benchmark, utils, wire
```
**`swarm-extension` というパッケージは存在しない。** これは後述する練習者ブログの記述（`packages/swarm-extension/*`）と食い違う一次資料であり、そのブログの信頼度を判断する材料として扱う（§2参照）。

### Kimi Code — 別ツールのまま、統合の動きは無い（既存記録の裏取り済み事実の再掲のみ、新規追記なし）

`kimi-code.md` 1-20行で確認済み: `Agent` と `AgentSwarm` は別ツール、`MAX_AGENT_SWARM_SUBAGENTS = 128`。新たに確認した事実として、Swarm と並存する実験機能 Tower は Swarm と**排他**であり、統合ではなく「別モード」として扱われている:
`kimi-code.md` 74行:
> "Tower と Swarm は排他: PR #3976(`feat(tower): enforce protocol invariants and deny AgentSwarm`, 2026-09-23)が Tower モード中の `AgentSwarm` 呼び出しを拒否する"
https://github.com/MoonshotAI/kimi-code/pull/3976

→ Kimi Code の設計判断は一貫して「別々の道具・別々のモードのまま、互いを禁止し合う形で線引きする」であり、一つに畳み込む方向には進んでいない。

---

## 2. 実践者（named）

### @voidwarriorchan — 確認できず（既存記録の再確認、追加調査でも変わらず）

`https://api.fxtwitter.com/voidwarriorchan`（直接 curl、2026-09-27 再取得）:
```json
{"screen_name":"voidwarriorchan","followers":8484,"following":26,"tweets":6366,
 "description":"Any sufficiently advanced technology is indistinguishable from magic. | Building AI-native systems.",
 "location":"Tokyo, Japan","verification":{"verified":true}}
```
プロフィールの実在は確認できるが、fxtwitter のプロフィールエンドポイントはタイムラインを返さないため、指定の投稿を辿る手段がこの環境には無い。WebSearch でも該当ツイートはヒットしなかった（`references.md` 21-27行で既に試行済みのクエリ群を再実行、結果は変わらず）。**「確認できず」を維持する。**

### makoMakoGo（個人ブログ、実名確認はできないが継続的に技術記事を書く名乗りのある個人）— 「二つは違う」と自分の理解を書いた実例、ただし一次資料と食い違う記述あり

`https://makomakogo.github.io/posts/2026/05/06/omp-agents-subagents-and-swarm.html`（直接 curl、HTML除去して原文取得、2026-05-06 付、著者名 makoMakoGo）:

> "Oh My Pi 里实际上有两套相关但不同的多代理能力：内建的 subagent / task delegation（...）YAML + DAG 的 swarm workflow（...）"
> "最容易混淆的地方在于：二者底层都会用到 Oh My Pi 的子代理执行能力。但上层使用方式完全不同。"
> （日本語訳: 「Oh My Pi には実際には関連するが異なる二つのマルチエージェント能力がある。内蔵の subagent/task delegation と、YAML+DAG の swarm workflow。最も混同しやすいのは、両者とも下層で Oh My Pi の子エージェント実行能力を使うが、上層の使い方は全く違うという点」）
> "所以对于'先学会用'，默认是合适的。"（「まず使い方を覚える」なら既定のままが適切）

これは「一人に任せる委譲」と「大勢の swarm」を**意図的に別の心的モデルとして分けて運用している実例**であり、著者自身が「混同しやすい」と明言している点は、持ち主の疑問（「使うと全部一覧に出るのか」という混乱）と同種の問題意識を裏付ける。

**ただし重大な留保**: 記事は swarm-extension のコードパスを `packages/swarm-extension/*`（`packages/coding-agent/src/task/*` と対比）と明記しているが、§1で直接 REST API 確認した実際の `can1357/oh-my-pi` の `packages/` 一覧に `swarm-extension` は存在しない。この記事が指す「swarm-extension」が(a) 過去に存在し削除された、(b) 別の fork/未マージブランチの話、(c) 記事自体が実装を正確に反映していない、のいずれかは判別できない。**この記事の技術的細部（コードパス）は一次資料と食い違うため、事実としてではなく「実践者がこう理解している(いた)」という記録としてのみ扱う。**

### bigs（GitHub ユーザー、omp-swarm 作者）— 「別のまま置く」という設計判断の一次資料

`https://raw.githubusercontent.com/bigs/omp-swarm/main/README.md`（直接 curl、原文取得）、リポジトリは `https://api.github.com/repos/bigs/omp-swarm`（直接 REST API）で `created_at: 2026-09-25T20:14:08Z`（**この調査の2日前に作成**）、`stargazers_count: 0`、`forks_count: 0`、`open_issues_count: 0`。

README 原文(該当部分):
> "**Main agent only**: task subagents don't see the swarm tool. The main agent relays for its own subagents through omp's normal hub."
> "Incoming messages are injected into the live agent loop, the same way omp's built-in agent hub delivers messages between subagents."

→ omp の `task` サブエージェントに対して、複数**セッション**間の group chat を提供する第三者プラグインの作者が、**明示的に「task サブエージェントには swarm 道具を見せない」設計**を選んでいる。理由の明文はないが、「main agent だけが両方を扱い、サブエージェントはどちらか一方の経路しか持たない」という**役割分離**の形。ただし★0・作成2日・実運用報告ゼロであり、**「これが正しい」という裏付けにはならない**——あくまで直近の独立した一設計判断の記録。

### yeluo45/oh-my-pi-design（第三者の設計文書、omp 公式ではない）

`https://yeluo45.github.io/oh-my-pi-design/en/docs/16-swarm-extension`（WebFetch、要約経由）:
> 「これは omp 公式文書ではなく第三者の設計文書」「`subagent` という一つの道具が fan-out/map/chain/debate という複数の実行戦略を持つ形で説明されている」(要約経由)

→ こちらは逆方向、**一つの道具に一人でも大勢でも渡す統合案**の実例。ただし公式でも実装済みの証拠でもなく、「設計提案」止まり。makoMakoGo のブログが言及する `packages/swarm-extension/*` とも一致しない別の第三者資料であり、**omp 周辺には「統合案」「分離の実プラグイン」「omp 本体は最初から区分自体を持たない」という3つの異なる立場が同時に存在している**ことが分かる。

### Claude Agent Teams を使うのをやめた実践者（既存記録の再掲、著者名不明のため参考扱い）

`references.md` 111-114行（既存記録）: Medium記事「Claude Agent Teams: Why I Stopped Using Them」、著者名は本文から確認できず「named notable practitioner の基準は満たさない」と既存記録が明記。参考情報として再掲のみ、新規調査はしていない。

---

## 3. 測定評価

### ツール選択の精度低下（一般論、swarm/subagent 専用ではないが直接関連）

`https://github.com/langchain-ai/langgraph/issues/8818`（WebFetch、要約経由、原文引用部分あり）:
> "a tool that promises more (real-time, guaranteed, most comprehensive, etc.) gets preferred over a plainer, correct one, regardless of what either tool actually returns."
再現例: 2つの似た名前のツールが両方使える場合、モデルは説明文の説得力だけで選び、実際の正しさでは選ばない。関連する攻撃手法として ToolHijacker(arXiv:2504.19793) への言及あり。**Issue はオープンのまま、解決策・マージされた修正は確認できず。**

WebSearch 要約（一般記事、TianPan.co ブログ, dev.to, 個別著者名は確認していないため参考扱い）:
> 「Tool selection accuracy drops to 13% when LLMs face large tool sets」「Using semantic retrieval... increased tool selection accuracy from 13.62%...to 43.13%」

→ これらは「サブエージェント vs Swarm」に特化した測定ではなく、**ツール数が増えて名前・説明が似ると選択精度が落ちる**という一般的な現象の測定。task と swarm という似た名前・似た機能の道具を並べること自体が、この現象の対象になりうるという間接的な裏付け。**直接「subagent と swarm の選び間違い率」を測った論文・ベンチマークは見つからなかった。**

### コーディング以外の否定側（既存記録の再掲のみ）

`references.md` 70-74行: arXiv 2606.13003「automatic MAS consistently underperform CoT-SC despite being up to 10x more expensive」——推論・検索課題であり**コーディングタスクではない**。Shopify Engineering「Avoid multi-agent architectures early」も既存記録の再掲。これらは「複数エージェントを増やすこと自体」への否定的測定であり、「一つにまとめるか分けるか」という表示・道具設計の問題への直接の測定ではない。

---

## 4. 実態（公開リポジトリ）

| リポジトリ | 形 | 状態 | 出典 |
|---|---|---|---|
| `bigs/omp-swarm` | 分離（task はswarm道具を見ない） | ★0・fork0・open issue0、作成2026-09-25（2日前） | https://api.github.com/repos/bigs/omp-swarm |
| `jmcjm/Hivemind`（既存記録） | herdr上でcoordinator/drone分離、独自パネル | ★2、既知の制約複数（3回リトライ上限、30分でnotification失効） | `references.md` 30行 |
| `bandoyer/swarm-forge-herdr`（既存記録） | herdr移植、unclebob/swarm-forge の思想 | ★0 | `references.md` 31行 |
| `wweir/tower-do`（既存記録） | pi拡張、Kimi Towerの軽量移植、advisory止まり(ブロックしない) | ★0、created 2026-09-06、pushed 2026-09-23 | `kimi-code.md` 85-88行 |
| `tmustier/pi-agent-teams`（既存記録） | pi拡張、独自チーム機構 | main停止2026-06-12から、プロセスクラッシュissue #50放置(2026-09-10)、issue #9(ディスク肥大化)対応PRが5ヶ月未マージ | `references.md` 119-139行 |
| `can1357/oh-my-pi` issue #2209 | 異なるagent形式(Claude Code custom agents)をomp task subagentとして誤って広告 | PR #2210でクローズ済み、schema不一致が根本原因 | https://github.com/can1357/oh-my-pi/issues/2209 |
| `can1357/oh-my-pi` issue #6032 | hubで複数task agentが相互waitしデッドロック、無エラーで45秒待たされる | `wontfix`ラベル、未修正のまま | https://github.com/can1357/oh-my-pi/issues/6032 |

issue #2209 は「サブエージェントとswarm」の話ではなく「異なるハーネスのagent形式を無理に一つの入口に混ぜた」ケースだが、**似た形式を一つの仕組みに寄せようとするとスキーマ不一致が実害になる**という同種の教訓として扱う:
> "Claude Code custom agents and OMP task agents do not appear to share the same full schema or runtime contract."（要約経由）

issue #6032 は「一覧に出る/出ない」ではなく、**task同士(=一人に任せる委譲を複数使ったとき)がお互いを待ち合ってデッドロックする**という、Swarm を持ち出さずとも既に起きている調整の破綻例。`wontfix` のまま(要約経由)。

---

## 比較表(まとめ)

| 項目 | まとめる方向の証拠 | 分ける方向の証拠 | 否定側(両方に共通) |
|---|---|---|---|
| ベンダー | Claude Code: agent teams有効時、名前付きサブエージェントは自動的にteammateとして起動し**同じagent panelに出る**(公式docs) / yeluo45設計文書: 一つの`subagent`道具にfan-out/map/chain/debateを持たせる案(第三者、未実装確認) | Kimi Code: Agent/AgentSwarmは別ツールのまま、Towerとも排他(PR #3976) / omp: ネイティブにswarm概念自体が無い(実ソース`packages/`に`swarm-extension`なし) / Claude Code: 「別の仕組み」と明記した比較表・使い分けガイド | Claude Code agent teams自体が既定offの実験的機能。「サブエージェントのつもりがteamになった」ケースをベンダー自身がtroubleshooting節に載せている=起きている問題として認知済み |
| 実践者 | (統合を選んだ named practitioner の一次報告は見つからず) | makoMakoGo: 「二つは関連するが別」と自分で心的モデルを分けて運用、「混同しやすい」と明言(ただしコードパスの記述が一次資料と不一致) / bigs(omp-swarm): taskにswarm道具を見せない設計を選択(★0・2日前) | @voidwarriorchanの発端投稿は確認できず。Medium「Claude Agent Teams使うのをやめた」は著者名不明で参考止まり |
| 測定 | (統合の方が精度が高いという測定は見つからず) | langgraph #8818: 似た名前・説明のツールが並ぶとモデルは説得力だけで選び正しさで選ばない(open issue、未解決) / 一般論: ツール数増加・類似ツールで選択精度が13%程度まで低下する報告(二次情報) | いずれもswarm/subagent専用の測定ではなく一般的なツール選択問題からの類推。直接測定した論文は無い |
| 実態(gh) | 一つの入口に寄せようとした`omp` issue #2209は**スキーマ不一致で問題化**しクローズ済み修正(PR #2210) | `bigs/omp-swarm`・`wweir/tower-do`は独立して「別ツールとして追加する」形を選択、いずれも★0で採用実績なし | `pi-agent-teams`はmain停止・クラッシュ放置。`omp` issue #6032はtask同士のデッドロックがwontfixのまま=分けても調整問題は残る |

---

## 平易な言い方でのまとめ

- 「サブエージェントを使うと全部Swarmの一覧に出るのか」という持ち主の疑問に**最も近い一次資料**は、Claude Codeの公式docsが書いている「agent teamsが有効なとき、名前付きサブエージェントは勝手にteammateとして起動し、同じagent panelに出る」という挙動。ただしこれは**Claude Code固有かつagent teams有効時限定**の話であり、「サブエージェントを使えば常にSwarm一覧に出る」という一般法則ではない。omp・Kimi Codeにはこの挙動は無い（omp はそもそもswarm概念自体を持たず、Kimi Codeは別ツールのまま排他関係）。
- 「一つにまとめる」を実際にやって成功したと報告した named practitioner の一次資料は見つからなかった。逆に「別のままにする」を選んだ実装例（bigs/omp-swarm、Kimi CodeのTower/Swarm排他）と、「別だが混同しやすい」と書いた実践者（makoMakoGo）は見つかった。
- 数字で「まとめた方が良い/悪い」を測った研究・ベンチマークは無かった。あるのは「似た名前のツールが並ぶとモデルの選択精度が落ちる」という一般的な測定（swarm専用ではない）と、「複数エージェント自体がコスト高で推論・検索タスクでは単一より弱い」という既存記録の否定側（コーディングタスクの結果ではない）。
- 実態（GitHubリポジトリ）では、まとめようとした唯一の実例（omp issue #2209、異なるagent形式を一つのtask入口に混ぜた）はスキーマ不一致で問題化し個別に直された。分けた実例（bigs/omp-swarm、wweir/tower-do）はいずれも作成から日が浅く★0で、採用実績としての裏付けにはならない。

---

## 確認できなかったこと（明示リスト）

1. @voidwarriorchan の発端投稿本文（herdr/kubectl風表示/Astra用Swarm）。プロフィールは実在確認済みだが、タイムライン遡及の手段がこの環境に無い。
2. makoMakoGoブログが言及する `packages/swarm-extension/*` の実在性。直接REST APIで確認した `can1357/oh-my-pi` の `packages/` 一覧には存在しない。過去に存在したか、別ブランチか、記事自体の不正確さかは判別できない。
3. yeluo45/oh-my-pi-design の運営主体・omp本家との関係（第三者の設計文書か、公式に近い草案かは未確認）。
4. 「サブエージェントとSwarmを一つの道具にまとめた」ことで成功したと報告する named practitioner の一次資料。検索では見つからなかった。
5. 「似た名前の道具を並べたときの選び間違い率」を直接測定した、subagent/swarm専用の論文・ベンチマーク。一般的なツール選択研究の類推のみ。
6. Claude Code agent teams のリリース日・バージョンの一次確認（`references.md` 161行で既に「未検証」と記録済み、今回も再確認していない）。
7. bigs/omp-swarm・wweir/tower-doの実運用報告（issue・使用者の声）。★0・作成直後のため存在しない可能性が高いが、悉皆確認はしていない。
