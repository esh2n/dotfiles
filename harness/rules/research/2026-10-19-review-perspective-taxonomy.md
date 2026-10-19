# レビュー観点の全体（110 行）と、今の reviewer がどこまで受け持っているか

調査日 2026-10-19。突き合わせの対象は HEAD `36e1922f` の `harness/`。reviewer（レビューを受け持つサブエージェント）は `code-reviewer`、`security-reviewer`、`workload-reviewer`、`ui-reviewer`、`test-reviewer`、`review-verifier`、設計書の段階の 7 lane（観点ごとの確認の筋）、言語別 reviewer。

この記録は、公開した Artifact ページ（https://claude.ai/artifact/DKNZGnnFmF9u4mFwGi6MQm）の元になった調査記録が失われたため、そのページの内容から書き戻したもの。ページの元資料は `research-review-taxonomy.md`（調査日 2026-10-19）で、file:line の引用は約 110 件を開き直して確かめ、5 件を修正済みと記されている。

## 目的と件数

コードと設計のレビューで見るべき観点を 110 行に並べ、このハーネスの今の reviewer がそれぞれをどこまで受け持っているかを突き合わせた。

| 現状 | 行数 | 意味 |
|---|---|---|
| 済 | 42 | 観点が reviewer か skill に書かれ、reviewer に届く経路がある |
| 一部 | 49 | 一部の側面だけ、ある言語・ある場面だけ、または知識はあるが担当が無い |
| 無 | 19 | grep か全文読みで見つからなかった |

依頼で挙がった例（負荷分散の選択、DDD のトリレンマ、API のオブジェクト設計、バックログとの適合、ワークロード、コメントの水増し、デプロイの流れに合う PR 分割、ADR 準拠、アンチパターン、最新の言語機能、競合、フロントエンド、インフラ、クラウド、UI デザイナー、セキュリティ、テスト）は、ほぼ「済」か「一部」に入る。足りないのは例の外側で、薄い観点は 3 種類に偏る。

- **時間をまたぐ観点**。互換性と版管理（E3）、フィーチャーフラグの寿命（E5）、PR をデプロイ順に分ける（I8）、データの保持と消去（C8）は、すべて「一部」止まり。
- **文書と差分を突き合わせる観点**。プロダクト適合（A6）とドキュメント更新（I3）が「無」、仕様適合（A5）、PR の説明（I7）、PR の分割（I6）が「一部」。
- **「無」の中心**。数値・文字・環境の基礎（Unicode B9、持続可能性 D9、ライセンス F12、Dockerfile F6、ネットワーク F9、大きなファイル F14）と、API 設計 A4、red flag（Ousterhout が挙げた設計の危険信号）A9、コードの臭い A10、ML パイプライン E7、AI 機能の品質運用 L1。

> [!note]
> この表は地図で、観点の数だけ reviewer や skill を作るためのものではない。長い単一チェックリストが良いという測定は無く、チェックリストとアドホックの比較は結論が割れ、観点ごとに担当を分ける読み方のほうが良い結果だった。差分での起点（その観点を呼び出す差分の兆候）が付いた行だけを、該当する reviewer に渡す。また「現状」は観点が「書かれているか」の判定で、「効いているか」ではない。

### 群ごとの被覆（行数）

| 群 | 行数 | 済 | 一部 | 無 |
|---|---|---|---|---|
| A 設計と構造 | 14 | 3 | 7 | 4 |
| B 正しさと言語の基礎 | 13 | 2 | 10 | 1 |
| C セキュリティ・プライバシー | 12 | 6 | 4 | 2 |
| D 性能・容量・費用 | 10 | 6 | 3 | 1 |
| E データ・互換性・展開 | 7 | 2 | 4 | 1 |
| F 運用・インフラ・依存 | 14 | 3 | 6 | 5 |
| G フロントエンド・UI・国際化 | 12 | 9 | 3 | 0 |
| H テスト | 8 | 6 | 2 | 0 |
| I 保守性・PR の衛生 | 12 | 4 | 6 | 2 |
| X 手順の観点と周辺 | 7 | 1 | 4 | 2 |
| L AI 機能の品質運用 | 1 | 0 | 0 | 1 |

G（UI）と H（テスト）が厚く、A（設計）、B（基礎）、F（運用）、I（PR の衛生）が薄い。直近の再設計で UI、テスト、セキュリティ、負荷に reviewer を足した結果と一致する。

「一部」49 行は 4 つの型に分かれる。知識は skill にあるが reviewer への経路が無いもの（G6、A2 の周辺）、一つの言語・領域にだけあるもの（B10、B11、B12、D10、G7、G10、I12）、担当する reviewer の考え方が無いもの（A5、I6 から I8、X1 から X3、X6）、設計書の段階にだけあるもの（A1、A8）。

## 骨格にした分類

観点の並びは、確立した分類を骨格にして作った。骨格の項目のほとんどが、表の少なくとも 1 行に対応する。

- **ISO/IEC 25010:2023**。ソフトウェア製品の品質モデルを定める国際規格。9 特性（Functional suitability、Performance efficiency、Compatibility、Interaction capability、Reliability、Security、Maintainability、Flexibility、Safety）に副特性が付く。規格は有償で、本文は取得できず、副特性は二次の要約から取った。
- **Google eng-practices**。Google が公開しているコードレビューの手引き。「What to look for in a code review」の 12 見出し（Design、Functionality、Complexity、Tests、Naming、Comments、Style、Consistency、Documentation、Every Line、Context、Good Things）。小さな CL（変更単位）と CL の説明の頁も使った。
- **AWS Well-Architected と Google Cloud Well-Architected Framework**。クラウド上の設計を見直すための枠組み。どちらも 6 本柱（operational excellence、security、reliability、performance、cost optimization、sustainability。Google Cloud は security に privacy と compliance を含める）。AWS は業種・用途ごとの追加の観点集（lens）を 16 持つ。
- **OWASP ASVS 5.0**。Web アプリケーションのセキュリティ検証要件の標準。V1 Encoding and Sanitization から V17 WebRTC までの 17 章。
- **Google SRE ローンチチェックリスト**。新しいサービスを出す前の確認項目。Architecture から Schedule and rollout planning までの 10 見出し。プライバシーと保持の個別項目は無い。
- **compound-engineering の persona**。EveryInc の Claude Code プラグイン。観点ごとのレビュー役（persona）を 16 持ち、差分に応じて呼ぶ（選択規則は「Absence means skip, not "run just in case."」）。設計メモには、同じ規則が 3 つの persona に重複したという負の記録と、6 への統合案（draft）がある。
- **ClickHouse の review skill**。266 行の skill 1 本。必須の 5 ゲート（Contract、Impacted surface、Failure and divergence、Evidence、Lower-priority quality）と、条件で足す確認（TRIGGERED EXPANSIONS）を持つ。観点を並べず不変条件で書き、「Do not frame findings as checklist matches」と明記する。

対応する行が無い骨格の項目は 3 つ。Style は静的ツールの担当、ASVS V17 WebRTC は個別の行を作らず ASVS を直接参照、ISO の quality-in-use は本文を取得できなかった。

骨格にも既存調査にも無く、この調査で足した観点もある。プライバシーとデータのライフサイクル（C7、C8）、倫理・誤用（C12）、時刻・お金・Unicode の基礎（B7 から B9）、トランザクションの分離水準（B13）、sentinel 値（特別な意味を持たせた値）の意味変更（B4）、i18n と l10n（G7）、モバイル固有（G10）、ML パイプライン（E7）、AI 機能の品質運用（L1）、ライセンス（F12）、ビルド再現性（F10）、大きなファイルとバイナリ（F14）、移植性（F13）、持続可能性（D9）、フィーチャーフラグの寿命と設定（E5、E6）、互換性と版管理（E3）、仕様・プロダクト適合（A5、A6）、PR の説明・分割・デプロイ順（I6 から I8）、ドキュメント更新（I3）、利用者向け文字列（I11）、ビルド時間（I12）、再レビューと学習の照合（X6）、エージェント向け表面（X7）、AI 生成コードの兆候（I9）。

## 110 行の表

各行は、観点（一行の定義）、差分での起点、確認すること、担当（考え方の型）、置き場（知識をどこに置くか）、出典、現状と根拠の順。根拠の `cr:33` のような表記は「略号のファイルの 33 行目」（HEAD `36e1922f` 時点）を指す。

### 略号

担当の略号は次のとおり。

