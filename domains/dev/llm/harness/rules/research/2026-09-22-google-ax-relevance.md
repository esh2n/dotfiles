---
question: "Is google/ax (Google's open agentic orchestration runtime) a relevant design reference for jig?"
date: 2026-09-22
verdict: "google/ax is Kubernetes-scale distributed agent-orchestration infra, not a personal harness, so most of it is no-overlap with jig; the one adoptable piece is the Workspace resource's idempotent setup pattern (marker-file idempotence, non-destructive git clone via init/remote-add/fetch/checkout-f), which is directly usable design vocabulary for jig box."
unverified:
  - "google/ax used as a single-user coding-agent harness — no example found (ax is consistently cluster/enterprise scale)"
  - "ax's policy-guard equivalent (forbid/ask/permit tool-call gating) — no implementation found, only a removed/reserved proto field as negative evidence"
  - "named individual blogger or conference report on using ax — none found, only one vendor blog post and two independent GitHub issue analyses"
  - "quantitative cost, latency, or reliability results for ax in production — none found in vendor or issue sources"
  - "whether ax's UsageStats struct is actually aggregated or used anywhere — practitioner's 'unused' claim not independently traced to confirmation"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# google/ax としての妥当性 — jig への参考価値調査

対象: https://github.com/google/ax
調査日: 2026-09-22

## 0. 前提の確認（最重要）

`google/ax` は実在し、公開・非アーカイブのリポジトリである。同名で紛らわしい `ax-llm/ax`（TypeScript の LLM フレームワーク、別プロジェクト）とは無関係。今回はすべて `google/ax` のみを調査した。

- `gh api repos/google/ax` (直接取得, 2026-09-22T05:42 時点):
  `description: "Google's open agentic orchestration runtime"`, `language: Go`, `license: apache-2.0`, `stargazers_count: 6295`, `forks_count: 280`, `open_issues_count: 18`, `archived: false`, `created_at: 2026-03-30`, `pushed_at: 2026-09-20T03:33:20Z`, `homepage: https://agentexecutor.io`
- 直近リリース: `v0.3.0`(2026-09-20) / `v0.2.3` / `v0.2.2` / `v0.2.1` / `v0.2.0` / `v0.1.0` — 約5ヶ月で6リリース、活発にメンテされている。
- 直近コミット5件はすべて主要コントリビュータ `JBD`(= GitHub上のハンドル、`rakyll` = Jaana B. Dogan, Google の著名エンジニア)によるもの。`contributors` API 上位: `rakyll`(472 contributions), `joycel-github`(56), `wjjclaud`(45), `anj-s`(30) ほか。

**jig の文脈での要約**: google/ax は「個人用エージェントハーネスの CLI ツール」ではなく、**Kubernetes 上でエージェントタスクを大量・分散実行するための制御プレーン（サーバ + コントローラ + CLI）**である。kubectl 的な `ax apply/get/describe/watch/delete` を持ち、Redis をストアに使い、実行の隔離は別リポジトリ `agent-substrate/substrate`（Google の Kubernetes ネイティブなサンドボックス基盤、6295 star 中の姉妹プロジェクト、star 2634 / open issues 514）に委譲する。jig とはスケールも実行環境も前提が大きく異なる。

## 1. Vendor レンズ

- README (`gh api repos/google/ax/readme`, 直接取得・全文デコード): 冒頭に `> [!WARNING] We are still actively refining our core concepts... major breaking changes prior to a stable release.` と明記 — ベンダー自身が未安定と言っている。
  - 中核の説明: *"AX is a high-throughput, declarative orchestrator to run billions of autonomous agent workloads in a cluster. It runs on top of Agent Substrate for sandboxed execution... If you have used Kubernetes, `ax` will feel similar."*
  - 4つの宣言的リソース: `Task`（隔離実行の最小単位）, `Workspace`（Git/MCP/skills の事前配線）, `Gateway`（egress allowlist）, `Model`（プロバイダ設定＋k8s secret 参照）。
- Google Cloud Blog（WebFetch 経由、要約フェッチ — 全文ではなく抽出結果。マークとして明記）: https://cloud.google.com/blog/products/ai-machine-learning/agent-executor-googles-distributed-agent-runtime
  - 発表日 2026-05-21、ステータス "preview"。ターゲットはエンタープライズ（"hundreds of millions of registered agents" という規模感、on-prem/hybrid/cloud、データ主権・ベンダーロックイン回避が動機）。
  - 具体的なベンチマーク数値は掲載なし（要約フェッチによる確認、"No specific performance benchmarks provided" と抽出結果が明記）。
  - Antigravity 2.0（Google のエージェントハーネス）は ax でオーケストレーション**できる**選択肢の一つであり必須ではない、と説明。
