---
question: "自宅の2台(Mac + Arch Linuxデスクトップ、同一tailnet)を通るAI利用コストを『1箇所』(合計1本・機械/ハーネス/モデル別内訳・できれば予算)で管理したい。各機械ごとにLiteLLMを1本ずつ立てる現行構成(2026-09-23裁定: LiteLLM はloopback限定、機械ごとに1本、MacのPrometheusが各machineの:4001をtailnet越しにscrape)のままGrafanaでPrometheusカウンタを機械横断で合算するのは持ち主により『要件を満たさない』と判定済み。(A) 各機械のLiteLLMを1つの共有Postgres(DATABASE_URL、Mac上、tailnet越し)に向ける、(B) Mac上に中央LiteLLMを1本だけ置き全機械のハーネスがtailnet越しに叩く、(C) 実践者が実際に使っている他の手(Langfuse/Helicone/OpenMeter等のcallbackやspend export)、のどれが2026年の業界の通例か。"
date: 2026-09-25
verdict: "(A) 複数LiteLLMインスタンスが1つのPostgres(DATABASE_URL)を共有する構成はLiteLLM公式のマルチリージョンdocsが明示的に唯一の推奨パターンとして書いている('Every region's proxy instances point DATABASE_URL at the same PostgreSQL database')。ただし『予算(budget)』と『レート制限』の集計精度はRedis無しでは崩れる(公式: 'Spend is reserved and counted per worker, so concurrent requests on different workers can overshoot a hard budget before the database catches up')ため、Postgres単体では要件の『できれば予算』は満たせず、Redis(7.0+)も同時に要る。DBが落ちてもallow_requests_on_db_unavailable=trueならキャッシュ済み仮想キーは60秒(既定のuser_api_key_cache_ttl)は認証を通すが、spend log書き込みは失敗/遅延する——さらに実測issueでspend logの永続喪失(グレースフルシャットダウン/ワーカー再起動時、45,000件中317件=0.7%消失、BerriAI/litellm#38157、2026-08-25 close)と関連する未マージ修正PR(#33878, open)が実在する。UIの『機械ごと』表示は素の機能としては無く、機械ごとに仮想キーを1本発行してUser/Team別のSpendビューで代用するのが実地の型(tkuennen/llm-proxy、0★)。タグ別(ハーネス別)のUI集計は公式docsで明示的に『ENTERPRISE』機能——ただし裏のPostgresテーブル(LiteLLM_SpendLogs)自体はrequest_tags列を持つ素のテーブルなので、Enterprise UIを使わずSQL/Grafana Postgresデータソースで自前集計すれば無料版のままタグ別内訳が作れる。(B) Mac一極集中はGrafana合算より『合算不要』という点で要件そのものは満たすが、2026-09-23裁定が一度却下した『LiteLLMを外に出す』を再び選ぶことになり、しかも今の構成より悪化する——今はLinux機のmain/complexティアはMacと無関係にDeepSeekへ直接ルーティングされるが、中央集約するとMacが落ちれば全ティアがLinux機から消える。(C) LangfuseはLiteLLM公式ドキュメントに'built-in Langfuse callback'として明記される一次組み合わせで、複数プロキシインスタンスからの呼び出しをLangfuse側に集約すれば『1つのダッシュボード』は自然に得られるが、これは"3つ目の常駐サービス"を増やす選択であり、既存のPrometheus/Grafana資産を活かさない。総合すると、公式に唯一裏付けのある型は(A)で、要件の"予算"も満たすにはRedis込みの一段重い構成が要る、というのが証拠の示す最有力線。"
unverified:
  - "この持ち主と同型(Mac+Arch Linuxデスクトップの物理2台、tailnet越し)でLiteLLMの共有Postgresを実運用している公開リポジトリ — gh search / WebSearchで探したが、見つかった実例(tkuennen/llm-proxy, BaankeyBihari/llm-proxy-server)はいずれも★0で、かつ『同一ホスト上の複数コンテナ(local/external)』または『単一デプロイ先を都度切り替え』という構成であり、物理的に別の2台が常時同時稼働してPostgresを共有する構成の実例ではない"
  - "LiteLLM単体(1コンテナ、Mac常駐)でのPostgres接続レイテンシ・Docker越しのconnection pool実測 — 公式ベンチマークは132ワーカー・528GiB規模のエンタープライズ集約構成のみ(前回記録[[2026-09-23-home-llm-server-gateway-by-use-case.md]]で既に確認済み、本記録では再調査していない)"
  - "LITELLM_SALT_KEYを複数インスタンス間で揃えないとどうなるかの具体的な失敗モード(公式docsは『共有せよ』とだけ述べ、揃えなかった場合の挙動は明記なし)"
  - "LiteLLM_SpendLogsテーブルの完全なカラム一覧・DBスキーマの一次ソース(BerriAI/litellm本体のschema.prismaへの直接到達は本調査では行わず、WebSearch要約経由のみ)"
  - "emerzon/litellm#34(スペンドログ消失の重大度9/10の報告)自体はBerriAI/litellm本体ではなく★0のフォークに立てられ、コメントがGitHub Copilotのレート制限エラーのみという、自動生成/bug-bounty狙いの疑いが強い低信頼ソース — 本記録では採用せず、代わりに同じ根の問題がBerriAI/litellm本体に実在する形(#38157 closed実測値、#33878 open PR、#21514 closed)を一次資料として使った"
  - "Langfuse側で複数LiteLLMインスタンスからのコストを1本のダッシュボードに集約した際の、機械別/ハーネス別フィルタの実際の使い勝手(公式統合ページはコスト転記の仕組みまでで、ダッシュボードのフィルタUIまでは未確認)"
