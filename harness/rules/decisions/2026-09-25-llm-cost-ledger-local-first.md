# LiteLLMを通るAI利用コストは一冊の台帳で持つ: 各機械は手元のPostgresに書き、observerの機械の台帳へあとから送る

Status: accepted — 持ち主の裁定（2026-09-25）。要件: AIの利用コストを一か所で管理する（機械ごとのLiteLLMをGrafanaで足すだけでは足りない）。範囲はLiteLLMを通る分だけ（Claude Code・Codexの直接利用は、いまは対象外）。共有DBに直接書く案には、機械が止まっているときの書き込みと再送、書き込みの遅延の問題があり、ソースまで読んだ調査の後、手元に書いてあとから送る形を採った。`2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`の「LiteLLMは各機械のloopbackに一つ」は変えない。tailnetに出す口に台帳のPostgresを一つ足す。役割名`llm-console`は`2026-09-25-roles-named-as-people.md`で`observer`に改めた（rule行と本文の役割名もそれに合わせた）

rule: Keep one LiteLLM per machine, loopback-only, but give each its own local Postgres on the same docker network (never a DB across the tailnet on the request path); the observer machine's Postgres is the single cost ledger, and every other machine ships its unsent LiteLLM_SpendLogs rows to it when reachable, idempotently by request_id (the table's primary key), recording which machine each row came from. Expose only the ledger's Postgres port on the tailnet from the observer machine. Budgets are per machine; the cross-machine total is read from the ledger. If the DB secret is unavailable, LiteLLM still serves without a DB rather than stopping.
scope: repo

## Problem

LiteLLMを通るAIの利用コストを一元で管理したい（合計が一本、機械・ハーネス・モデル別の内訳）。機械はMacとOmarchy機の二台で、Omarchy機は止まっていることが多く、Macも寝ることがある。

## Decision

- 各機械のLiteLLMは、同じdockerネットワーク上の自分のPostgresに使用額を書く。書き込み先が常に手元なので、応答の遅れも、相手が止まっている間の取りこぼしも起きない。
- observerの役割を持つ機械（Mac）のPostgresを台帳にする。Mac自身のLiteLLMはそのまま台帳に書く。
- それ以外の機械は、まだ送っていない行を台帳へ送る（届かなければ次の回に持ち越す）。`request_id`が主キーなので、同じ行を二度送っても一件のまま（`ON CONFLICT DO NOTHING`）。どの機械の行かは台帳側の表に記録する。
- tailnetに出すのは台帳のPostgresの口だけ（observerの機械から）。LiteLLMの4000番は今まで通り外に出さない。
- 予算（上限）は機械ごと。二台を合わせた上限は作らない（手元のDBが別々なので、その場では足せない）。合計は台帳で見る。
- DBの鍵が取れないときは、LiteLLMはDBなしで動き続ける（使用額の記録だけが止まる）。

## Alternatives considered

- **各機械のLiteLLMが台帳のPostgresに直接書く（LiteLLM公式の複数台共有の型）**: 書き込みは応答の後なので遅れないが、Macが止まっている間はLiteLLMのメモリ（64MBまで、古いものから捨てる）に溜めるだけで、ディスクに残らない。その間にOmarchy側のLiteLLMが止まれば（再起動・電源断・Windowsへの切り替え）記録が消える。また鍵の確認のキャッシュが切れた直後は、止まったDBを最大10秒待つ（`PROXY_DB_LOOKUP_DEADLINE_SECONDS`）。却下。
- **LiteLLMをMacに一つだけ置く**: Macが寝た瞬間にOmarchyから全tierが使えなくなる。今より悪化。却下。
- **GrafanaでPrometheusのカウンタを機械横断で足す**: 台帳ではなく、要件を満たさない。却下。
- **Langfuseなどの別サービスへのcallback**: 常駐サービスが増え、既存のPrometheus/Grafanaを活かさない。LiteLLM組み込みのcallbackもメモリにしか溜めない。却下。

## Consequences

- 送る仕組みは自作になる（LiteLLMに組み込みは無く、同じ形の実践例は見つかっていない）。重複は主キーで防ぐ。
- 持ち主の手作業（一度）: 1Passwordに台帳のDBパスワードの項目を作る。
- 使用額の記録が止まってもLiteLLMは止めない（DBの鍵が無い機械では、記録だけが無い状態になる）。
- Grafanaに台帳のPostgresをデータソースとして足し、ハーネス別の内訳は`request_tags`を直接読む（LiteLLMの画面でのタグ別集計は有料版の機能）。

## Sources

- LiteLLMのソース（spend logの書き込みが応答の後で走ること、`SPEND_LOG_QUEUE_MAX_BYTES`によるメモリキューの上限とdrop-oldest）: https://github.com/BerriAI/litellm/blob/main/litellm/proxy/utils.py
- シャットダウン時のキュードレイン修正（spend log消失バグの対処）: https://github.com/BerriAI/litellm/pull/34826
- `/spend/logs/v2`と`request_id`が主キーであること: https://docs.litellm.ai/docs/proxy/cost_tracking
