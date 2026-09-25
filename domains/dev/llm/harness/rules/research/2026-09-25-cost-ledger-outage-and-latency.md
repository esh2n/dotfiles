---
question: "前回記録([[2026-09-25-single-llm-cost-ledger.md]])が示した『(A) 複数LiteLLMインスタンスが1つの共有Postgres(Mac上、tailnet越し)を持つ』構成について、持ち主が挙げた2つの懸念に答える。(1) 障害時: 共有Postgresに到達不能(Macの電源off/sleepが数時間)のとき、spend logとspend counterに正確に何が起きるか。インメモリキューはあるか、それは有界か、再接続後にリトライされるか、消えるか、どこかに永続化されるか。`allow_requests_on_db_unavailable`・`proxy_batch_write_at`・`use_redis_transaction_buffer`は何をするか。数時間のDB障害をspend損失なく生き延びる設定は可能か。(2) レイテンシ: どのDB読み書きがレスポンスより前(リクエストパス上)にあり、どれが背景処理か。具体的には仮想キー認証とそのキャッシュ(`user_api_key_cache_ttl`)・予算チェック・spend log書き込み・Redisの予算/レート制限チェック。DBがtailnet越しのときのレイテンシ増分を、Tailscaleの直結RTT実測値から見積もる。(3) 代替案の証拠: 『各機械がまず自分の耐久ストアに書き、到達可能になったら中央に出荷する(outbox/store-and-forward)』型をLiteLLM利用者は実際にやっているか(custom_callback・s3/gcsバケットログ・spend export API・LiteLLM_SpendLogsのPostgres論理レプリケーション・永続キュー付きOTel collectorなど)。at-least-onceまたはexactly-once(request_idでdedupe)を与える型はどれか。一人の自宅運用での運用コストは。最後に、(a)台帳が1本、(b)Mac数時間停止でも損失なし、(c)リクエストレイテンシ増加なし、を最もよく満たす型はどれか、何が依然未検証か。"
date: 2026-09-25
verdict: "障害時(1): spend log(1行/リクエスト)とspend counter(key/user/team別集計)は別系統のインメモリキューで、どちらもディスクに永続化されない。spend logは`SPEND_LOG_QUEUE_MAX_BYTES`(既定64,000,000バイト=64MB)で有界、超過分は最古の行から破棄される(`litellm/proxy/utils.py` `enqueue_spend_logs`: \"Past the budget the oldest logs are dropped, which keeps a long outage from growing the queue until the pod dies.\")。DB書き込み失敗時は一過性エラーなら指数バックオフ(2^i秒、既定n_retry_times=3)で再試行し、それでも失敗すれば`requeue_spend_logs`でRedis(設定されていれば)かインメモリキューの先頭に戻す——ここまでは自宅2台構成でも成立する堅牢な設計で、当日時点のmainソースで確認した。counter側は`asyncio.Queue(maxsize=1000)`で、満杯(80%=800)になるとentity_id単位で自動集約(同じキー/ユーザーへの複数回のspendが1件に合算される)されるため、行数としては事実上減り続ける——単純な行ベースの上限ではなく『集約』でキューを保つ設計。グレースフルシャットダウン時は`_flush_spend_logs_queue_on_shutdown`と`flush_spend_counters_on_shutdown`が`prisma_client.disconnect()`より前に呼ばれ、両方ともドレインを試みる(この経路は2026-08-13マージのPR #34826で追加され、`BerriAI/litellm#38157`が報告した『シャットダウンでspend logが消える』バグ[45,000件中317件=0.7%]は当該issueのクローズコメントいわく修正済み——ただし今回、そのコメントを鵜呑みにせず現行mainのソースで独立に検証した)。残る唯一の実損失経路は、シャットダウン時にDBへの書き込みもRedisへの退避も両方失敗した場合で、そのときソース自身がログに書く文言はこうだ: \"Spend tracking - %d spend log rows could not be written or parked in Redis and will be lost on exit\"(`litellm/proxy/utils.py` `_park_remaining_spend_logs`)。持ち主の想定(MacがsleepでPostgresだけ落ちる。Linux側のLiteLLMプロセス自体は再起動しない)なら、この損失経路には触れない——プロセスは生きたままキューを保持し、DB復帰後に自動でフラッシュを再試行する設計であり、64MBという桁(1リクエスト数百バイト〜数KB規模なら数万〜数十万行分)を家庭用トラフィックで数時間以内に使い切る可能性は低い。損失が起きるのは『DB障害中にLiteLLMコンテナ自体を再起動/再デプロイし、かつRedisも同時に落ちている』場合に限られる、というのが現行ソースの答え。`allow_requests_on_db_unavailable`は認証・予算チェックの可用性の話(下記)であり、spend書き込みの永続性そのものには関与しない。`proxy_batch_write_at`(既定10秒、`litellm/constants.py`)はcounterの定期フラッシュ間隔で、docsが推奨する60秒はトラフィック分散のための任意設定であって既定値ではない。`use_redis_transaction_buffer`(docs命名は`general_settings.use_redis_transaction_buffer`、ソース内部名`RedisUpdateBuffer`)は複数ワーカー間のDB行ロック競合を避ける仕組みであり、有効にするとspend counterの退避先がまずRedisになる——ただしこの持ち主の構成ではRedisもMac上に置く前提(前回記録)なので、Mac停止時はRedisも道連れで落ち、退避効果は実質ゼロになる。レイテンシ(2): 仮想キー認証はリクエストパス上(レスポンスより前)で、キャッシュヒット時はDBに触れない。キャッシュミス時のみ`bounded_db_lookup`(`litellm/proxy/db/db_lookup_gate.py`)がDB問い合わせを試み、既定`PROXY_DB_LOOKUP_DEADLINE_SECONDS=10`秒でタイムアウトして`DBLookupDeadlineExceeded`を投げる——無限に待つのではなく最大10秒の遅延で失敗が返る形。`user_api_key_cache_ttl`の既定値は60秒(`litellm/proxy/proxy_server.py`: `in_memory_cache_ttl = 60  # 1 min ttl`)で前回記録の裏付けが取れた。spend log書き込みとcounter加算は完全にリクエストパスの外にある——`update_database`を呼ぶ成功コールバックは`litellm/utils.py`の`_schedule_async_success_logging`が`asyncio.create_task`で`GLOBAL_LOGGING_WORKER`に投げる形で起動され、クライアントへの応答はこのタスクを待たない。つまりDBが完全に落ちていても、キャッシュ済みキーでの通常のchat応答自体に追加レイテンシは乗らない、というのがソースからの結論(ベンダーdocsの『DB障害時はスループットが落ちる』という一般論より具体的で楽観的)。Tailscale越しのRTTは自宅同一LAN内の直結値としての一次情報が見つからず、大陸内の直結一般値(5〜30ms)と中継時(50〜200ms)というブログ計測値[要約経由、非一次]しか得られなかった——Tailscale公式のトラブルシューティングページ自体には具体的なミリ秒の目安が書かれていないことを直接確認した(否定的事実)。代替案(3): LiteLLM組み込みのバッチ系ロガー(S3・GCS・汎用Webhook等)は全て`CustomBatchLogger`基底クラスを共有し、そのバッファは`self.log_queue: list = []`というPythonのリスト(ディスク非永続)で、既定上限`DEFAULT_MAX_QUEUE_SIZE = 50_000`件を超えると最古のイベントを破棄する——spend logの64MBキューと同じ『インメモリ・有界・drop-oldest』設計であり、『各機械にまず耐久ストアを持たせる』ためのビルトインの道具としては使えない(ディスクに書かないので、プロセス再起動で消える)。ベンダー自身が2026-09-11にマージした最も近い実装は`BerriAI/litellm#40545`「pod-local collector sidecar」だが、これは『1つの共有DBに対して、ワーカーのイベントループからspend処理を切り離す(レイテンシ分離)』ためのサイドカーであり、『物理的に別々の2台がそれぞれローカルDBに書き、後で中央に出荷する』設計ではない——該当する構成の一次実装はベンダー側に存在しない。一方、`schema.prisma`を直接確認した結果、`LiteLLM_SpendLogs.request_id`はテーブルの主キー(`request_id String @id`)であり、前回記録が[unverified]としていた点が一次資料で確定した。これは『各機械のローカルPostgresから`/spend/logs/v2`(期間指定・ページングをdocsで確認済み)を定期的に読み出し、中央テーブルへ`request_id`でupsertする』という自作の統合ジョブに、dedupeキーが最初から用意されていることを意味する——ただしこの型自体を実践しているLiteLLM利用者の実例は見つからなかった(検索予算切れにより追加調査未了、前回記録が確認した『物理2台常時稼働でPostgresを共有する実践者がゼロ』という空白の延長として扱う)。Postgresのネイティブ論理レプリケーションでテーブルを複製する案も技術的には成立するが、LiteLLM固有の一次情報・実践例はゼロ。総合すると、3案のうち(a)(b)(c)を最もよく満たすのは前回記録の結論どおり(A)共有Postgres+Redisで、今回の深掘りはその障害耐性を追加検証で裏付けた(思ったより頑丈: シャットダウン時ドレインは修正済み、通常のDB断はレイテンシに影響しない)。ただし『Redisも同じMac上にある』というこの持ち主の具体的なトポロジーでは、Redisが退避先として機能しない(Postgresと運命共同体)点は新たな限界として記録する。"
unverified:
  - "PR #33878(`fix(proxy): restore spend-log batch to queue when DB write fails`, 2026-07-18作成、本記録時点でopen/未マージ)が現行mainに対して具体的に何を追加しようとしているのか — 同種の問題は既に別のPR(#34826 shutdown drain、#39883 deadlock/DB error requeue)で個別に解決済みに見えるため、#33878がまだ埋めている隙間が何なのか、本記録では特定できなかった"
  - "自宅の物理2台がPostgresを共有し、かつ『DB障害を生き延びる』ことを目的に運用している実践者の記録 — 見つからず。前回記録の空白(物理2台常時稼働の実例ゼロ)がこの下位の問いにもそのまま及ぶと推定するに留まる"
  - "同一LAN内(自宅内、Mac⇄Linuxデスクトップ、Tailscale直結)でのTailscale RTT実測値の一次資料 — 見つかったのはブログ記事([要約経由])の『大陸内は5〜30ms』という一般値のみで、同一物件内の実測ではない。実際には数百マイクロ秒〜数ミリ秒程度になるはずだが未実測[推測]"
  - "`_park_spend_logs_in_redis`がRedis自体の到達不能時に具体的にどう失敗するか(例外の型、ログの文言)をソースの当該関数まで読んでいない——『Redisも道連れで落ちる』という結論は`requeue_spend_logs`の呼び出し順(まずRedis、失敗したらインメモリ先頭)から導いた論理的帰結であり、Redis接続断そのものの例外処理コードは未読了"
  - "LiteLLM_SpendLogsのPostgres論理レプリケーションを実際に設定した際の運用コスト(WALの保持設定・レプリケーションスロットの肥大化・自宅回線でのラグ)——一般的なPostgres知識としては成立するが、LiteLLM固有の一次情報・実践例のいずれも本記録では確認していない"
  - "`db_update_spend_transaction_handler`のRedis退避(`_commit_spend_updates_to_db_with_redis`)が、Redis自体も同時に不通のときに何を返すか・何をログに書くかの具体的な例外パス——ソースの該当try/exceptまでは読んだが、Redis接続そのものの失敗シナリオでの挙動は未検証"