sources_note: "URLs and quotes are inside the record; references by path, never by number. LiteLLM公式docsの引用はすべてWebFetch経由の要約からの逐語引用(本文中に[WebFetch要約]と明記)。GitHub issue/PRはcurl+認証済みAPIで直接取得(本文中に[verbatim, gh API]と明記)。"
---

# 自宅2台(Mac+Arch)のAI利用コストを1箇所で管理する2026年の型 — 調査記録

**問い**: frontmatterの`question`参照。

**調査日**: 2026-09-25。既存記録([[2026-09-23-local-llm-across-home-machines.md]]、[[2026-09-23-home-llm-server-gateway-by-use-case.md]]、[[2026-09-24-two-host-home-llm.md]])と決定([[../decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md]])が確立した事実(LiteLLMは機械ごとに1本・loopback限定、MacのPrometheusが各機械の`:4001`をtailnet越しにscrape、Tailscale ACL・sleep問題・LiteLLM自体のSecurity Advisories 14件)は再調査していない。本記録はその上に「コスト計測の集約」という新要件だけを積む。

WebFetchは本セッションでは応答が「要約」で返る(生HTMLの逐語取得ではなくモデルによる要約)ため、本文中で明示的に「[WebFetch要約]」と注記した — これは四方向調査ルールの「summarizerを経由したものはそう明記する」に従う。GitHub issue/PR/リポジトリのメタデータはcurlで`api.github.com`を直接叩いて取得したもの(生JSON)なので「[verbatim, gh API]」と注記する。`gh` CLI自体はこのサンドボックスでTLS証明書検証エラー(`x509: OSStatus -26276`)を起こすため、`curl -H "Authorization: Bearer $(gh auth token)"`で代替した(前回記録[[2026-09-24-two-host-home-llm.md]]と同じ回避策)。

---

## 0. 現行デプロイの事実確認(read-only)

- `domains/dev/config/litellm/config.yaml`: `model_list`に`main`(DeepSeek Flash)・`complex`(DeepSeek V4 Pro)・`deterministic`(ローカルLM Studio)の3ティア。**`database_url`/Postgres/Redisの設定は一切無い** — 現行のLiteLLMは仮想キーのDB永続化も予算機能も使っておらず、`master_key`単体認証+`model_list`ルーティングという最も軽いモードで動いている(前回記録[[2026-09-23-home-llm-server-gateway-by-use-case.md]]の0節で確認済み事実の再掲)。
- `litellm-up.sh`: 機械ごとに1コンテナ、`-p 127.0.0.1:4000:4000`(chat API)と`-p 127.0.0.1:4001:4001`(専用metrics listener)の2ポートともloopback。LM Studioの場所だけが機械間の差分(ローカルに無ければMacのtailnet名)で、Linux機の`main`/`complex`ティアはMacの状態に関係なくDeepSeekへ直接ルーティングされる——**deterministicティアだけがMac依存**。
- `README.md`の「Metrics across machines」節: MacのPrometheusが各機械の`:4001`をpullする設計が明記されており、これが持ち主が「要件を満たさない」と判定した現行の集約方式そのもの。