| 略号 | 意味 |
|---|---|
| code | `code-reviewer` |
| sec | `security-reviewer` |
| load | `workload-reviewer` |
| ui | `ui-reviewer` |
| test | `test-reviewer` |
| design | 設計書の段階（DR の lane） |
| lang | 言語別 reviewer（暫定） |
| lead | `change-review` を回す本体（分類、文脈集め、報告） |
| tool | 静的ツール |

置き場の略号は次のとおり。

| 略号 | 意味 |
|---|---|
| LS | 言語 skill の `references/review-standard.md`（未作成、CS:37） |
| DC(名) | 領域 skill の `references/review-checklist.md`（既存のもの、または新規の名前） |
| AR | reviewer の本文に常時置く |
| RS | `change-review` の手順と参照 |
| PJ | プロジェクト側（AGENTS.md、ADR、ワークロード記述） |
| ST | 静的ツール |

根拠の略号は `harness/` からの相対パス。

| 略号 | パス |
|---|---|
| cr | agents/code-reviewer.md |
| sr | agents/security-reviewer.md |
| wl | agents/workload-reviewer.md |
| tr | agents/test-reviewer.md |
| ur | agents/ui-reviewer.md |
| rv | agents/review-verifier.md |
| wp | agents/web-platform-reviewer.md |
| rr | agents/react-reviewer.md |
| gr | agents/go-reviewer.md |
| dbr | agents/database-reviewer.md |
| fr | agents/flutter-reviewer.md |
| CS | skills/change-review/SKILL.md |
| DR | skills/change-review/references/design-review.md |
| LM | skills/change-review/references/language-map.md |
| OF | skills/change-review/references/output-format.md |
| CRD | skills/code-review-discipline/SKILL.md |
| DDD | skills/ddd-modeling-review/SKILL.md |
| SQL | skills/sql-tuning/SKILL.md |
| OBS | skills/observability-patterns/SKILL.md |
| RES | skills/resilience-patterns/SKILL.md |
| EVT | skills/event-driven-patterns/SKILL.md |
| CLA | skills/clean-architecture/SKILL.md |
| K8S | skills/k8s-patterns/SKILL.md |
| GCP | skills/gcp-patterns/SKILL.md |
| CF | skills/cloudflare-patterns/SKILL.md |
| HIG | skills/human-interface-guidelines/SKILL.md |
| OBSck など | OBS、RES、EVT それぞれの `references/review-checklist.md` |

出典欄の印は取得の種別を表す。[gh] は `gh api` で原文を直接取得。[直] は curl で到達（HTTP 200）を確かめ、本文は WebFetch の要約で読んだもの。[要約] は WebFetch が小型モデルで要約して返したもので、原文との一致は未照合。[検索] は WebSearch の要約のみ。[既存] は同じ作業の既存調査から引いたもの。[推論] は根拠 URL の無い推測。

既存調査の略号（いずれも同じ作業の scratchpad にあった `research-*.md`）は、R-BE = domain-backend-cs-perf、R-INF = domain-infra-cloud、R-SEC = domain-security、R-FE = domain-frontend-design、R-UI = ui-designer-review、R-WL = workload-review、R-LANG = language-review-sources、R-REV = review、R-PAT = pattern-catalog-review、R-OR = oreilly-mcp。書籍は書名だけを挙げている。licence は出典ごとに行内に書いている。

### A 設計と構造（コードの前後どちらでも）

14 行: 済 3 / 一部 7 / 無 4

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| A1 | 全体設計と置き場の適否: この変更がこのコードベース・このライブラリ・この時機に属するか | 新モジュール、新しい層、新依存、大きな新機能 | 周囲との噛み合い、ライブラリに出すべきか、今入れる時機か | design、code | RS（DR の architecture lane）、AR | Google eng-practices「Design」（CC BY 3.0）、Microsoft playbook「First Design Pass」（CC-BY-4.0） | 一部。設計書の段階だけ DR:16。code-reviewer に設計の項は無く「Structure」だけ cr:41 |
| A2 | 層境界と依存方向: 内側が外側を知らない | import の向き、controller 内の業務分岐、use case が transport 型を受ける | 依存が内向きか、規則の置き場 | code | DC(clean-architecture) | Martin『Clean Architecture』（書名のみ）、ISO Maintainability: Modularity | 済。CLA:19,128、LM:31 が「layer boundaries」を経路づけ、gr:141-152 と rr:192 に言語側の節 |
| A3 | ドメインモデル: 集約境界、不変条件、純粋性・完全性・性能のトリレンマ | リポジトリ注入、ドメイン層の外部呼び出し、集約をまたぐ参照 | 捨てた一角が明示されているか | code、design | DC(ddd-modeling-review) | Khorikov https://enterprisecraftsmanship.com/posts/domain-model-purity-completeness/ （© リンクのみ、一人の立場）[R-BE B6]、Evans『Domain-Driven Design』（書名） | 済。DDD:61,179,295,488、CRD:74-88（トリレンマの例は CRD:80） |
| A4 | API のリソース・オブジェクト設計とページング契約 | route、message、serializer の追加 | 資源名、標準メソッドで足りるか、DB の写しでないか、ページングは初回から、不透明トークン | code、design | DC(新 api-design-review) | Google AIP-121、AIP-158（CC BY 4.0）https://google.aip.dev/121 [R-BE] | 無。api を扱う skill が無い（skills 一覧を確認）。DR:19 の release lane は互換性だけ |
| A5 | 要求・仕様・バックログとの適合: 意図どおりか、足りない・余計な実装が無いか | PR 説明、チケット、受け入れ条件のある変更 | diff が意図と合う、受け入れ条件に対応、意図に無い公開面を足していない | design、code、test | RS（意図の収集）、PJ | Google「Functionality」、ClickHouse「Contract」ゲート（Apache-2.0）、CE の project-standards と intent-and-plan（MIT）[R-WL §4.1] | 一部。意図を一段落にする CS:34、受け入れ基準の欠落を問う tr:62・wl:25。diff と受け入れ条件を突き合わせる担当は無い |
| A6 | プロダクト・UX 適合: そもそも入れるべきか、既存と重複しないか、設定の増殖 | 新機能、新画面、新設定、新フラグ | ユーザー価値、重複、後で外せるか | design、owner への問い | PJ、RS | Majors「Do we want this in our product」（二次要約）[R-PAT §2]、Google「Is now a good time」 | 無。DR:13-21 の 7 lane に product 軸が無い。reviewer にも無い |
| A7 | 決定記録（ADR）への適合と更新 | ADR や決定メモのあるパスの変更、新しい設計判断 | 決定に従うか、逸脱に理由、新判断は拒否案つきで記録、置換は superseded | design、code | RS、PJ | Nygard「Documenting Architecture Decisions」https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions 、https://adr.github.io/ | 済。CS:35、cr:50、gr:153、CRD:161-173、DR:15 |
| A8 | 過剰設計・YAGNI・不要な公開面 | 実装が 1 つの interface、使われない拡張点、新しい設定や export | 今必要な問題だけを解いているか | code | AR（名前＋検出条件） | Google「Complexity」、CE maintainability の Speculative Generality と Unrequested surface（MIT） | 一部。DR:16 は設計段階だけ、gr:92 は Go の interface 汚染だけ。cr に項目無し |
| A9 | 複雑さとモジュールの深さ（Ousterhout の red flag 14） | 薄いラッパー、多段委譲、情報の漏れ、時系列での分割、曖昧な名前 | 名前＋検出条件で（例: 呼び出しを 1 つ転送するだけの method） | code | AR（CE 型） | Ousterhout『A Philosophy of Software Design』（書名）、名前一覧 https://dev.to/sportebois/software-design-red-flags-wisdom-nuggets-from-john-ousterhout-43i2 [要約]、CE maintainability（MIT） | 無。cr、CS、CRD、gr、typescript/python/java/rust-reviewer を grep（shallow module、pass-through、information leakage）0 件 |
| A10 | コードの臭い（Fowler） | Large Class、Long Method、Data Clumps、Feature Envy など | 指標型の臭いは検出しやすく、複数ファイルにまたがる意味的な臭いは苦手 [R-LANG §5.3 の孫引き] | code | AR | Fowler『Refactoring』第 2 版（書名）、名前 23 は第 2.2 節 | 無。grep（feature envy、primitive obsession、shotgun、divergent change）0 件 |
| A11 | 領域別のパターンとアンチパターン目録 | 領域（イベント、回復力、観測性、k8s、GCP、Cloudflare、SQL、DDD）に触れる | トリガー付きの小さな規則（defects、silences、trade-offs） | code、design | DC（各領域） | ClickHouse「TRIGGERED EXPANSIONS」、[R-PAT §6] | 一部。checklist 付きは events、resilience、observability の 3 つだけ（EVTck、RESck、OBSck）。k8s、gcp、cf、sql、ddd は SKILL 本文だけ。api、terraform、aws、gha、docker、nix、分散の正しさ、計算量は skill 自体が無い [R-BE §6、R-INF §8.1] |
| A12 | アルゴリズム・計算量・データ構造の選択 | ネストループ、ループ内の線形探索・文字列連結・ソート | N の現実の上限と式、支配的な操作と構造の対応 | code | DC(新 algorithmic-complexity-review) | cp-algorithms（CC BY-SA 4.0）[R-BE C1 C2]。Google eng-practices に性能の項は無い | 一部。cr:46「a quadratic algorithm on an input whose expected size you can state」と言語別 perf reviewer。言語横断の skill は無い |
| A13 | 負荷分散・シャーディング・パーティション鍵の選択 | LB の設定、サーバー選択、キーが定数・国・状態 | 状態の有無、均質性、ホットキー、再配置の量 | code、design | DC(新 distributed-correctness) | Envoy docs、Google Research の bounded loads、DynamoDB docs [R-BE P7 P8] | 一部。wl:32「hot keys」、EVTck:38 skewed-partition-key。アルゴリズム選択の観点は無い |
| A14 | 依存を足す是非: 数行のために依存を足していないか | manifest の diff | 標準ライブラリや既存の helper で足りるか | code、sec | AR | CE maintainability「Dependency for a few lines」（MIT） | 一部。sr:39 は実在と保守だけ。「要るか」は無い |