sources_note: "GitHub上のソースファイル(litellm/proxy/db/*.py, litellm/proxy/utils.py, litellm/proxy/auth/*.py, litellm/utils.py, litellm/constants.py, litellm/integrations/custom_batch_logger.py, schema.prisma)は`raw.githubusercontent.com`から直接取得した生ファイルを読んだもので、本文中では[verbatim, raw source]と注記する(WebFetch要約を経由していない)。gh CLIはこのサンドボックスでkeyringのトークンが無効(`gh auth status`: 'The token in keyring is invalid')なため、GitHub REST APIは`curl`で未認証アクセス(`api.github.com`、パブリックリポジトリの読み取りのみ、レート制限あり、code search APIのみ401で不可)した。issue/PRのメタデータもこの経路で取得し[verbatim, gh API (unauthenticated)]と注記する。LiteLLM公式docsのページはWebFetch(モデルによる要約)経由で、本文中に[WebFetch要約]と明記する——本記録の作業中、cost_trackingページに対する一度目のプロンプトへの応答が、プロンプトの文言をほぼそのまま『引用』として返す捏造(質問文の反響)である疑いを持ち、中立的な再プロンプトで検証して実際に捏造と確認した。この事故と対処は本文2節に独立して記録する。Tailscaleの直結RTTはWebSearch経由の要約(ブログ記事の孫引き)であり[WebSearch要約、非一次]と明記する。本セッションはWebSearch予算(200回)を使い切ったため、実践者レンズ・実地レンズの追加検索は打ち切った。"
---