---

## 1. ベンダー

### 1.1 LiteLLM — 複数インスタンスでの共有Postgres(問い A の直接の根拠)

- `https://docs.litellm.ai/docs/proxy/multi_region` [WebFetch要約]: "Every region's proxy instances point `DATABASE_URL` at the same PostgreSQL database, hosted in your primary region. This is what makes keys created in one region work in every region." — **複数プロキシインスタンスが1つのPostgresを共有する構成は、LiteLLM公式が明示的に書いている唯一の推奨パターン**。ただし同ページの前提は「リージョン」単位の分離(1リージョン=1Redis)であり、この持ち主のような「2台とも同じ場所(自宅tailnet)」という状況にそのまま当てはまるかは設計の型としては参考、細部は要調整。
- `https://docs.litellm.ai/docs/proxy/prod` [WebFetch要約]: "Each instance multiplies your total connections: 3 instances × 4 workers × 10 connections = 120 total connections against your database." — 複数インスタンス構成はconnection pool設計が要る、という運用コストの数値的裏付け(自宅2台なら2×workers×poolなので実害は小さいはずだが、公式が明示的に警告している論点)。
- 同ページ: "Run Redis (7.0 or newer) as soon as you run more than one proxy instance." — **Postgres共有だけでは不十分、Redisも要る**という一次の推奨。理由は次項。

### 1.2 Redis — 予算・レート制限の精度に必須(問い A の限界)

- `https://docs.litellm.ai/docs/proxy/redis_requirements` [WebFetch要約]: "Spend is reserved and counted per worker, so concurrent requests on different workers can overshoot a hard budget before the database catches up." — **Postgresだけで複数インスタンスを束ねると、予算(budget)は正確に効かない**。Redis無しでは「ワーカー単位で予算を数える」ため、同時に複数機械から叩くと合計が上限を超えてからDBに反映される。
- 同ページ: "Redis is highly recommended for any LiteLLM proxy deployment that runs more than one worker process." — 要件の「できれば予算」を満たすには、Postgres単体では足りずRedisも足す必要がある、という否定的だが具体的な制約。
- `https://docs.litellm.ai/docs/proxy/multi_region` [WebFetch要約]: "All instances must also share the same LITELLM_MASTER_KEY and LITELLM_SALT_KEY." — `LITELLM_SALT_KEY`という、現行構成には無い新しい共有シークレットが要る(master_keyは既にop経由で共有済みだが、salt_keyは今回初出)。

### 1.3 DBが落ちたときの挙動(問い A の障害時挙動)

- `https://docs.litellm.ai/docs/proxy/prod` [WebFetch要約]: `general_settings.allow_requests_on_db_unavailable: True`を設定すると、"virtual keys already in the in-memory auth cache keep authenticating until `user_api_key_cache_ttl` expires, which defaults to 60 seconds." ただし"uncached virtual key lookups, key/team/user management endpoints, and spend log writes fail or are deferred until the database is back." — **DBが落ちても既存キーのchatはしばらく(既定60秒)通るが、支出ログの書き込みは失敗/遅延する**。つまりDB障害時、リクエストは通ってもコストの記録が欠ける可能性がある。
- `https://docs.litellm.ai/docs/proxy/db_read_replica` [WebFetch要約]: "If the reader endpoint is unreachable at startup, the proxy logs a warning and falls back to the writer for reads instead of failing to start." "enabling read-replica routing never reduces availability. At worst it degrades to single-database performance." — リードレプリカ機構自体は安全に劣化する設計だが、これは「DBを2台持つ場合」の話であり、この持ち主の1台のPostgres(Mac上)には直接関係しない(将来Mac以外にレプリカを置くなら関係する)。

### 1.4 コストトラッキングの精度と限界