### B 正しさと言語の基礎

13 行: 済 2 / 一部 10 / 無 1

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| B1 | 機能の正しさと境界値 | 新しい分岐、ループ境界 | 両経路、境界値、空と nil、off-by-one | code | LS、AR | Google「Functionality」、ISO Functional suitability の correctness | 済。cr:33 |
| B2 | 不変条件と状態遷移 | 状態機械、フラグ、新しい制約 | 不変条件を実装と独立に述べ、生成・複製・保存・公開の全経路で守られるか | code | AR | ClickHouse「New or clarified invariant」、CE correctness の Incorrect state transitions | 一部。cr:35（共有状態）、DDD:295（DDD 採用時の entity の不変条件）。全経路を追う指示は無い |
| B3 | エラー処理と失敗の意味（握りつぶし、fail-open か fail-closed） | catch、エラー戻り、検査の失敗経路 | 文脈つきで伝播、失敗時に閉じる、検査が例外で飛ばない | code、sec | LS、AR | pr-review-toolkit の silent-failure-hunter、OWASP Top 10:2025 A10 [R-SEC] | 済。cr:34、sr:45、DDD:548、RES:208 |
| B4 | 型の穴、null、sentinel 値の意味の流用 | any、cast、強制 unwrap、null や空配列を新しい状態に流用 | モデリングの誤りを隠していないか、消費側が区別できるか | code | LS | pr-review-toolkit の type-design-analyzer、CE api-contract の Sentinel contract overloads | 一部。cr:36、DDD:410（nullable より sum type）。sentinel の流用は確認項目に無い |
| B5 | 並行性（競合、デッドロック、可視性） | 共有可変状態、ロック、async の順序依存 | ロック順序、TOCTOU、メモリモデル、キャンセル | code | LS（go-concurrency など）、DC | Google「Functionality」（「very hard to detect by just running the code」）、Go Memory Model、JLS 17 [R-LANG §4.2] | 一部。cr:35、gr:75、go-concurrency skill、DDD:488。言語横断の理論の置き場は無い |
| B6 | 分散の正しさ（配送意味論、順序、冪等、フェンシング、リース） | at-least-once の消費、分散ロック、複数ストアへの書き込み | 仮定する一貫性、dedup、フェンシングトークン | code | DC(event-driven-patterns と新 distributed-correctness) | Kleppmann https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html （CC BY 3.0）、AWS Builders' Library の冪等 API [R-BE] | 一部。EVT:13,55 が配送と冪等。フェンシング、リース、時計は無し（grep fencing 0 件 [R-BE §6]） |
| B7 | 時刻・タイムゾーン・期間・時計 | 壁時計での比較と期限、TTL、`timestamp` 列、日付演算 | 単調時計、DST、うるう秒、タイムゾーン付きの型 | code | DC(新 data-primitives) | 「Falsehoods programmers believe about time」https://gist.github.com/timvisee/fcda9bbdff88d45cc9061606b4b923ca （12 項目を確認）、Kleppmann | 一部。DDD:579（半開区間）、dbr:73（timestamptz）。単調時計、DST、時計のずれは無し |
| B8 | 数値の精度・お金・単位・オーバーフロー | 金額と単価、浮動小数の等値、整数の幅、単位の混在 | 最小通貨単位の整数か decimal、通貨ごとの小数桁、丸めの方針、桁あふれ | code | DC(新 data-primitives) | Stripe「amount は最小通貨単位。1099 で 10.99 USD、JPY は 10 で 10 JPY」https://docs.stripe.com/currencies [要約]、Fowler『PoEAA』Money（書名） | 一部。DDD:260-284 が DDD 採用時の Money 値オブジェクトを例示。一般の浮動小数、丸め、桁あふれの確認は無し（grep で金額と float の組み合わせ 0 件） |
| B9 | 文字列・Unicode・エンコーディング・正規化 | 文字数とバイト数、比較とソート、文字コード | code point と grapheme、正規化、照合順序 | code | LS、DC(i18n) | W3C i18n quick tips 9 項目（Encoding、Escapes、Language ほか）https://www.w3.org/International/quicktips/ [要約] | 無。grep（unicode、utf-8、normaliz）で該当なし |
| B10 | 資源の寿命（リーク、後始末、キャンセル） | open と connect、goroutine、タイマー、listener、effect | 全出口で解放、キャンセルの伝播 | code | LS | Go Code Review Comments の goroutine lifetimes、react.dev の Effect の cleanup [R-LANG] | 一部。rr:83-90、fr:152。cr に一般項は無し |
| B11 | 言語のイディオム・新機能・非推奨 | 古い書き方（`v := v` など）、新しい標準 API で置き換えられる箇所 | 言語の公式「what's new」に照らす | lang | LS | 各言語の公式 [R-LANG §4.1] | 一部。go-modern、ts-modern、css-modern がある。他の言語は無し。LM:5-21 は review-standard.md 未作成のため interim（CS:37） |
| B12 | 他言語の癖を持ち込む失敗 | 言語に不慣れな書き方 | interface を生産側に置く、clone の乱用など | lang | LS | Thoughtworks 2023（Go）[R-LANG §3]。他の言語は資料不足 | 一部。gr:92（interface 汚染）だけ。「生産側か消費側か」の確認は無し |
| B13 | トランザクション境界・分離水準・check-then-act | BEGIN の区間、SELECT のあと UPDATE、外部呼び出しを含む区間 | 外部 I/O をトランザクション内に置かない、分離水準、直列化失敗の再試行 | code、load | DC(sql-tuning に節を足す) | PostgreSQL docs https://www.postgresql.org/docs/current/transaction-iso.html [R-BE B4] | 一部。DDD:488（TOCTOU と楽観ロック）、wl:31（トランザクション範囲）。分離水準は sql-tuning、ddd、database-reviewer を grep して 0 件 |

### C セキュリティ・プライバシー・コンプライアンス