- `agent-substrate/substrate` README からのクロスリンク（`gh search code "github.com/google/ax"` 経由で発見・直接取得確認）: *"Agent Executor: A distributed agent runtime that demonstrates building a secure, hyper-scalable agent harness on Agent Substrate (see the announcement blog and integration guide)"*。ax は Agent Substrate の「上に乗る一実装例」という位置付け。
- ドキュメント本文（`docs/concepts.md`, `docs/sandbox.md`, `docs/runner.md`, `docs/manifests.md`, `DESIGN.md` — すべて `gh api .../contents/...` で直接取得・全文デコード済み）から実装の実態:
  - `Gateway` の egress 制御はホスト＋ポート単位のアローリスト。`docs/manifests.md` の公式サンプルは `host: "*"` を443番ポートで許可し、コメントで `# allow everything on 443; tighten this in production` と書かれている＝**デフォルトが allow-all** であることをベンダー自身のサンプルが示す。
  - `pkg/apis/v1alpha1/ax.proto` に `// Field 9 was policies (budget and approval config), removed for now.` / `reserved "policies";` と明記（`gh search code "policies" --repo google/ax` で発見、直接確認）。予算/承認ポリシーのフィールドは**一度設計されて削除**されている。jig の (a) policy guard に最も近い概念が、ax では「作られなかった／撤去された」ことが一次資料で確認できる。

## 2. Practitioner レンズ

named な個人ブログは見つからなかったが（`gh search` はコードホスティング上のみで、汎用 Web 検索は本調査では使えなかった）、GitHub 上で**独立した2つのプロジェクトが google/ax をソースコードレベルで読み込んで比較分析**しており、これが実質的な practitioner エビデンスとして最も濃い。

- Issue: https://github.com/Glubiz/zirv-cli/issues/715 (`zirv` という別のローカル単一ユーザー向けハーネス supervisor の開発者による分析、2026-09-21)
  > "ax is cluster infrastructure. It owns the sandbox, the network and the process tree, and delegates the hard parts (snapshotting, egress enforcement, crash detection) to its substrate. zirv is a local, single-user supervisor of harnesses it does not control."
  - 良い点として: 宣言的ワークスペース事前配線、レベルトリガー式の冪等な reconcile、Phase+Conditions（理由コード付き）、終端フェーズで止まる watch stream、コマンド終了後も生き続けるスーパーバイザ、strict なマニフェストデコード。
  - 悪い点として（コピーするな、の指摘）: 予算/承認ポリシーが死んだスキーマ（`policies` フィールド削除・`UsageStats` 未使用と主張）、egress が443番デフォルトで allow-all、モデル API キーがエージェントコンテナ環境変数に直接注入、Phase/Condition の reason が自由文字列でドリフト済み（"Completed" は照合されるが設定されない）、reconcile 失敗が ACK されて再試行されない、watch stream に resume cursor がない。
- Issue: https://github.com/Colonizer-dev/harness/issues/219（別の Docker/VM ベースのエージェントハーネス "Colonizer" 開発者による、v0.3.0・SHA `d8ed0fe` 時点でのファイル:行番号付き精読、2026-09-20〜21）
  > "MCP servers are never launched... No warm pool, no daemon, no config file written... Skill packages are never installed. setupSkills() is literally `os.MkdirAll(skills.Path, …)`"
  - この最後の主張を本調査でも `internal/workspace/setup.go` を直接取得して**検証済み**（下記 verbatim）。practitioner の指摘は正確だった。
  - 同issueは実装済みの部分（マーカーファイルによる冪等な初回セットアップ、`git init`→`remote add`→`fetch`→`checkout -f` という非破壊的なクローン手順、失敗しても致命的にしないリトライ設計）も高く評価しており、jig の `jig box` 設計に直接転用できる語彙を提供している。
- Issue: https://github.com/google/ax/issues/358（外部コントリビュータ `loafoe` による arm64 ビルド不具合報告、2026-09-21。fork からの PR が作れない — `pull_request_creation_policy: collaborators_only` — ため issue に留まっている）＝外部貢献の摩擦の実例。

**検証した verbatim（一次資料）**: `internal/workspace/setup.go`（`gh api repos/google/ax/contents/internal/workspace/setup.go` で直接取得）
```go
// setupSkills creates the skills directory if one is declared and returns its path.
func setupSkills(skills *v1alpha1.SkillsConfig) string {
	if skills == nil || skills.Path == "" {
		return ""
	}
	if err := os.MkdirAll(skills.Path, dirPerm); err != nil {
		slog.Warn("creating skills dir", "path", skills.Path, "error", err)
	}
	return skills.Path
}
```
スキル配布の実装は「ディレクトリを掘るだけ」であり、レジストリからの取得・展開ロジックは無い。`internal/workspace/planner.go` も practitioner の主張どおり「テスト以外から呼ばれていないデッドコード」（本調査では `gh search code` で参照元を確認、`planner.go` の import は `internal/workspace/planner.go` 自身のみが目立つ）。