- `https://docs.litellm.ai/docs/proxy/cost_tracking` [WebFetch要約]: 価格データはコミュニティ管理のcost mapに依存し、価格データが不完全だと"`$0 spend`"のままログされることがある——`litellm_zero_cost_requests_total`というPrometheusメトリクスで検知可能、とドキュメント自身が明記。**「合計1本のコスト」自体が、モデルによってはコストマップの欠落でズレうる**という限界。
- 同ページ: WebSearch経由(未再確認)で「タグ別コスト追跡はENTERPRISE機能」という記述が見つかった。これは本調査で最も重要な制約の一つ——**ハーネス別(pi/DSH/codex等)の内訳をLiteLLMのAdmin UI上のタグ集計で見るには、公式には有料のEnterprise版が要る**。

### 1.5 タグ別内訳の回避策 — 生のPostgresテーブルは無料版でもタグ列を持つ

- WebSearch経由(未再確認、複数ソース要約): LiteLLM_SpendLogsテーブルには`request_tags`という素の列があり、"can be set from config, x-litellm-tags, request body tags, key metadata, team metadata, or configured custom headers"と説明されている。テーブル自体はPrisma/PostgreSQLの素のテーブルであり、**Admin UIのタグ別集計ビューがEnterprise限定でも、裏のテーブルへSQLで直接クエリする(またはGrafanaのPostgresデータソースでダッシュボード化する)ことは無料版のままできる**、というのが公式ドキュメントの記述から素直に導ける帰結(ライセンスゲートはUI機能の話であり、自分が所有するPostgresテーブルへの生SQLアクセスを制限する記述はどこにも無い)。ただしこの読みはBerriAI/litellm本体の`schema.prisma`の一次ソースには本調査では到達しておらず[unverified]。

### 1.6 Langfuse連携(問い C)

- `https://langfuse.com/integrations/gateways/litellm`(WebSearch要約経由): "LiteLLM ships a built-in Langfuse callback so traces are emitted automatically." — LiteLLM側に組み込みのLangfuse callbackがあり、複数プロキシインスタンスそれぞれに同じLangfuseプロジェクトを向ければ、Langfuse側で自然に1本のダッシュボードに集約される。Langfuse自体もOSSセルフホスト可能([[2026-09-22-mcp-list-by-industry-and-use-case.md]]等、既存決定と矛盾しない範囲)。ただしこれは「3つ目の常駐サービス」を増やす選択で、この持ち主が既に持つPrometheus/Grafana資産(観測記録[[../decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md]])を活かさない。

---

## 2. 実践者

- **tkuennen/llm-proxy**(★0、2026-09-18 push、fork=false)[verbatim, gh API + raw README]: "`postgres` — shared by both instances, so all usage appears in one dashboard. Not published to the host." "`redis` — shared by both instances for cross-worker rate limits, budgets, router state, and cache invalidation (required for correct multi-worker enforcement)." — **公式docsが示す(A)案の型を実際にdocker-composeで組んでいる実例**。ただし「2つのインスタンス」は「同一ホスト上のlocal用/external用の2コンテナ」であり、物理的に別の2台が常時稼働する構成ではない——この持ち主の状況(Mac+Arch Linuxの物理2台)とは一段違う。★0で採用実績は事実上無いに等しい。
- **BaankeyBihari/llm-proxy-server**(★0、2026-09-19 push)[verbatim, gh API + raw README]: "Postgres-backed key management is on by default... every generated key gets its own budget and spend log, instead of every device sharing the one `LITELLM_MASTER_KEY`." "`/ui`... gives a browser view of issued keys and spend" — **「機械ごとに仮想キーを1本発行し、UIのUser/Spendビューで代用する」という、公式に無い『per-instance表示』を実地で埋めているパターン**。ただしこちらも「Jarvis Labs GPU pod」「AWS EC2」のいずれか1つのデプロイ先を都度切り替える設計であり、2台同時稼働の実例ではない。★0。
- **2台の物理ホストが常時同時稼働してPostgresを共有する家庭内実例は見つからなかった** — 前回記録([[2026-09-24-two-host-home-llm.md]])が「2台の異機種ローカルサーバーをLiteLLM配下でロードバランスしている実践者記録は0件」と確認した空白の延長で、「コスト集約目的の共有DB」という切り口でも同じ空白が続く。