12 行: 済 6 / 一部 4 / 無 2

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| C1 | 認証・認可・テナント分離 | 新 route、id を取るハンドラ、スコープ条件やキャッシュキーの変更 | サーバー側で対象ごとに判定、姉妹 route、tenant id が全経路に届く | sec | AR、DC | OWASP ASVS V6 から V10（CC BY-SA 4.0）、API Security Top 10 [R-SEC §8] | 済。sr:31-33 |
| C2 | 入力・インジェクション・SSRF・デシリアライズ・ファイル | 文字列で組むクエリ・コマンド・HTML・パス、サーバー側の HTTP クライアント、アップロード | 入力源から sink まで、許可リスト | sec | AR | ASVS V1、V2、V4、V5、CWE Top 25 | 済。sr:34,37,38,44 |
| C3 | 秘密と暗号 | キー様の文字列、.env、ハッシュ・暗号・乱数・TLS | ハードコード、弱い方式、証明書検証 | sec、tool(gitleaks) | AR、ST | ASVS V11、V12、V13 | 済。sr:35,36 |
| C4 | 供給網（依存、lockfile、Actions の固定） | 依存、lockfile、install script、`uses:` | lockfile の同時更新、実在、完全な SHA での固定 | sec、tool(osv-scanner、zizmor) | AR、ST | OWASP Top 10:2025 A03、SLSA [R-SEC §8] | 済。sr:39,58 |
| C5 | CI/CD ワークフローの攻撃面 | `.github/workflows/*` | `${{ }}` の注入、permissions、pull_request_target、AI の段への入力 | sec、tool(zizmor) | AR、ST | GitHub のセキュリティ強化文書、Trail of Bits agentic-actions-auditor（CC-BY-SA-4.0、リンクのみ）[R-INF §2.3] | 済。sr:40 |
| C6 | LLM・エージェント機能のセキュリティ | プロンプトへの外部入力の連結、ツールと書き込み権限の付与、出力を HTML・shell・SQL に使う | 私的データ・信頼できない内容・外部送信の三つ組、出力を信頼しない、最小権限 | sec | AR | OWASP Top 10 for LLM Applications 2025、Willison の lethal trifecta [R-SEC §3] | 済。sr:43 |
| C7 | プライバシー・個人データ・データ最小化 | 個人データを扱う新フィールド、ログ、第三者への送信、分析基盤 | 目的に必要な最小か、収集・処理の範囲・保管期間・アクセス範囲が既定で絞られているか、ログやテレメトリに生で出ないか | sec、design | DC(新 privacy-data-lifecycle) | GDPR 第 25 条（by design と by default。「storage period」を含む）https://gdpr-info.eu/art-25-gdpr/ [要約]、LINDDUN の 7 分類（Linking、Identifying、Non-repudiation、Detecting、Data Disclosure、Unawareness、Non-compliance）https://linddun.org/ [要約、© KU Leuven]、ASVS V14 | 一部。ログへの PII は sr:41、OBSck:48。最小化、目的、第三者送信、同意は無し |
| C8 | データのライフサイクル（保持、削除、消去、バックアップと復元） | 新しいストア、トピック、ログ sink、バックアップ、TTL | 保持期間の宣言、消去の手段、復元の確認 | design、sec | DC(新 privacy-data-lifecycle) | GDPR 第 25 条 2 項、SRE ローンチ「Data backup/restore, disaster recovery」、ISO Reliability: Recoverability | 一部。EVTck:101（イベント内の PII の消去計画）、OBSck:49（保持の宣言）。ストア一般は無し |
| C9 | コンプライアンス・データ所在地・監査ログ | リージョンやロケーションの設定、監査対象の操作 | 所在地が新規作成だけでなくバックアップとログまで届くか、監査ログの欠落 | design、sec | DC(gcp、aws)、PJ | GCP の resourceLocations は「aren't data storage commitments」[R-INF §2.1]、ASVS V16、ISO Security: Accountability と Non-repudiation | 一部。sr:46 は監査ログの削除だけ。所在地の観点は skills に無い（grep residency、data locality で関連なし） |
| C10 | 悪用・DoS・資源枯渇・レート制限 | 認証前の入口、無制限の入力、ループや再帰 | 認証前かつ増幅があるか、上限 | sec、load | AR | OWASP API4 [R-SEC §8] | 一部。sr:55（原則除外、認証前かつ増幅のときだけ報告）、RES:176、wl:31 の unbounded fetch |
| C11 | 安全重要システム（フェイルセーフ、ハザード警告、運用制約） | 物理世界への作用、医療・車載・産業 | 運用制約、危険の識別、フェイルセーフ | design | PJ | ISO 25010:2023 Safety の 5 副特性 | 無。該当ドメインの記述が reviewer と skill に無い（参考） |
| C12 | 倫理・誤用・不適切な利用 | 推薦、自動判定、コンテンツ生成、監視 | 悪用経路、利用者への害 | design | PJ | Atlassian「Security issues and ethics」（ベンダー二次）、NIST AI RMF | 無。reviewer と skill に項目無し |

### D 性能・容量・費用・持続可能性

10 行: 済 6 / 一部 3 / 無 1

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| D1 | ホットパスのコスト（N+1、割り当て、ブロッキング I/O、バッチ） | ループ内のクエリ・確保・呼び出し | 回数×規模、無制限の取得、ページング | code、load、lang(perf) | AR、各言語 perf | CE performance（MIT）、Azure Busy Database（CC-BY-4.0）[R-BE] | 済。cr:46、wl:31、各 `*-perf-reviewer` |
| D2 | 性能の主張に測定を求め、騒音を抑える | 「高速化」の PR、キャッシュ提案 | 前後の測定、コールドパスと MVP は指摘しない | code | AR | ClickHouse「Evidence」ゲート、CE performance の閾値 | 済。cr:46（`[needs-measurement]`）、reviewer-requirements.md §4 |
| D3 | キャッシュ（無効化、cold、stampede、背圧） | 新しいキャッシュ、TTL、メモ化 | 無効化の方針、空のときの挙動、同時数の制限 | code、load | DC(新 distributed-correctness) | Brooker「Caches, Modes, and Unstable Systems」（© リンクのみ）[R-BE P5] | 一部。CF:45（Cloudflare の cache judgment）だけ。cr と wl に項目無し |
| D4 | 容量・飽和・クォータ・上限 | 並列数、台数、購読数、CPU 時間の増加 | 上限との距離、先に詰まる資源 | load、design | AR、DC(cloud) | SRE ローンチ「Volume estimates, capacity, and performance」、AWS Performance efficiency の柱、Gregg の USE [R-WL] | 済。wl:35（数値は workload 記述があるときだけ）、GCP:78 |
| D5 | 再試行・タイムアウト・背圧・過負荷 | 外部呼び出し、再試行、キュー | 層の乗算、予算、jitter | load | DC(resilience-patterns) | AWS Builders' Library（5 層×3 で 243 倍）、Google SRE の連鎖障害、OSDI '22（持続効果の 50% 超が再試行）[R-WL] | 済。wl:34、RESck の timeout-missing ほか |
| D6 | DB のクエリ・索引・ロックの費用 | クエリ、索引、EXPLAIN | sargable、複合索引の順、ロックの保持 | code、lang | DC(sql-tuning) | PostgreSQL docs [R-BE P6] | 済。SQL:18,55,100,117、dbr:41、sql-perf-reviewer |
| D7 | フロントエンドの性能（CWV、bundle、waterfall、再描画） | 画像の寸法、静的 import、直列 await、memo | LCP 2.5 秒、INP 200 ms、CLS 0.1、測定の有無 | code、load | LS、DC | web.dev vitals（CC BY 4.0）、Vercel react-best-practices（MIT）[R-FE §1] | 済。wl:41-44（INP は field data でのみ確認できると明記 wl:44）、react-performance、react-perf-reviewer、css-perf-reviewer |
| D8 | コスト・FinOps | インスタンス型、台数、NAT、ログ保管、リージョン、有料 API 呼び出し | 増分を金額で出す、請求に出る前に | load、design | DC(各 cloud と terraform) | FinOps の原則（CC BY 4.0）、Infracost [R-INF] | 一部。wl:36（有料呼び出し）、GCP:93、CF:85。IaC の金額差は無し |
| D9 | エネルギー・持続可能性 | 常時稼働、大量計算、保管量の増加 | SCI = (O + M) per R などの測り方、リージョンの炭素強度 | design | DC（cost-finops に同居） | Software Carbon Intensity v1.1.0（© Green Software Foundation）https://sci.greensoftware.foundation/ [要約]、AWS と Google Cloud の Sustainability の柱 | 無。grep（carbon、sustainab）は HIG の別文脈だけ |
| D10 | モバイルの電池・起動・メモリ・ANR | バックグラウンド処理、起動時処理 | Android core quality の Performance and stability | lang(perf) | LS | Android core app quality https://developer.android.com/docs/quality-guidelines/core-app-quality [要約] | 一部。flutter-perf-reviewer、kotlin-perf-reviewer だけ。Swift は無し |

### E データ・スキーマ・互換性・移行・展開