## 3. Measured レンズ

| 指標 | 値 | 出典 |
|---|---|---|
| Stars / Forks / Watchers | 6295 / 280 / 6295 | `gh api repos/google/ax` |
| Open issues | 18 | 同上 |
| リリース数・cadence | v0.1.0→v0.3.0、2026-07-21〜2026-09-20（約2ヶ月で3マイナー版） | `gh api repos/google/ax/releases` |
| 作成日 | 2026-03-30 | 同上 |
| 最終 push | 2026-09-20T03:33:20Z（調査時点で2日前） | 同上 |
| Contributors 上位 | rakyll 472, joycel-github 56, wjjclaud 45, anj-s 30 | `gh api repos/google/ax/contributors` |
| 姉妹リポジトリ `agent-substrate/substrate` | star 2634 / forks 364 / open issues 514（Substrate 本体は issue が非常に多く、動きが激しい） | `gh api repos/agent-substrate/substrate` |
| ベンダー発表の規模感 | "hundreds of millions of registered agents"（設計目標であって実測ではない） | Google Cloud Blog（要約フェッチ） |
| パフォーマンスベンチマーク | 発表記事に数値なし | 同上（"No specific performance benchmarks provided" と抽出結果が明記） |

数値の評価バイアス: star/fork/issue 数は GitHub 上の人気指標であり、実運用での定量評価（レイテンシ・コスト・信頼性）は一次資料に一切登場しない。「no numbers」と明記する。

## 4. In the wild レンズ

- Fork 数280、直近フォークは調査当日（2026-09-22）にも発生（`gh api repos/google/ax/forks?per_page=1` で確認、Link ヘッダから281ページ＝281件相当のページネーションを確認）。
- `gh search code "github.com/google/ax"` で発見した外部言及:
  - `killop/anything_about_game:AI.md` — 単なるリンク集への追加（"Google's open source distributed agent runtime"）。
  - `electric-sql/electric:website/blog/posts/2026-06-04-serverless-agents.md` — ElectricSQL のブログ記事が "Google Agent Executor (AX)" を「エージェントロジックとツール実行環境を明確に分離する」設計例として言及（2026-06-04、発表の2週間後）。
  - 前述の zirv-cli / Colonizer-dev/harness の2件の独立分析 issue。
- 導入事例としての "coding-agent harness の中で使われている" 直接証拠は見つからなかった。見つかったのは「他のハーネス開発者が参考にして自分のプロジェクトに何を輸入するか検討した」形の間接的採用（設計の借用であって、ax 自体を組み込んで使っている例ではない）。
- 外部コントリビュートの摩擦: `pull_request_creation_policy: collaborators_only` のため、fork からの PR が作れず issue 止まり（issue #358 で実例確認）。

## まとめ表

| Source | Task type | Result | Cost/scale numbers | Named failure modes |
|---|---|---|---|---|
| google/ax README + docs (vendor, 直接取得) | infra design | 4つの宣言的リソースで k8s 上にエージェントタスクを分散実行 | "billions of tasks per cluster"（宣言、未実測） | 自己申告で "still actively refining... major breaking changes"（安定版でない） |
| Google Cloud Blog (vendor, 要約フェッチ) | infra design / enterprise pitch | 長時間実行エージェントの耐久実行・再開を解決すると主張 | "hundreds of millions of registered agents"（設計目標） | ベンチマーク数値なし |
| zirv-cli issue #715 (practitioner, 直接取得) | ソースコード精読による比較 | 6項目を高評価、7項目を「コピーするな」と明示 | file:line 単位の根拠あり | policies 削除・egress allow-all・API key 直接注入・reconcile 失敗の再試行なし 等 |
| Colonizer-dev/harness issue #219 (practitioner, 直接取得) | ソースコード精読による比較 | Workspace の宣言的事前配線パターンを高評価、MCP/skills の実装欠如を指摘 | v0.3.0 SHA `d8ed0fe` 時点、file:line 単位 | MCP サーバは起動されない／skills は mkdir のみ（本調査で verbatim 検証済み） |
| google/ax issue #358 (in the wild, 直接取得) | ビルド不具合報告 | arm64 クラスタで exec format error | — | fork から PR できず issue のみで滞留 |

## jig の (a)–(e) へのマッピング