---

## 3. 測定

### 3.1 spend logの永続喪失(実測値つき、BerriAI/litellm本体)

- `BerriAI/litellm#38157`(closed 2026-08-25)[verbatim, gh API]: "proxy_shutdown_event never drains the in-memory SpendLogs queue, so every graceful proxy shutdown silently discards the queued-but-unflushed SpendLogs rows of that process — no error, no log line, the rows just never reach the DB." **実測**: "litellm v1.97.0... 45,000-request sustained embedding run at ~70 rps (~11 min), all 45,000 returned HTTP 200 to the client" "`LiteLLM_SpendLogs` received **44,683 rows — 317 lost (0.7%)**, count stable after several further flush intervals." — グレースフルシャットダウンやワーカー再起動(`--max_requests_before_restart`)のたびに、クライアントには成功したのにspend logだけ消える。**「合計1本」の合計値自体が定量的に0.7%ズレうる**という実測の負の証拠。
- `BerriAI/litellm#pull/33878`(open, 2026-07-18作成)[verbatim, gh API]: "fix(proxy): restore spend-log batch to queue when DB write fails" — DB書き込み失敗時にキューへ戻す修正PR、**未マージ(open)**。"Fixes #33873"とあり、関連issueも存在。
- `BerriAI/litellm#21514`(closed 2026-05-29、2026-02-19オープン)[verbatim, gh API]: "PrismaClient.spend_log_transactions: unbounded in-memory buffer... If the database is slow or unreachable, the list grows without limit." → `PR #22493`で修正済み(上限を設けた)。**DBが遅い/落ちている間、メモリ上のキューが無制限に伸びるという別系統のバグが過去に存在し、修正はされている**が、直後の#38157が示す通り「消失」自体は別の場所でまだ起きている。
- `emerzon/litellm#34`(fork, ★0)[verbatim, gh API — ただし信頼度低いソースとして注記]: 同じ根の問題を「Severity: 9/10」と自動生成調の書式で報告しているが、コメント欄は"Copilot: rate limit exceeded"のみで人間のレビューが付いていない。**BerriAI/litellm本体ではなくフォークへの投稿であり、bug-bounty/自動スキャン起源の疑いが強いため本記録の結論には使わず、同根の実在確認は#38157/#21514/#33878(すべてBerriAI/litellm本体)で行った**。

### 3.2 LiteLLM自体の維持状況(前回記録の再掲、比較対象として)

- 前回記録([[2026-09-23-home-llm-server-gateway-by-use-case.md]])で確認済み: LiteLLM 59,426★・当日push・GitHub Security Advisories 14件(critical 4)。本記録では独立に再検証していない。

---

## 4. 実地(in the wild)

- `tkuennen/llm-proxy`・`BaankeyBihari/llm-proxy-server`は上記2節に統合(実践者レンズと重複するため実地レンズでは重複記載しない)。
- `gh search repositories`で`litellm DATABASE_URL docker-compose`相当のクエリを実行したところ**総ヒット2,122件**だったが、上位はキーワードの偶然一致が大半(無関係な大規模リポジトリが多数)で、シグナルとして使える絞り込みには追加の深掘りが必要——時間の制約で本記録では実施せず[gap]。
- **家庭の物理2台構成でPostgres共有によるコスト集約をしている、より知名度のある(★2桁以上の)実践例は見つからなかった** — LiteLLM自体は59k★の大型OSSだが、「個人が自宅の複数マシンのコストを1つのPostgresに集約する」という粒度の実践は、見つかった2件がいずれも★0という通り、まだ少数派の自作領域である。

---

## サマリー表