7 行: 済 2 / 一部 4 / 無 1

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| E1 | データモデルとスキーマ設計 | テーブル、列、キー、制約の追加 | アクセスパターン、キー選択（単調キーの hotspot）、型 | code、lang | DC(sql-tuning) | PostgreSQL wiki「Don't Do This」、Spanner schema design [R-LANG §2.12] | 済。dbr:47,104、cr:39、SQL:55 |
| E2 | スキーマ移行の安全（expand と contract、backfill、ロック） | migration、backfill、DDL | 追加→移行→削除の順、ロック時間、元に戻せるか | code、design | DC(sql-tuning) | Fowler ParallelChange https://martinfowler.com/bliki/ParallelChange.html 、Stripe「Online migrations」https://stripe.com/blog/online-migrations | 済。SQL:182-191、DR:19、EVTck:48 |
| E3 | API・イベント・永続フォーマットの互換性と版管理 | 公開型、スキーマ、ワイヤ形式の変更、意味の変更 | 加算的か、名前変更は remove と add、版と非推奨期間、Hyrum の法則 | code、design | DC(新 api-design-review と compatibility-rollout) | Google AIP-180 https://google.aip.dev/180 （CC BY 4.0）、SemVer 2.0 https://semver.org/ （CC BY 3.0）、CE api-contract（MIT）、ClickHouse「Serialization versioning」 | 一部。cr:38-39、DR:19、EVTck:48-53。公開 API の互換性判定は無し（grep breaking change は event-driven だけ [R-BE §6]） |
| E4 | データ移行と backfill の検証と巻き戻し | 本番データを書き換えるスクリプト | 検証クエリ、ロールバック、孤児参照 | code | DC(sql-tuning) | CE data-migration と deployment-verification-agent（MIT） | 一部。SQL:186（bounded batch の backfill）。Go/No-Go の検証クエリと巻き戻し計画の確認は無し |
| E5 | ロールアウト・ロールバック・フィーチャーフラグ | フラグ、段階展開、一括変更、戻せない変更 | 「壊れたとどう知るか」、フラグの寿命、全部オンのテスト | load、design | DC(新 compatibility-rollout) | martinfowler.com の feature toggles（carrying cost）、Google SRE canarying（CC BY-NC-ND）、ClickHouse「Safe rollout」「Experimental gate」 | 一部。wl:37、DR:19、K8S:64。フラグの棚卸しと削除期限は無し |
| E6 | 設定・既定値・環境差 | 新設定、既定値の変更、環境変数 | 環境ごとに独立、マジック定数は設定へ、互換設定 | code | DC(compatibility-rollout) | 12-factor「Config」https://www.12factor.net/config （「independently managed for each deploy」）、ClickHouse「No magic constants」 | 一部。typescript-reviewer.md:103（magic numbers）、sr:42（安全面だけ） |
| E7 | ML・データパイプライン（学習と提供のずれ、データ品質、リネージ） | 特徴量、学習と推論のパイプライン、データ結合 | training-serving skew、silent failure、特徴量の所有者と文書 | code、design | DC(新 ml-pipeline-review) | Google「Rules of Machine Learning」（Rule #29、#31、#10、#11）https://developers.google.com/machine-learning/guides/rules-of-ml [要約]、「The ML Test Score」（28 の test）、Sculley ほか NeurIPS 2015 | 無。`agents/*reviewer*.md` に ML の観点無し |

### F 運用・インフラ・ビルド・依存

14 行: 済 3 / 一部 6 / 無 5

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| F1 | 観測性（ログ、メトリクス、トレース、アラート、SLO） | 新しいログ、メトリクス、アラート、サービス | four golden signals、カーディナリティ、症状で alert | code、design | DC(observability-patterns) | SRE「Monitoring Distributed Systems」（latency、traffic、errors、saturation）https://sre.google/sre-book/monitoring-distributed-systems/ [要約] | 済。OBS 全節、OBSck の 20 項目、LM:29 |
| F2 | 回復力・ヘルスチェック・グレースフルシャットダウン | liveness と readiness、SIGTERM、バルクヘッド | 依存の障害で全 Pod の再起動連鎖にならないか | code | DC(resilience-patterns) | Google SRE の連鎖障害 [R-WL] | 済。RES:232、RESck の liveness-checks-dependency |
| F3 | 運用性: 壊れたと知る手段・ランブック・オンコールの負荷 | 新しい失敗モード、アラートだけで手順が無い | 行動できるアラート、ランブックの所在、巻き戻しの手順 | load、design | AR、PJ | SRE PRR「Emergency response」、Grafana の PRR 記録 [R-WL] | 一部。wl:37 だけ。ランブックとオンコールの項目は無し |
| F4 | IaC: Terraform、OpenTofu、Pulumi | plan の `-/+`、state と backend、ignore_changes、共有モジュール | destroy と replace の爆発半径、state の置き場、ドリフト | code、tool(Checkov、TFLint) | DC(新 terraform-patterns) | HashiCorp lifecycle docs（BUSL-1.1、リンクのみ）、Microsoft playbook の Terraform recipe（CC-BY-4.0）[R-INF §2.1] | 一部。GCP:117 の短い節だけ |
| F5 | Kubernetes と Helm | manifest、values、RBAC、probe、PDB | PSS 違反、requests と limits、rollout、レンダリング差分 | code、tool(kube-linter) | DC(k8s-patterns) | Kubernetes の Pod Security Standards（CC-BY-4.0）[R-INF] | 済。K8S:42,64,77（checklist ファイルは無い） |
| F6 | コンテナ（Dockerfile） | FROM、USER、ARG と ENV の秘密、層 | digest 固定、非 root、BuildKit の secret | code、tool(hadolint) | DC(新 docker-patterns、小) | Docker best practices [R-INF] | 無。docker を扱う skill が無い（skills 一覧を確認） |
| F7 | CI/CD の信頼性（非セキュリティ）: キャッシュ、flaky、リリース経路、concurrency | workflow の job、cache、release | 承認、巻き戻しの手段、concurrency | code | DC(新 github-actions-patterns) | zizmor の concurrency-limits [R-INF §6.1] | 無。セキュリティ面（C5）だけ |
| F8 | クラウドの IAM・リージョン・マネージドサービスの上限 | IAM の binding、location と zone、Cloud Run や Lambda の設定 | 最小権限、信頼ポリシーの範囲、上限との距離 | code、design | DC(gcp、aws、cloudflare) | AWS IAM best practices、GCP using-iam-securely [R-INF §2.1] | 一部。GCP:13,78、CF:13。AWS の skill は無し |
| F9 | ネットワーク（CIDR、egress の費用、DNS と TLS） | VPC、ピアリング、NAT、証明書 | CIDR の重複、NAT の課金、TTL | design | DC(各 cloud) | Corey Quinn の NAT 課金の言及（検索経由）[R-INF §3] | 無。reviewer と skill に項目無し |
| F10 | ビルドの再現性とツールチェーンの固定（Nix、lockfile） | flake.lock、`fakeHash`、`--impure`、toolchain の版 | 同じ入力から同じ成果物、ハッシュの出所 | code | DC(新 nix-patterns、小)、ST | reproducible-builds.org の定義（CC BY-SA 4.0）https://www.reproducible-builds.org/docs/definition/ [要約]、nix.dev best practices | 一部。sr:39（manifest と lockfile の同時更新）だけ |
| F11 | 依存の衛生: 保守状態・放棄・更新運用 | 依存の追加と更新 | archived や放棄、公開者の集中、更新ツール | sec、tool(scorecard) | AR、ST | OpenSSF Scorecard の 19 check（Maintained、Dependency-Update-Tool、Pinned-Dependencies ほか、Apache-2.0）[gh] | 一部。sr:39、sr:58 |
| F12 | ライセンス適合 | 依存の追加、コードや資産のコピー | 許容ライセンス、帰属表示、SBOM | design、tool | PJ、ST | SPDX https://spdx.dev/ 、OpenSSF Scorecard の License check | 無。grep license（cr、sr、CS、CRD）0 件 |
| F13 | 移植性・環境差（OS、アーキテクチャ、パス、シェル） | OS 固有の API、パス区切り、シェルの癖 | 対象環境の列挙、条件分岐の網羅 | lang | LS | ISO 25010:2023 Flexibility（installability、replaceability、adaptability）、Microsoft playbook の bash recipe | 一部。LM:21 で `.sh` は skill も agent も無し |
| F14 | 大きなファイル・バイナリ・生成物のコミット | バイナリ、データセット、生成物の混入 | git に入れてよいか、生成元が真実か | code | AR | ClickHouse「No large / binary files in git」（blocker） | 無。grep で reviewer と skill に項目無し |

### G フロントエンド・UI・UX・アクセシビリティ・国際化・モバイル