- **(a) hook から評価される policy guard（forbid/ask/permit、shell/fs/net/mcp 粒度）**: **no overlap（直接の対応物なし）**。ax の `Gateway` はタスク単位のネットワーク egress allowlist（ホスト＋ポート）のみで、jig のような個々のツールコール（shell/fs/net/mcp）を forbid/ask/permit で裁定する粒度は存在しない。さらに、予算・承認に関するポリシー機構は proto レベルで一度設計されて `reserved "policies"` として撤去済み（`pkg/apis/v1alpha1/ax.proto`）——「作ろうとしてやめた」という否定的エビデンスとして扱う。egress allowlist の「宣言的にホストを絞る」という発想自体は jig の net 判定のごく一部（ネットワーク到達可否）には参考になり得るが、デフォルト allow-all のサンプルをそのまま真似るのは避けるべき、と practitioner (zirv-cli) も一次資料から独立に指摘している。
- **(b) インタラクティブなエントリポイント（agent / host-or-box / new-or-resume の選択）**: **no overlap**。`ax` CLI は kubectl 型のサブコマンド（`apply/get/describe/watch/delete/suspend/resume/ssh`）であり、対話的な選択 UI は無い。`ax suspend`/`ax resume` という「一時停止して後で再開する」ライフサイクル概念自体は jig の new-or-resume の語彙として参考になるが、UI/UXとしての「選ばせる」設計は無い。
- **(c) `jig box`（Docker Sandboxes microVM + repo clone + kit files でのエージェント起動）**: **partially applicable（設計語彙として最も近い）**。`Workspace` リソースによる「エージェント起動前に Git clone・MCP・skills を宣言的に用意し、初回起動時にマーカーファイルで冪等化する」という設計（`docs/concepts.md`, `internal/workspace/setup.go`）は、jig の kit files による config 配信と同じ問題（=エージェントの最初のターンまでに環境を温めておく）を解いている。ただし実行基盤は Kubernetes + Agent Substrate であり、jig の Docker Sandboxes microVM とはスケールも運用モデルも別物。**採用可**: マーカーファイルによる「セットアップ済みなら再実行しない、失敗したら次回リトライする」という冪等パターン、`git init`→`remote add`→`fetch --depth`→`checkout -f FETCH_HEAD` という非破壊的クローン手順（通常の `git clone` ではない）。**コピー不可**: MCP/skills 配布の実装そのもの（ax は実装しておらず、mkdir するだけ — 本調査で検証済み）。
- **(d) 5ハーネス分の rules/skills/agents/hooks/MCP config を描画する config generator**: **no overlap**。ax の `Workspace.spec.mcp` / `spec.skills` はスキーマとしては存在するが、複数の異なるコーディングエージェント（Claude Code / Codex / pi / DSH / omp 相当）向けにネイティブ形式へレンダリングする仕組みは無い。ax が想定する「ランナー」は1つの `spec.command` であり、jig のような「同じルール/スキルを複数ハーネスのネイティブ設定へ描き分ける」問題そのものを扱っていない。MCP レジストリ解決・skills レジストリ解決は未実装（クライアントが存在しない）。
- **(e) コスト/モデル階層化とオブザーバビリティ**: **partially applicable（弱い）**。`Model` リソースは「プロバイダ・モデルID・生成パラメータ・k8s secret 参照」を1つの再利用可能なリソースとして宣言する、という発想自体は jig のモデルプロファイル管理の参考になり得る。ただし ax 自体にコスト階層化（tier escalation）のロジックは無く、`UsageStats`（トークン数を持つ構造体、`internal/model/client.go`）は推論呼び出し単位で存在するが、practitioner (zirv-cli) の主張では集計・活用されていない、と指摘されている（本調査ではこの「未使用」の主張までは独自に追跡しきれておらず `[unverified]`）。

## 見つからなかったこと（no precedent found）

- google/ax を「個人用・単一ユーザーの」コーディングエージェントハーネスとして使っている実例（ax は一貫してクラスタ／エンタープライズ規模を前提にしている）。
- ax の policy guard 的な機能（forbid/ask/permit のツールコール単位裁定）の実装例・設計提案。存在するのは「あった方がいいと設計され、撤去された」という否定的エビデンスのみ。
- named な個人ブロガー・カンファレンス発表による使用レポート（見つかったのは組織アカウントのブログ記事1件と、GitHub issue 上の技術分析2件のみ）。
- 実運用でのコスト・レイテンシ・信頼性の定量結果（ベンダーブログにも issue にも数値なし）。
- `UsageStats` が実際にどこかで集計・可視化されているかどうかの一次資料上の確証（practitioner の「未使用」主張は本調査では追跡未完了）。

## 検証手段の凡例

- 「直接取得」= `gh api` で該当ファイル／エンドポイントを取得し全文を読んだもの。
- 「要約フェッチ」= WebFetch によるプロンプト経由の要約結果（Google Cloud Blog 1件のみ）。全文ではなく抽出結果であることを明記。
- `[unverified]` マークがある箇所は、practitioner の主張を裏取りしきれなかったもの。