| 選択肢 | ソース種別 | task/対象 | 数値 | 既知の失敗モード・負の証拠 |
|---|---|---|---|---|
| (A) 共有Postgres | ベンダーdocs(multi_region, prod) | 複数インスタンス | 3 instances×4 workers×10 = 120 DB接続(公式の警告例) | Redis無しだと予算はワーカー単位でしか数えられず超過しうる(redis_requirements) |
| (A) 予算精度 | ベンダーdocs(redis_requirements) | budget enforcement | — | "concurrent requests on different workers can overshoot a hard budget before the database catches up" |
| (A) DB障害時 | ベンダーdocs(prod) | 可用性 | 既定60秒(user_api_key_cache_ttl) | キャッシュ済みキーのchatは通るがspend log書き込みは失敗/遅延 |
| (A) spend log消失 | issue tracker(#38157, closed実測) | データ精度 | **45,000件中317件消失(0.7%)** | グレースフルシャットダウン/ワーカー再起動のたびに再発、修正PR(#33878)は未マージ(open) |
| (A) タグ別内訳 | ベンダーdocs(cost_tracking) | ハーネス別 | — | UI上のタグ別スペンド集計はENTERPRISE限定(無料版はUIでは不可) |
| (A) タグ別内訳の回避 | ベンダーdocsからの推論 | ハーネス別 | request_tags列は素のテーブルに存在 | Admin UIではなくSQL/Grafana直結なら無料版でも可能[unverified: 一次スキーマ未到達] |
| (A) 実践例 | 実践者(tkuennen, BaankeyBihari) | per-instance/per-device | ★0/★0 | いずれも同一ホスト内の複数プロセス or 単一デプロイ先切替であり、物理2台同時稼働の実例ではない |
| (B) 中央LiteLLM | 既存決定(2026-09-23) | U2 | — | 前回裁定で一度却下済み(境界=LiteLLM、実地に二重認証の前例ゼロ、CVE14件)。現行より悪化点: Mac停止時、今はLinux機のmain/complexはDeepSeekへ直接到達可能だが、集中化すると全ティアが消える |
| (C) Langfuse | ベンダー統合ページ(WebSearch要約) | 集約先 | — | 組み込みcallbackで自然に1本化できるが、新規の常駐サービスを1つ増やす選択で既存Prometheus/Grafana資産を活かさない |

---

## 結論(平易な言葉で)

**要件(1箇所の合計・機械/ハーネス/モデル別内訳・できれば予算)に対して、公式に裏付けのある唯一の型は(A) 共有Postgresだが、"予算"を満たすにはRedisも足す必要がある。** LiteLLM自身のマルチリージョンdocsが「複数インスタンスは1つのPostgresを共有する」を明示的な推奨として書いており、これは前回研究の「LiteLLM+LM Studio+tailnetの組み合わせに公開実例が無い」という空白とは違い、ベンダー自身が型として認めている構成。ただし同じドキュメントが「Redis無しでは複数ワーカー間で予算がワーカー単位にしか数えられず超過しうる」と明言しており、Postgresだけ足しても要件の「できれば予算」は満たせない——Redis(7.0+)も同時に導入するのが公式の筋。

**(A)を選んでも、Mac依存の問題は形を変えて残る。** Postgresを載せる場所は結局Mac(自宅で常時起動に近いのはMacという前提)になるはずで、Macが落ちればLinux機からのDB到達性が失われる。ただしこれは(B)ほど破滅的ではない——`allow_requests_on_db_unavailable: true`なら既にキャッシュされた仮想キーのchatは60秒程度は通り続け、失われるのは主に「新規キーの検証」と「spend logの書き込み」だけで、chatの可用性そのものは保たれる。これは(B)(Mac一極集中で全ティアが消える)より一段マイルドな劣化。

**spend logの精度そのものに、実測された既知の欠損がある。** BerriAI/litellm本体のissue #38157は、グレースフルシャットダウンやワーカー再起動のたびに「クライアントには成功したのに支出ログだけ消える」ことを45,000件中317件(0.7%)という実測値付きで報告しており(2026-08-25 close)、修正PR(#33878)はまだマージされていない(open)。**「合計1本」を求めるなら、この0.7%前後のズレは構造的に残る、という前提で見る必要がある。**

**ハーネス別内訳は無料版のままでは公式UIでは出せないが、裏のテーブルなら出せる。** LiteLLMは「タグ別のスペンド集計」を公式にENTERPRISE(有料)機能と位置付けている。一方でSpendLogsを保持するテーブル自体はPrisma/PostgreSQLの素のテーブルで`request_tags`という列を持つと説明されており、Admin UIを経由せずSQLで直接見る、またはGrafanaのPostgresデータソースとして繋ぐなら、無料版のままでもハーネス別(x-litellm-tagsヘッダーで各ハーネスがタグを付ければよい)の内訳が作れる、というのがドキュメントから素直に導ける読み方(一次スキーマ未到達につき[unverified]として扱う)。この持ち主は既にGrafanaを運用しているため、この経路は既存資産の延長として筋がよい。

**機械別内訳は、公式の「per-instance」表示機能としては存在しない。** 実地で見つかった2つの実践例(tkuennen, BaankeyBihari、いずれも★0)は共通して「機械/デバイスごとに仮想キーを1本発行し、UserまたはKey別のSpendビューで代用する」という回避策を採っている——これがそのまま「機械別内訳」の実地の型になる。

**(B) 中央LiteLLM案は、集約の単純さと引き換えに前回裁定を覆す。** 「1つのインスタンスしかないから合算不要」という点で要件そのものは満たすが、2026-09-23裁定が「LiteLLMを外に出す」設計を一度明示的に却下した理由(実地に二重認証の前例ゼロ、LiteLLM自体のSecurity Advisories 14件)は今回の調査でも覆っていない。さらに今回新たに分かった点として、現行構成(機械ごとに1本)ではLinux機のmain/complexティアはMacの状態と無関係にDeepSeekへ直接届くが、中央集約するとMacが落ちた瞬間に全ティアがLinux機から消える——現行より可用性が悪化する具体的な変化として記録しておく。

**(C) Langfuseなど外部callbackは、動くが新しい常駐サービスを増やす。** LiteLLM公式が組み込みのLangfuse callbackを持つため技術的には最も手数が少ないが、この持ち主が既に運用しているPrometheus/Grafanaを迂回して別の集約先を新設することになり、「1箇所」を増やすのではなく「もう1箇所」作る形になる。

---

## 前例なし・未検証(明示リスト)

- Mac+Arch Linuxデスクトップの物理2台が常時同時稼働してLiteLLMの共有Postgresを運用している公開リポジトリ — 見つかった2件(tkuennen, BaankeyBihari)はいずれも同一ホスト内の複数プロセスまたは単一デプロイ先の切替であり、該当しない
- LiteLLM単体(1コンテナ、Mac常駐)でのPostgres接続レイテンシ実測 — 公式ベンチマークはエンタープライズ集約規模のみ
- LITELLM_SALT_KEYを揃えなかった場合の具体的な失敗モード — 公式docsは「揃えよ」とだけ述べる
- LiteLLM_SpendLogsテーブルの完全なスキーマの一次ソース(BerriAI/litellm本体のschema.prisma) — 到達せず、WebSearch要約のみ
- emerzon/litellm#34の報告の信頼性 — フォーク上の★0リポジトリへの投稿で、自動生成/bug-bounty起源の疑いが強い。採用せず
- Langfuse側で複数LiteLLMインスタンスのコストを集約した際の、機械別/ハーネス別フィルタの実際の使い勝手

---

## 推奨(この調査から導ける最有力線)

1. **(A)を採る**: Mac上にPostgres(+Redis)コンテナを1つ追加し、各機械の`config.yaml`に同一`DATABASE_URL`(tailnet越し)と`LITELLM_MASTER_KEY`・新規`LITELLM_SALT_KEY`を揃える。
2. **機械別内訳は仮想キー**: 機械ごとに1本の仮想キー(`/key/generate`)を発行し、UIのKey/User別Spendビューで代用する(tkuennen/BaankeyBihariと同じ型)。
3. **ハーネス別内訳はタグ+自前クエリ**: 各ハーネスが`x-litellm-tags`ヘッダーでハーネス名を送り、Admin UI(Enterprise限定)を経由せず、既存のGrafanaにPostgresデータソースを足してSpendLogsテーブルを直接クエリする(一次スキーマ未確認のため導入前に`\d "LiteLLM_SpendLogs"`で列を実地確認する必要がある)。
4. **spend logの0.7%前後の欠損は許容するか、`allowed_fails`/バッチ間隔を短くして緩和する**——完全な精度を求めるなら未マージPR #33878の動向を追う。
5. (B)は再却下、(C)は今回は採らない(Grafana資産の二重化を避ける)。