12 行: 済 9 / 一部 3 / 無 0

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| G1 | コンポーネントと状態の設計 | props の肥大、effect での派生状態、取得方式 | レンダー中に計算できないか、責務の混在 | code、lang | LS、DC | react.dev「You Might Not Need an Effect」（CC-BY-4.0）[R-FE] | 済。rr:83-116,192-198、react-patterns |
| G2 | セマンティック HTML とアクセシビリティ | `onClick` の div、label と alt の欠落、ARIA、focus | WCAG 2.2、APG。自動検出は 40 から 57% までで残りは人 | code、ui | LS(新 semantic-html) | WCAG 2.2（W3C Document License、リンクのみ）、WebAIM Million 2026、GDS と Deque [R-FE §3.1] | 済。wp:72、rr:98、ur:44,46、HIG:180。skill は無く知識は agent 本文に集中 [R-FE §6.1] |
| G3 | CSS: cascade、モダン CSS、defensive、単位 | `!important`、旧イディオム、固定幅、px | Baseline、詳細度、min-width の扱い | code、lang | LS（css-*） | web-features（Apache-2.0）、MDN [R-FE §1.3] | 済。wp:83,107、css-cascade、css-flow、css-modern、css-units、defensive-css |
| G4 | 視覚デザイン（近接、余白の持ち主、階層、視線、揃え、タイポ、色） | スタイルの値やレイアウトの変更と前後のスクリーンショット | 実測とコードで断定、好みは問いにする | ui | AR | SmartHR DS、デジタル庁 DADS、NN/g [R-UI] | 済。ur:35-47 |
| G5 | 状態の網羅（loading、empty、error、長い文字列）とフィードバック | 非同期 UI、リスト、フォーム | 各状態が書かれているか、高さが跳ねないか | ui、load | AR | Vercel web-interface-guidelines（MIT）、Nielsen の heuristic #1 | 済。ur:46、wl:42 |
| G6 | UX・情報設計・ヒューリスティクス・マイクロコピー・誤り防止 | 新しい画面フロー、文言、確認ダイアログ | Nielsen の 10 heuristics、誤り防止、学習容易性 | design、ui | DC（HIG を reviewer から参照） | NN/g の 10 heuristics（名称のみ）、ISO Interaction capability: user error protection、learnability、self-descriptiveness | 一部。HIG が SHIG 17 区分を持つが reviewer へ届く経路が無い（LM に HIG 無し、ur:31 は NN/g を出典に挙げるだけ） |
| G7 | i18n と l10n（文言の外出し、複数形、日付・数値・通貨の書式、RTL、長さの膨張） | 文字列の直書き、日付や数値の整形、固定幅のレイアウト | locale 対応の formatter、テキストの拡張、RTL | code、ui | LS、DC(新 i18n) | W3C i18n quick tips（Presentation vs. content、Forms、Right-to-left text ほか 9 項目）[要約]、Google「Every Line」（internationalization は有資格のレビュアーを付ける） | 一部。HIG:186（設計原則）、fr:198-202（Flutter だけ） |
| G8 | レスポンシブ・ブラウザ対応・Baseline | breakpoint、新しい CSS 機能 | browserslist と Baseline | ui、code | LS | web.dev Baseline [R-FE §1.3] | 済。wp:102、ur:47 |
| G9 | デザインシステムとトークンの一貫性 | 既存に似た新実装、トークン外の値 | 既存を使う、トークン | ui | PJ | SmartHR、Figma の AI design QA [R-UI §3.2] | 済。ur:45（プロジェクト固有の規則は PJ） |
| G10 | モバイル固有（ライフサイクル、権限、オフライン、ストア規約、端末内の保管） | AndroidManifest と Info.plist、権限、バックグラウンド処理 | Android core quality の 5 群、OWASP MASVS の 8 群 | lang | LS(新 mobile、薄い) | Android core app quality、OWASP MASVS（STORAGE、CRYPTO、AUTH、NETWORK、PLATFORM、CODE、RESILIENCE、PRIVACY）https://mas.owasp.org/MASVS/ [要約]、Apple App Store Review Guidelines（到達だけ確認） | 一部。fr:152,190、kotlin-reviewer.md:124。Swift の reviewer は無し（LM:16） |
| G11 | クライアント状態とサーバーの整合・競合・楽観更新 | 楽観更新、二重送信、複数タブ | rollback と refetch の順 | load | AR | TanStack Query の docs [R-WL §3]、CE julik-frontend-races | 済。wl:42-43 |
| G12 | UI の実挙動の確認（前後のキャプチャ） | UI の変更 | 状態・viewport・テーマごとの前後比較 | lead、ui | RS | Google「Functionality」（UI の変更は実際に確かめる） | 済。CS:76-84（手順 7） |

### H テスト

8 行: 済 6 / 一部 2 / 無 0

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| H1 | テストの有効性（壊れたら落ちるか） | テストの追加や変更 | 最小の破壊（反転、欠落、off-by-one）を想像して assert が捕まえるか | test | AR | Beck の Behavioral と Predictive、Google「Tests」 | 済。tr:9,28-29 |
| H2 | 新しい振る舞いの網羅（error path、境界、空、並行） | 分岐や状態変更を足したのにテストが無い | 名指しできる振る舞いと入力 | test | AR | CE testing（MIT）、Microsoft playbook「Tests」 | 済。tr:36 |
| H3 | 決定性と隔離 | 時刻、乱数、順序、共有状態、実ネットワーク |  | test | AR | Beck の Deterministic と Isolated | 済。tr:33-34 |
| H4 | テスト設計（構造不感、読みやすさ、特定性）と本番コードのテスト容易性 | モックの多用、実装詳細への assert、テスト専用の本番 seam | Beck の 12 の性質 | test | AR、LS（`*-testing`） | https://testdesiderata.com/ [要約] | 一部。tr:29（内部 collaborator への assert）、rr:196（props の制御）。テスト専用 seam と重複カバレッジは無し |
| H5 | テストの層の選択（契約、統合、E2E） | 境界をモックだけで通すテスト | 実際の境界を通すか | test | AR | Google「Tests」、Google Testing Blog の E2E 反論 [R-WL §3] | 済。tr:31 |
| H6 | 非機能テスト（負荷、計装、a11y の自動検査、移行のリハーサル） | 性能や可用性に効く変更 | どの負荷試験・計装・段階展開が要るか | load | AR | AWS Performance efficiency「Performance test automatically」、SRE「load testing is required for most launches」 | 一部。wl:70「Verification to add」。a11y の自動検査やセキュリティテストを要求する項目は無し |
| H7 | バグ修正の回帰テスト | 修正のコミット | 修正前に落ちるテスト | test | AR | CRD §11（二次の問い）、ClickHouse「Test coverage」 | 済。tr:30 |
| H8 | カバレッジの水増しとテストの保守費用 | 割合目標のためのテスト | 落ちようのないテスト | test | AR | Google「tests are also code」 | 済。tr:35 |

### I 保守性・PR の衛生・伝え方