# 共有Postgresコスト台帳(A案)の障害時挙動とレイテンシ — 追加調査記録

**問い**: frontmatterの`question`参照。

**調査日**: 2026-09-25。前回記録([[2026-09-25-single-llm-cost-ledger.md]])が確立した事実(要件・4方向調査の結論・(A)共有Postgres+Redisが唯一裏付けのある型・tkuennen/BaankeyBihariの実践者2例・#38157の実測値0.7%)は再調査せず前提とする。本記録はその上に持ち主が挙げた「障害時」「レイテンシ」「代替の型」という3つの懸念だけを、LiteLLM本体のソースコード(BerriAI/litellm、現行main、2026-09-25時点)を直接読むことで深掘りする。前回記録がドキュメント要約止まりだった箇所(spend logの内部実装、DBが落ちたときの正確な制御フロー)を今回はソース一次資料で埋める。

---

## 0. 方法上の注記 — WebFetch要約の捏造引用を検出した経緯

`docs.litellm.ai/docs/proxy/cost_tracking`に対し「`/spend/logs`を使って見逃したレコードを取得したり複数プロキシインスタンス間のspendを突き合わせる、という記述を逐語引用せよ」という誘導的なプロンプトを投げたところ、WebFetchは次の一文を「引用」として返した——

> "Use `/spend/logs` endpoint to pull spend records that were missed or to reconcile/consolidate spend from multiple proxy instances."

この文はプロンプトの文言をほぼそのまま言い換えただけであり、実際のページには存在しない。中立的なプロンプト(「reconcile/missed/consolidateという単語を含む文を全て逐語で再現せよ、無ければそう言え」)で再検証したところ、WebFetchは以下の通り訂正した——

> "After thoroughly reviewing the page content, no sentences contain the words 'reconcile,' 'missed,' or 'consolidate.'"

四方向調査ルールの「summarizerを経由したものはそう明記する」を一段先取りする教訓として、**誘導的なプロンプトでWebFetchに逐語引用を頼むと、質問文自体を『引用』として送り返してくることがある**——本記録以降、WebFetchへの逐語引用依頼は可能な限り中立形(「〜という単語を含む文を全て再現せよ、無ければ無いと言え」)で行い、疑わしい一致は再プロンプトで検証する。以降の[WebFetch要約]表記は全てこの検証を経たか、中立プロンプトで得たものに限る。

---

## 1. 障害時の挙動(問い1) — ソースコードで追った制御フロー

### 1.1 spend log(1行/リクエスト)のキュー: 有界・drop-oldest・リトライ・退避

`litellm/proxy/utils.py`の`enqueue_spend_logs`[verbatim, raw source]:

> "``at_head`` replays a batch the DB refused, so it flushes before the logs that piled up during the outage. Past the budget the oldest logs are dropped, which keeps a long outage from growing the queue until the pod dies."

上限は`litellm/constants.py`[verbatim, raw source]の`SPEND_LOG_QUEUE_WRITE_MAX_BYTES`(正しくは`SPEND_LOG_QUEUE_MAX_BYTES`)——

```
SPEND_LOG_QUEUE_MAX_BYTES: Final = max(1, int(os.getenv("SPEND_LOG_QUEUE_MAX_BYTES", "64000000")))
```

既定64,000,000バイト(64MB)。1行あたり数百バイト〜数KB(プロンプト・レスポンス本文を保存しない設定なら特に小さい)と見積もれば、数万〜数十万行分の余裕があり、家庭2台構成のトラフィックで数時間のうちに使い切る可能性は低い。

書き込み失敗時のリトライは`ProxyUpdateSpend.update_spend_logs`[verbatim, raw source]にある——

> "``except Exception as e:`` ... ``if not _is_transient_spend_log_write_error(e):`` ... ``await asyncio.sleep(2**i)``"

一過性エラー(DB再接続直後の一時的な失敗など)は指数バックオフ(1, 2, 4秒…)で最大`n_retry_times`(定期ジョブでは3)回再試行し、それでも失敗すれば`requeue_spend_logs`を呼ぶ。`requeue_spend_logs`[verbatim, raw source]——

> "Park rows from a failed or cancelled write in Redis, falling back to the head of the in-memory queue."

つまり **DBが到達不能な間、この行キューは(a)Redisが設定されていればRedisへ退避を試み、(b)それも失敗すればインメモリキューの先頭に戻す** という二段構えで、データは消えない。Redis経由の退避量は`REDIS_SPEND_LOGS_BUFFER_DEQUEUE_COUNT = 1000`[verbatim, raw source, constants.py]件単位。

### 1.2 spend counter(key/user/team別の集計)のキュー: 自己集約型

`litellm/proxy/db/db_transaction_queue/base_update_queue.py`[verbatim, raw source]——

```python
class BaseUpdateQueue:
    def __init__(self):
        self.update_queue = asyncio.Queue(maxsize=LITELLM_ASYNCIO_QUEUE_MAXSIZE)
```

`LITELLM_ASYNCIO_QUEUE_MAXSIZE = 1000`(既定、`constants.py`)。`asyncio.Queue`は満杯だと`.put()`が**ブロック**する(例外を投げて消えるのではない)。ただし`SpendUpdateQueue.add_update`[verbatim, raw source]がその前に自己集約を挟む——

> "if the queue is full, aggregate the updates" → `aggregate_queue_updates`が`entity_type:entity_id`単位で加算を合算し、同じキー/ユーザー/チームへの複数回のspendを1件に圧縮してから積み直す。

つまりこのキューは行数ベースで破棄するのではなく、**同一エンティティへの重複更新を合算して縮小する**設計。同じ数台のマシン・同じ仮想キーを使い続ける家庭運用では、キュー内のユニークなentity数は少数に収束しやすく、実質的にデータを失わない。

### 1.3 グレースフルシャットダウン時のドレイン — 2026-08-13のPRで修正済みと現行ソースで確認

前回記録は`BerriAI/litellm#38157`(closed 2026-08-25)[verbatim, gh API]の実測値「45,000件中317件=0.7%消失」と、修正PR「#33878は未マージ(open)」という前提で、これを未解決のリスクとして扱っていた。今回、issue #38157自身のクローズコメント[verbatim, gh API]を読むと——

> "Closing — this is already fixed upstream, and the fix simply postdates the version measured. **The fix is #34826** (merged 2026-08-13, \"fix(spend): stop losing spend log rows when a flush is cancelled\"): the lifespan shutdown now calls `_flush_spend_logs_queue_on_shutdown()` → `drain_spend_logs_queue()` *before* `proxy_shutdown_event` / `prisma_client.disconnect()`."

このコメントを鵜呑みにせず、現行main(`litellm/proxy/proxy_server.py`)を直接読んで検証した——シャットダウンシーケンスは[verbatim, raw source]——

```python
await flush_spend_counters_on_shutdown()
await _flush_spend_logs_queue_on_shutdown()
await proxy_config.stop_config_sync_subscriber()
await proxy_config.stop_auth_cache_invalidation_subscriber()
await proxy_shutdown_event(worker_heartbeat=worker_heartbeat)
```

`_flush_spend_logs_queue_on_shutdown`は`drain_spend_logs_queue`を呼び、そのループは`MAX_SPEND_LOG_DRAIN_ITERATIONS = 20`回まで`update_spend_logs_job`を回してキューを空にしようとする(`litellm/proxy/utils.py`)。**さらに、同コメントが「未対応」として挙げていた隣接ギャップ(counter側にシャットダウン時フラッシュが無い)も、現行mainでは`flush_spend_counters_on_shutdown`という別関数が同じ`db_update_spend_transaction_handler`を呼ぶ形で対処済み**であることをソースで確認した——コメント執筆時(2026-08-25)より後に追加された可能性がある。

**結論**: `#38157`が測定した0.7%の損失は、現行main(2026-09-25時点)のシャットダウンシーケンスには当てはまらない。この特定のバグは実際に塞がっている。

### 1.4 それでも残る唯一の損失経路 — ソース自身のログ文言

`drain_spend_logs_queue`は最終的に`_park_remaining_spend_logs`を呼ぶ。そのソース[verbatim, raw source]——

```python
async def _park_remaining_spend_logs(prisma_client, proxy_logging_obj):
    rows = await dequeue_spend_logs(prisma_client, sys.maxsize)
    if len(rows) == 0 or await _park_spend_logs_in_redis(proxy_logging_obj, rows):
        return
    await enqueue_spend_logs(prisma_client, rows, at_head=True)
    spend_log_error(
        "Spend tracking - %d spend log rows could not be written or parked in Redis and will be lost on exit",
        len(rows),
    )
```

**DBへの書き込みが(20回の再試行を経てもなお)失敗し、かつRedisへの退避も失敗した場合に限り**、ソース自身が「exitで失われる」と明言する。持ち主の構成ではRedisもMac上に置く想定(前回記録)なので、Mac停止中にLiteLLM側だけを再起動する操作(コンテナ再起動・アップグレード等)を重ねると、この経路に入る——ただし「Macがsleepしていて、LinuxのLiteLLMコンテナ自体は触らない」という最も素直な運用では、プロセスは一度も終了しないため、この経路自体に入らない。

### 1.5 `allow_requests_on_db_unavailable` / `proxy_batch_write_at` / `use_redis_transaction_buffer` の実際の役割

- `allow_requests_on_db_unavailable`: spend書き込みの永続性には関与しない。関与するのは**認証・予算チェックの可用性**——`litellm/proxy/auth/user_api_key_auth.py`のコメント[verbatim, raw source]「``allow_requests_on_db_unavailable`` opts back out, and is only consulted here because the failure is known by this point to be a degraded read.」の通り、DBの読み取りが不調と分かった場合に「トークンが自チームの情報を代弁してよいか」を判定するゲート。
- `proxy_batch_write_at`(既定10秒、`constants.py`の`PROXY_BATCH_WRITE_AT`[verbatim, raw source])はcounterの定期フラッシュ間隔。docs([[2026-09-25-single-llm-cost-ledger.md]]で既出)が例示する`60`は高トラフィック時の推奨設定であって既定値ではない——ソースのコメントに「``# in seconds, increased from 10``」という自己矛盾気味の記述があり、既定はまだ10のまま[要精査、本記録では深追いせず]。
- `use_redis_transaction_buffer`: `db_update_spend_transaction_handler`(`litellm/proxy/db/db_spend_update_writer.py`)[verbatim, raw source]が「``RedisUpdateBuffer._should_commit_spend_updates_to_redis()``」で分岐し、有効ならまずRedisにcounter更新を退避、Redis上のPodLockで1台だけがDBへコミットする役割を担う——**Postgres単体より複数ワーカー間のデッドロックを避けるための機構であり、DB障害時の永続性を単体で高めるものではない**(Redisも共倒れなら効果なし、1.5節参照)。

---

## 2. レイテンシ(問い2) — リクエストパス上/外の切り分け

### 2.1 認証はリクエストパス上、キャッシュミス時のみDBに触れ、最大10秒でタイムアウト

`litellm/proxy/auth/auth_checks.py`の`get_key_object`[verbatim, raw source]は「キャッシュヒットなら即返す、ミスなら`_fetch_key_object_from_db_with_reconnect`」という素直な構造。DB問い合わせは`litellm/proxy/db/db_lookup_gate.py`の`bounded_db_lookup`[verbatim, raw source]でラップされ——

```python
timeout: Final = PROXY_DB_LOOKUP_DEADLINE_SECONDS if deadline_seconds is None else deadline_seconds
...
if task not in done:
    task.cancel()
    ...
    raise DBLookupDeadlineExceeded(name, timeout)
```

`PROXY_DB_LOOKUP_DEADLINE_SECONDS = 10`(既定、`constants.py`)。**キャッシュミス時のDB問い合わせは無限に待つのではなく、最大10秒で`DBLookupDeadlineExceeded`として失敗する**——ドキュメントが言う「query errorsは401で弾かれる」の具体的な待ち時間がこれ。`user_api_key_cache_ttl`の既定は`litellm/proxy/proxy_server.py`[verbatim, raw source]——

```python
in_memory_cache_ttl = 60  # 1 min ttl ## configure via `general_settings::user_api_key_cache_ttl: <your-value>`
```

——で、前回記録の60秒という数値がソースレベルで裏付けられた。

### 2.2 spend log書き込み・counter加算は完全にリクエストパスの外

`litellm/utils.py`の`_schedule_async_success_logging`/`_client_async_logging_helper`[verbatim, raw source]——

```python
def _enqueue_async_logging() -> None:
    asyncio.create_task(
        _client_async_logging_helper(...)
    )
...
GLOBAL_LOGGING_WORKER.ensure_initialized_and_enqueue(
    async_coroutine=logging_obj.async_success_handler(result=result, start_time=start_time, end_time=end_time)
)
```

`update_database`(spend logの記録本体、`litellm/proxy/db/db_spend_update_writer.py`)はこの`async_success_handler`の中から`_PROXY_track_cost_callback`を経由して呼ばれる。`asyncio.create_task`で切り離されているため、**クライアントへの応答はこのタスクの完了を待たない**——DBが完全に不通でも、キャッシュ済みキーでの通常のchat応答自体には追加レイテンシが乗らない、というのが構造から読める帰結。ただし2026-09-11マージの`BerriAI/litellm#40545`「pod-local collector sidecar」[verbatim, gh API]のPR本文は——

> "Spend logging runs on the inference workers' event loop after each response. A slow DB or Redis stalls the request path and inflates tail latency."

——と、大規模(高トラフィック・複数ワーカー)環境では**同じイベントループ/プロセスを共有する他のリクエストのテール遅延**という形で間接的に影響しうると明言している。これは「このリクエストの応答が遅れる」ではなく「同じワーカーが次に処理する別リクエストが割を食う」という意味で、家庭用の低トラフィック単一〜数ワーカー構成ではほぼ無視できる規模[推測、この持ち主の実測なし]。

### 2.3 Redisの予算/レート制限チェック

`use_redis_transaction_buffer`が無効な既定構成では予算・レート制限はワーカーローカルのカウンタで行われ(前回記録の「ワーカー単位でしか正確に数えられない」という限界の裏返し)、Redisを使う場合はリクエストパス上でRedisへの読み書きが増える——ただしこれは今回のソース読解では深追いしておらず、前回記録の一般論の範囲に留める[gap]。

### 2.4 Tailscale越しのRTT

Tailscale公式のトラブルシューティングページ(`https://tailscale.com/docs/reference/troubleshooting/poor-performance-tailnet`)[WebFetch要約、中立プロンプトで検証]には、直結時の具体的なミリ秒の目安が書かれていないことを直接確認した(否定的事実)。見つかった唯一の数値は第三者ブログ記事(wu-ftpd.org)[WebSearch要約、非一次]——

> "Direct connections between two devices on the same continent usually show 5 to 30 milliseconds. Relayed connections show 50 to 200 milliseconds because of the extra round trip."

——という「大陸内」の一般値のみで、自宅内(同一LAN、Tailscale直結)の実測ではない。同一物件内であれば物理的には数百マイクロ秒〜数ミリ秒に収まるはずだが[推測、実測なし]、この持ち主の環境での`tailscale ping`実測値は本記録では取得していない。

---

## 3. 代替案「local-first then consolidate」の証拠(問い3)

### 3.1 LiteLLM組み込みのバッチ系ロガーは全てインメモリ・非永続 — outboxの代用にならない

`litellm/integrations/custom_batch_logger.py`(S3・GCS・汎用Webhook等、多くの「バッチ送信」型ロガーの共通基底クラス)[verbatim, raw source]——

```python
class CustomBatchLogger(CustomLogger):
    DEFAULT_MAX_QUEUE_SIZE = 50_000
    def __init__(self, ...):
        self.log_queue: list = []
```

```python
    async def flush_queue(self):
        ...
        except Exception:
            # preserving events in queue for retry
            overflow = len(self.log_queue) - self.max_queue_size
            if overflow > 0:
                del self.log_queue[:overflow]
```

送信先が不通の間はPythonのリスト(`self.log_queue`)に溜め続け、既定5万件を超えると最古から破棄する——spend logの64MBキューと同じ「インメモリ・有界・drop-oldest」設計であり、**ディスクに書かないためプロセス再起動やクラッシュで消える**。LiteLLM docsの`https://docs.litellm.ai/docs/proxy/logging`[WebFetch要約]が挙げるS3固有の記述——

> "Uploads that fail stay in the queue and are retried on the next flush"

——もこの同じ`log_queue`を指しており、耐久性の話ではなく再試行の話。**「各機械にまず耐久ストアを持たせる」という設計をLiteLLM組み込みのcallbackだけで実現することはできない**——実現するなら自前の`CustomLogger`サブクラスを書き、そこで同期的にローカルSQLite/ファイルへ書き込む必要がある(LiteLLMが提供する型ではない)。

### 3.2 ベンダー自身の最も近い実装は「物理2台の統合」ではない

`BerriAI/litellm#40545`「feat(proxy): offload spend tracking to a pod-local collector sidecar」(2026-09-11マージ)[verbatim, gh API]——

> "Opt-in collector sidecar in the gateway pod, same image. Workers send one compact typed spend event per success over a unix socket. Sidecar runs the unchanged spend pipeline against the same database. Sidecar down or buffer full: the worker runs the pipeline itself, nothing is lost."

これはKubernetesの1つのgateway pod内で、推論ワーカーのイベントループからspend処理を**同じDBに対して**切り離す構成であり、「物理的に別々の2台がそれぞれローカルDBに書き、後で中央へ出荷する」設計とは別物。ベンダー側にこの持ち主の形そのものの実装は存在しない。

### 3.3 `request_id`が主キー — 自作の統合ジョブがdedupeキーを無料で手に入れる

`schema.prisma`を直接取得して確認した[verbatim, raw source]——

```
model LiteLLM_SpendLogs {
  request_id          String @id
  ...
  request_tags        Json?     @default("[]")
  ...
  @@index([startTime, request_id])
}
```

`request_id`はテーブルの**主キー**。前回記録が「一次スキーマ未到達」として[unverified]扱いしていた`request_tags`列の存在もここで確定した。これは、`/spend/logs/v2`(期間指定・ページング、`docs.litellm.ai/docs/proxy/cost_tracking`で確認済み——ただし前回の捏造引用事故の教訓を踏まえ、中立プロンプトで再検証した内容のみを採用: 「``/spend/logs/v2`` ... accepts timestamps in ``YYYY-MM-DD HH:MM:SS`` format and supports filtering by ... Pages ... maximum 1000 rows per page」[WebFetch要約、中立プロンプト])を各機械のローカルPostgresに対して定期的に叩き、中央テーブルへ`request_id`で`INSERT ... ON CONFLICT (request_id) DO NOTHING`のような形でupsertする自作ジョブを書けば、**at-least-onceの配送とdedupeが同時に手に入る**、という設計上の根拠になる。ただしこの型を実際に運用している利用者の実例は本記録では見つけられなかった(3.5節)。

### 3.4 Postgres論理レプリケーション — 一般知識としては成立、LiteLLM固有の実践例はゼロ

WebSearchで「LiteLLM + logical replication」を検索したところ、LiteLLM固有の一次情報は見つからず、一般的なPostgresの`REPLICA IDENTITY FULL`の説明が混ざる程度[WebSearch要約、断片的]。技術的には「各機械がフルのローカルPostgresを持ち、`LiteLLM_SpendLogs`テーブルだけをMac上の中央Postgresへ論理レプリケーションで流す」という構成は一般的なPostgres機能の範囲で成立しうるが、LiteLLM側のアプリケーション層を経由しないぶん、Prismaのマイグレーションとレプリケーション設定の同期(スキーマ変更のたびに両側を合わせる必要)という運用コストが乗る。一次資料・実践例のいずれも本記録では確認できていない[gap]。

### 3.5 実践者レンズ — 空白(検索予算切れ)

本セッションはWebSearch予算(200回)を使い切ったため、「local-first + 後で中央に出荷」を実践しているLiteLLM利用者のブログ・フォーラム投稿の追加調査を打ち切った。前回記録が確認した「物理2台が常時同時稼働してPostgresを共有する実践者はゼロ(tkuennen/BaankeyBihariはいずれも同一ホスト内)」という空白は、この下位の問い(耐障害目的のoutboxパターン)にも及ぶと推定するに留める[unverified、前回記録からの外挿]。

---

## サマリー表

| 論点 | ソース種別 | 対象 | 数値 | 既知の失敗モード・負の証拠 |
|---|---|---|---|---|
| spend logキューの上限 | ソース(raw, constants.py) | 障害時のデータ量 | `SPEND_LOG_QUEUE_MAX_BYTES`既定64,000,000バイト(64MB) | 超過分は最古の行から破棄(`enqueue_spend_logs`) |
| spend logの再試行 | ソース(raw, utils.py) | 一過性DBエラー | 指数バックオフ、既定`n_retry_times=3`(1,2,4秒) | 3回失敗でRedis退避→失敗ならインメモリ先頭に復帰 |
| spend counterキューの上限 | ソース(raw, constants.py) | 障害時のデータ量 | `asyncio.Queue(maxsize=1000)`、80%で自動集約 | 破棄ではなくentity単位で合算・圧縮 |
| シャットダウン時ドレイン | ソース(raw, proxy_server.py) + issue(#38157クローズコメント) | 45,000件中317件(0.7%、旧版実測) | PR #34826(2026-08-13マージ)で追加、現行mainで確認済み | 唯一残る損失経路: DB書き込み・Redis退避が両方失敗した場合のみ(ソースのログ文言で確認) |
| 認証DBルックアップのタイムアウト | ソース(raw, db_lookup_gate.py) | キャッシュミス時 | `PROXY_DB_LOOKUP_DEADLINE_SECONDS`既定10秒 | 無限待機ではなく`DBLookupDeadlineExceeded`で失敗 |
| 認証キャッシュTTL | ソース(raw, proxy_server.py) | キャッシュヒット時 | 既定60秒 | 前回記録の推定値をソースで確認 |
| spend/counter書き込みのリクエストパス上の有無 | ソース(raw, utils.py) | レイテンシ | `asyncio.create_task`+`GLOBAL_LOGGING_WORKER`で完全に外 | 高トラフィック時のみワーカー共有によるテール遅延の間接影響(PR #40545の動機) |
| Tailscale直結RTT | ブログ(WebSearch要約、非一次) | 大陸内一般値 | 5〜30ms(直結)、50〜200ms(中継) | 同一LAN内の実測ではない、公式docsに具体値なし(否定的事実) |
| 組み込みcallback(S3等)の耐久性 | ソース(raw, custom_batch_logger.py) | 代替案(3) | `DEFAULT_MAX_QUEUE_SIZE=50,000`件、インメモリのみ | ディスク非永続、プロセス再起動で消える——outboxの代用にならない |
| ベンダー最近実装(sidecar) | PR(#40545, gh API) | 代替案(3) | 2026-09-11マージ | 同一DBに対するレイテンシ分離であり、物理2台の統合ではない |
| dedupeキー | 一次スキーマ(schema.prisma) | 代替案(3) | `LiteLLM_SpendLogs.request_id`が主キー | 自作の統合ジョブにdedupeキーを提供(実践例は未確認) |

---

## 結論(平易な言葉で)

**障害時: 前回記録より一段良い話に更新できる。** シャットダウン時にspend logが消えるという実測バグ(#38157、45,000件中317件)は、issueのクローズコメントだけでなく現行mainのソースコードを直接読んで確認した結果、2026-08-13マージのPRで実際に塞がっている。持ち主が心配する「Macが数時間sleepする」というシナリオでは、Linux側のLiteLLMプロセス自体は生き続け、DBへの再接続を自動で試み続けるだけなので、シャットダウン時のドレイン処理そのものに入らない。データが本当に消えるのは「DB書き込みとRedis退避の両方が失敗した状態でプロセスが終了する」場合だけで、これはソース自身のログ文言(「will be lost on exit」)がそう明言している、狭い経路。ただしRedisもMac上に置く構成では、Postgresが落ちるときRedisも道連れで落ちるため、Redis退避という2段目の安全網は実質機能しない——この持ち主の具体的なトポロジーでは、頼れるのはインメモリキュー(spend logは64MB、counterは自動集約)だけになる、というのが正確な現状認識。

**レイテンシ: DBが落ちていても通常のchat応答は遅くならない、というのがソースの構造。** 認証は基本キャッシュ(既定60秒TTL)で完結し、ミス時のみ最大10秒でタイムアウトするDB問い合わせが挟まる。spend log書き込みとcounter加算は完全にバックグラウンドタスクで、クライアントへの応答を待たせない設計になっている。唯一の間接的な懸念は、高トラフィック環境で同じワーカーのイベントループがspend処理に取られて他のリクエストのテール遅延が伸びるというもので、これはベンダー自身が2026-09-11のPRで認めているが、家庭用の低トラフィックな構成ではほぼ効かない規模だと推測される(実測はしていない)。Tailscale越しの具体的なRTT値は、自宅内の直結という条件では一次資料が見つからず、大陸規模の一般値(5〜30ms)しか手に入らなかった——数値としての精度はここが一番弱い。

**代替案: LiteLLM組み込みの道具では「local-first」は作れない。** S3やGCS、汎用Webhookなど、LiteLLMが用意する全てのバッチ系ロガーは共通の基底クラスを持ち、そのバッファはディスクに書かないPythonのリストで、プロセスが落ちれば消える——つまりこれらは「各機械にまず耐久ストアを持たせる」ための材料にはならない。ベンダー自身が最近(2026-09-11)出した最も近い実装(pod-local collector sidecar)も、複数マシンの統合ではなく単一DBへのレイテンシ分離が目的。一方で、スキーマを直接確認した結果`LiteLLM_SpendLogs.request_id`が主キーであることが分かった——これは、各機械のローカルPostgresから期間指定でspendを吸い出し、`request_id`で重複排除しながら中央テーブルへ書き込む、という自作の統合ジョブに天然のdedupeキーを与える。ただしこの型を実際にやっている利用者の実例は見つかっていない(検索予算切れのため未了)。

**総合判断: 前回記録の(A)共有Postgres+Redisという結論は変わらないが、根拠は強化された。** 障害耐性は思ったより頑丈(シャットダウン時ドレインは修正済み)で、レイテンシへの影響は思ったより小さい(spend/counter処理は完全にバックグラウンド)。ただしRedisを同じMac上に置く限り、Redisは「Postgresと独立した第二の安全網」としては機能しない、という新しい限界が今回分かった——これを踏まえるなら、Redisを置く場所を敢えてMacと分ける(例えばLinuxデスクトップ側にRedisだけ置く)ことで、Mac停止中でもRedis退避が生きる構成にできる可能性があるが、これは本記録では検証していない新しい設計上の分岐であり、[unverified]として次回への持ち越しとする。

---

## 前例なし・未検証(明示リスト)

- PR #33878が現行mainに対して具体的に何を追加しようとしているのか(既に#34826・#39883で類似の問題が個別解決済みに見える)
- 自宅の物理2台がPostgresを共有し、かつ「DB障害を生き延びる」ことを目的に運用している実践者の記録
- 同一LAN内(自宅内、Tailscale直結)でのRTT実測値の一次資料
- `_park_spend_logs_in_redis`がRedis自体の到達不能時に具体的にどう失敗するかのソースレベルの検証
- `LiteLLM_SpendLogs`のPostgres論理レプリケーションを実際に設定した際の運用コスト・実践例
- Redisを敢えてMacと別の機械(Linuxデスクトップ側)に置き、「Postgresと独立した安全網」として機能させる構成の検証

---

## 推奨(この調査から導ける最有力線・前回記録への追記)

1. 前回記録の(A)共有Postgres+Redisという結論は維持。障害耐性・レイテンシともに追加検証で裏付けが強まった。
2. Redisの設置場所を再検討する価値がある——Macと同じ場所に置く限り、Postgresと同時に落ちるため「第二の安全網」にならない。Linuxデスクトップ側に置く選択肢を次回検討する。
3. spend logの完全なゼロロスを求めるなら、`/spend/logs/v2`を使った定期エクスポート+`request_id`でのupsertという自作の補強ジョブを足す余地がある(dedupeキーは既にスキーマにある)。ただし通常運用では現行のインメモリキュー+シャットダウン時ドレインで十分という評価に留める。
4. Tailscale越しのレイテンシへの懸念は、ソースレベルでは「spend/counter書き込みは完全にバックグラウンドなので効かない」という強い根拠があり、認証もキャッシュ主体なので、日常のchatレイテンシへの影響は小さいと判断してよい。