12 行: 済 4 / 一部 6 / 無 2

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| I1 | 命名 | 新しい識別子 | 意図を伝える長さ、曖昧語（data、handler、manager）、bool の接頭辞 | code、lang | LS | Google「Naming」、CE maintainability の Vague Name と Mysterious Name | 一部。python-reviewer.md:74、typescript-reviewer.md:105、gr:102 は規約レベル。cr は taste を除外（cr:50） |
| I2 | コメント: why だけ、AI 由来の水増し、陳腐化 | 新しいコメント、TODO | what を言い換えるだけのコメントの削除、言い訳のコメント | code | AR | Google「Comments」、pr-review-toolkit の comment-analyzer、Bun の規則「paragraph-long comment ... the code is wrong」（Willison の転載 [R-REV §2.7]） | 済。cr:40-41、CRD:177-191、CS:12（pstack の `no-comments`） |
| I3 | ドキュメントの更新（README、API doc、changelog、移行手順） | ビルド・使い方・公開面・設定の変更 | 関連文書の更新、削除や非推奨の反映 | code | AR、PJ | Google「Documentation」、ClickHouse の changelog 品質ゲート、Keep a Changelog https://keepachangelog.com/en/1.1.0/ | 無。cr、CS、CRD、gr、typescript/python-reviewer を grep（README、changelog、documentation）。DR:10 は設計書の grounding を読む指示で、差分の文書更新ではない |
| I4 | 既存コードとの一貫性と重複 | 既存 helper と同等の新実装 | 既存を調べる（1 つの例で判断しない）、重複 | code | AR | Google「Consistency」、CE maintainability | 済。cr:41、CRD:26-56 |
| I5 | デッドコードと残骸 | コメントアウト、未使用の export、互換 shim |  | code | AR | Fowler の Dead Code | 済。cr:41、wp:129 |
| I6 | PR の大きさ・スコープ・無関係な変更・リファクタと機能の分離 | 差分の混在 | 1 つの自己完結した変更か、整形やリファクタは別 PR | lead、code | RS | Google small CLs（一つの自己完結した変更）、Microsoft playbook の Size Guidance、SmartBear（200 から 400 LOC、ベンダー）[2.1] | 一部。CRD:115,145 は自己レビューの習慣。他人の PR のスコープを検査する担当は無く、CS:22 の 200 行は「厚さ」の判定だけ |
| I7 | PR の説明とコミットメッセージ（何を、なぜ、欠点、チケット） | PR 本文、コミット | 何を・なぜ、欠点、リンク | lead | RS | Google「CL descriptions」、Microsoft playbook の Author Guidance（CC-BY-4.0）、Conventional Commits https://www.conventionalcommits.org/en/v1.0.0/ | 一部。CRD:116（自己レビュー）。CS:34 は意図の取得だけで、説明の質の検査は無し |
| I8 | デプロイの流れに合う PR の分割（移行、コード、削除をこの順に、フラグの背後で小さく） | schema の変更とコードの変更が同居 | デプロイの順で戻せる単位か | lead、design | RS、DC(compatibility-rollout) | Microsoft playbook（feature flag や canary で小さく）、Stripe「a few hundred lines」、Fowler ParallelChange | 一部。DR:19（設計段階の移行順）。コード差分の分割の検査は無し |
| I9 | AI 生成コードの兆候（存在しない API や依存、冗長、言い訳） | 見慣れない import や API、過剰な防御 | 実在の確認、言い訳コメント | code、sec | AR | Bun の reviewer 規則 [R-REV §2.7]、go-version-scout（API の出所の確認） | 一部。sr:39（package が実在するか）、go-version-scout（Go だけ）、CRD:191 |
| I10 | レビューコメントの書式（blocking と non-blocking、nit、praise） | reviewer の出力 | Conventional Comments の label と decoration、良い点も書く | lead | RS | Conventional Comments（CC BY 3.0）、Google「Good Things」 | 済。OF:16-21（severity、confidence、label の別方式）。praise は ur:51 の 1 行だけ |
| I11 | 利用者向けの文字列と診断メッセージの質 | エラー文、ログ文、CLI の出力 | 何が悪く次に何をすればよいか | code | AR | ClickHouse「Message, docs, and metadata quality」 | 無。reviewer と skill に項目無し |
| I12 | 開発者体験: ビルド時間とヘッダの肥大 | 広く include される header、重い依存の追加 | コンパイル時間 | lang(cpp) | LS | ClickHouse「Compilation time」（Major） | 一部。cpp-reviewer.md:71（unnecessary includes）だけ |

### X 手順の観点（どの領域にも掛かる考え方）と周辺

7 行: 済 1 / 一部 4 / 無 2（元の頁ではこの表に L1 も載せて 8 行としていた。集計では L として分けている）

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| X1 | Contract: PR が約束する振る舞いを導く | PR のメタデータ、テスト、docs | 違反した不変条件として書く（チェックリスト一致にしない） | code | AR | ClickHouse ゲート 1 | 一部。cr:21（intent の入力）。約束の導出手順は無い |
| X2 | Impacted surface: 不変条件を未変更の呼び出し元と兄弟実装まで追う | 新しい設定、モード、不変条件 | すべての carrier を追う | code | AR | ClickHouse ゲート 2、Google「Context」 | 一部。cr:38（呼び出し元を grep） |
| X3 | Failure and divergence: 起動、定常、停止、再試行、キャンセル、部分進行 | 状態を持つ変更 | 各段階で何が残るか | code、load | AR | ClickHouse ゲート 3、CE adversarial | 一部。cr:35、wl:33 |
| X4 | Evidence: 主張ごとの証拠 | 性能や修正の主張 | 前後の測定、回帰テスト | code、test | AR | ClickHouse ゲート 4 | 済。cr:46、tr:30、reviewer-requirements.md §4 |
| X5 | 一つの指摘で話題を閉じない（完全性の問いへ戻る） | 指摘の隣のコード | 「形」の指摘のあと、到達性と完全性を問い直す | code | AR | ClickHouse「Do not let one finding close a topic」 | 無。cr と CRD に該当文無し |
| X6 | 再レビューと過去の学びとの照合 | 既存のレビュースレッドがある PR、解決策のコーパス | 前回の指摘が直ったか、既知の解決策と衝突しないか | lead | RS | CE の previous-comments と learnings（MIT） | 一部。OF:56-61 は学習ループ（記録）だけ。再レビューの手順は無し（grep re-review 0 件） |
| X7 | エージェント向けの表面（skills、agents、tools、MCP、プロンプトの変更） | skills、agents、prompts、tools | agent から使えるか、記述があいまいでないか | code | PJ、AR | CE の agent-native-reviewer（MIT） | 無。cr、sr、CS を grep（agent-native、MCP）0 件。sr:43 はセキュリティ面だけ |

### L AI 機能の品質運用

1 行: 無 1

| ID | 観点 | 差分での起点 | 確認すること | 担当 | 置き場 | 出典 | 現状と根拠 |
|---|---|---|---|---|---|---|---|
| L1 | AI 機能の品質運用（評価、モデルの固定、フォールバック、出力の検証、トークン費用） | プロンプト、モデル名、温度、ツール定義の変更 | eval の有無、モデルと版の固定、フォールバックの先、出力のスキーマ検証、トークン上限、人間の承認の位置 | code、load | DC(新 ai-feature-review) | NIST AI RMF（Govern、Map、Measure、Manage）と Generative AI Profile（NIST-AI-600-1）https://www.nist.gov/itl/ai-risk-management-framework [要約]、AWS の Generative AI lens と Machine Learning lens、Google Cloud の AI/ML perspective（5 柱） | 無。sr:43 はセキュリティ面だけ。品質運用の項目は無し |

## どの reviewer も持たない考え方 3 つ

今の reviewer が受け持つ考え方は、正しさの追跡（code）、攻撃経路の追跡（sec）、負荷とストーリーの追跡（load）、見た目の判定（ui）、テストの有効性（test）、反証（verifier）の 6 つ。compound-engineering の設計メモにある弁別基準「A concern is a candidate for its own dispatch when answering it requires a different reasoning mode」（答えるのに別の考え方が要るなら別の役にする）に当てると、どれにも属さない考え方が 3 つある。これは推論で、根拠 URL は無い。

1. **文書と差分の突き合わせ**。A5（仕様・受け入れ条件）、A6（プロダクト適合）、I3（ドキュメント更新）、I6 から I8（PR の大きさ・説明・分割）、X6（再レビュー）。入力は PR の説明、チケット、ADR、changelog で、差分の外にある情報を読む。
2. **旧版と新版が同居する時間の推論**。E3（互換性）、E4、E5（フラグ・ロールバック）、I8（デプロイ順）、E6（設定）。入力は「デプロイの途中の状態」。DR:19 の release lane は設計書の段階にだけある。
3. **個人データの流れの追跡**。C7、C8、C9。攻撃者ではなく、規制と利用者の権利から入口と出口を追う。

調査の時点では、これらを新しい reviewer にするか、`code-reviewer` と `workload-reviewer` の入力と節を増やすかは持ち主の判断として残し、決めていなかった。

> [!note]
> 2026-10-19、持ち主はこの 3 つについて、`spec-reviewer`（1 の文書と差分の突き合わせ）と `rollout-reviewer`（2 の旧版と新版が同居する時間）を足し、3 の個人データの確認は独立の reviewer にせず `security-reviewer` の節として持たせることを裁定した。決定は `harness/rules/decisions/2026-10-19-spec-and-rollout-reviewers.md` にある。上の表の「現状」欄はこの裁定の前（HEAD `36e1922f`）の状態である。

## 分類の空白から導かれる skill とチェックリスト

調査では採否の判断はしていない。状態の「既出」は既存調査で提案済み、「新規」はこの調査で初めて挙がったもの。

| 候補 | 種別 | 担う行 | 状態 | 根拠 |
|---|---|---|---|---|
| api-design-review | skill（references/review-checklist.md を持つ） | A4、E3 の契約面、B6 の冪等の契約面 | 既出（R-BE §10） | Google AIP-121、158、180（CC BY 4.0）、SemVer |
| algorithmic-complexity-review | skill | A12 | 既出（R-BE §10） | cp-algorithms（CC BY-SA 4.0） |
| distributed-correctness | skill | B5 の理論面、B6、D3、A13 | 既出（R-BE §10） | Kleppmann、Brooker、Envoy docs |
| terraform-patterns | skill | F4、D8 の IaC 側 | 既出（R-INF §8.2） | HashiCorp lifecycle docs、Checkov |
| github-actions-patterns | skill | F7（C5 の補い） | 既出（R-INF） | GitHub のセキュリティ強化文書、zizmor |
| aws-patterns、docker-patterns、nix-patterns | skill（小） | F8、F6、F10 | 既出（R-INF） | 各社の公式文書 |
| semantic-html | skill | G2 | 既出（R-FE §10） | WCAG 2.2、W3C APG |
| 各言語の `references/review-standard.md` | 言語 skill の参照 | B10 から B12、I1、I12 | 既出（`2026-10-19-review-redesign.md` の段 2） | 各言語の公式（R-LANG） |
| 既存 skill への checklist 追加 | sql-tuning に分離水準の節（B13）、ddd-modeling-review、code-review-discipline に性能の騒音抑制（D2）、k8s、gcp、cloudflare | B13、A3、D2、F5、F8 | 既出（R-BE、R-INF、R-FE） | R-BE §10、R-INF §12 |
| security-review の checklist | skill（references） | C 群 | 既出（R-SEC §13）。再設計で sr 本文の表と `security-audit.md` に入ったため、skill 側の checklist は未作成 | ASVS、OWASP Cheat Sheet |
| privacy-data-lifecycle | skill（references/review-checklist.md） | C7、C8、C9 | 新規 | GDPR 第 25 条、LINDDUN、ASVS V14 |
| data-primitives | skill（小） | B7 時刻、B8 お金と数値、B9 Unicode | 新規 | Stripe の最小通貨単位、Falsehoods about time、W3C i18n |
| i18n（data-primitives に同居でもよい） | skill または節 | G7、B9 | 新規 | W3C i18n quick tips |
| compatibility-rollout | skill | E3、E4、E5、E6、I8（api-design-review と統合しうる） | 新規 | ParallelChange、feature toggles、12-factor、Stripe |
| design-smells | reviewer 本文の節（名前＋検出条件）か maintainability の checklist | A8、A9、A10、I1 | 新規 | Ousterhout、Fowler、CE maintainability（MIT） |
| ai-feature-review | skill | L1 | 新規 | NIST AI 600-1、AWS Generative AI lens |
| ml-pipeline-review | skill（ML コードがあるときだけ） | E7 | 新規 | Rules of Machine Learning、ML Test Score |
| mobile-review | skill（薄い、Android・iOS・Flutter 共通） | G10、D10 | 新規 | Android core app quality、OWASP MASVS |
| cost-and-sustainability | checklist（cloud skill 群に横断） | D8、D9 | 新規（D8 の一部は既出） | FinOps、SCI、WA の sustainability の柱 |
| supply-chain-and-license | checklist（security 側に同居） | F11、F12 | 新規 | OpenSSF Scorecard、SPDX |
| ops-readiness | checklist（observability-patterns に同居） | F3 | 新規 | SRE PRR、ローンチチェックリスト |
| change-review の手順への追加 | 手順（PR 衛生と文書の突き合わせの段、再レビュー） | A5、A6、I3、I6 から I8、X5、X6 | 新規 | Google small CLs と CL descriptions、Microsoft playbook、CE previous-comments |
| agent-surface | checklist（この種のリポジトリ向け、PJ） | X7 | 新規 | CE agent-native-reviewer |

## O'Reilly について

- この環境には O'Reilly の公式 Search MCP（O'Reilly の書籍を検索する MCP サーバー）が設定されていない。確かめた場所は `~/.claude.json` の `mcpServers`（serena、codebase-memory-mcp、context7、figma-remote、notion-mcp の 5 つ）、`harness/mcp/servers.json` を含む `harness/` 全体の grep（oreilly で 0 件）、調査したセッションのツール一覧。検索も本文の取得も一度もしていない。
- 公式ガイド（https://www.oreilly.com/online-learning/support/mcp-guide.html 、要約経由）によると、Search MCP は全会員が使え、返すのはタイトル、形式、リンクの一覧だけ。引用つきの回答を返す Expert MCP は企業向けの追加契約。ガイドには Search MCP の URL も Claude Code への追加手順も載っていない。
- 会員契約（https://oreilly.com/membership-agreement 、最終更新 2024-10-09）は、内容を AI へ入力・複製・送信すること、第三者のサイトへ載せることを禁じ、引用は 1 つの文章から合計 250 語までとしている。契約に沿う使い方は、Search MCP が返すタイトルと URL までを使い、本文を AI に読ませず、公開リポジトリにも載せないこと。
- 有効にするには O'Reilly の有効な会員アカウントが要る。接続は claude.ai の Connectors か MCP サーバーとしての登録のどちらかで、URL は未確認。このリポジトリでは Claude Code の MCP は jig が `mcpServers` を書いて配り、一覧は決定メモが定めるので、追加するなら新しい決定メモが要る。調査では何も登録していない。

### 参考書の候補（未検証）

公開知識から書名だけを挙げている。O'Reilly 上にあるか、版、章はどれも確認していない。本文の言い換えや引用はしていない。

| 観点の群 | 候補（著者） |
|---|---|
| 設計・複雑さ・臭い | 『A Philosophy of Software Design』（Ousterhout）、『Refactoring』第 2 版（Fowler） |
| レビューの進め方 | 『Software Engineering at Google』（Winters ほか。コードレビューの章を含むと記憶、章番号は未確認） |
| ドメイン・アーキテクチャ | 『Learning Domain-Driven Design』（Khononov）、『Clean Architecture』（Martin） |
| データ・分散・互換性 | 『Designing Data-Intensive Applications』（Kleppmann。第 2 版の共著や刊行状況は未確認） |
| 信頼性・運用・観測性 | 『Site Reliability Engineering』（Beyer ほか）、『Observability Engineering』（Majors ほか）、『Release It!』第 2 版（Nygard） |
| セキュリティ・プライバシー | 『Building Secure and Reliable Systems』（Google）、『Threat Modeling』（Shostack）、『Practical Data Privacy』（Jarmul。確度が低い） |
| テスト | 『Unit Testing Principles, Practices, and Patterns』（Khorikov）、『Test Driven Development: By Example』（Beck） |
| インフラ・クラウド・費用 | 『Terraform: Up & Running』（Brikman）、『Kubernetes Patterns』（Ibryam、Huß）、『Cloud FinOps』（Storment、Fuller） |
| フロント・UX | 『Designing Interfaces』（Tidwell ほか）、『Refactoring UI』（Wathan、Schoger。自費出版で O'Reilly ではない） |
| ML・AI | 『Designing Machine Learning Systems』（Huyen）、『AI Engineering』（Huyen） |
| 持続可能性 | 『Building Green Software』（Currie ほか） |

## 検証できなかったこと

- ISO/IEC 25010:2023 の規格本文と quality-in-use（iso.org は 403）。副特性の所属（Testability の位置）は二次の要約どうしで食い違う。
- Apple App Store Review Guidelines、W3C i18n quick tips、LINDDUN の本文と licence（到達と見出しの確認だけ）。OWASP MASVS の各群の説明文と licence。
- GDPR 第 25 条の条文は要約経由で、逐語ではない。
- Ousterhout の red flag の定義（本の中にある。名前の一覧だけを二次の要約から取った）。
- コードの臭いの検出の F1 の数値（arXiv 2601.09873 の抄録には無く、compound-engineering の設計メモ経由の孫引き）。
- Microsoft playbook 以外の言語別チェックリストの各項目の突き合わせ。ECC など言語別 reviewer の中身。
- compound-engineering の 16 から 6 への統合案が出荷されたか。
- 観点ごとの検出率。数字があるのは Semgrep の誤検知 86%、a11y の自動検出 40 から 57%、スクリーンショット単独の UI 検出の適合率 0.09 の 3 つの断片だけで、新しく足した観点（プライバシー、i18n、互換性、ライセンスなど）には測定が無い。
- 「現状」欄は reviewer と skill の本文を読んだ結果と grep の結果で、実際にレビューを動かしたときに検出できるかは測っていない。

### 前例が見つからなかったもの

- プライバシー、データのライフサイクル、i18n、ライセンス、持続可能性を、差分レビューの AI の観点として独立に公開し、効果を測った例。
- 互換性、フラグの寿命、デプロイ順の PR 分割を差分レビューの観点として列挙した公開の reviewer（compound-engineering の api-contract と data-migration が最も近いが、PR の分割は扱わない）。
- ISO 25010 のような上位の分類全体を、AI のコードレビューの設計根拠に直接使った公開の実装。差分の兆候への写像はこの調査で作った（推論）。
- 観点の数と検出率・費用の関係を測った研究（IFScale と文脈ファイルの研究は別の課題）。
