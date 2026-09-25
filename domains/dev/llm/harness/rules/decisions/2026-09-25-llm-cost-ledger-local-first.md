# LiteLLM を通る AI 利用コストは一冊の台帳で持つ: 各機械は手元の Postgres に書き、llm-console の機械の台帳へあとから送る

Status: accepted — 持ち主の裁定（2026-09-25、「Ok」）。経緯: 「私が使った AI の利用コストを一元で管理できること」（機械ごとの LiteLLM を Grafana で足すだけでは要件外）→ 範囲は「LiteLLM 通過分だけ」（Claude Code・Codex の直接利用は、少なくともいまは対象外）→ 共有 DB に直接書く案に「Mac が止まっているときの書き込みと再送」「書き込みに行く遅延」の懸念 → ソースまで読んだ調査の後、手元に書いてあとから送る形に「Ok」。`2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md` の「LiteLLM は各機械の loopback に一つ」は変えない。tailnet に出す口に台帳の Postgres を一つ足す

rule: Keep one LiteLLM per machine, loopback-only, but give each its own local Postgres on the same docker network (never a DB across the tailnet on the request path); the llm-console machine's Postgres is the single cost ledger, and every other machine ships its unsent LiteLLM_SpendLogs rows to it when reachable, idempotently by request_id (the table's primary key), recording which machine each row came from. Expose only the ledger's Postgres port on the tailnet from the llm-console machine. Budgets are per machine; the cross-machine total is read from the ledger. If the DB secret is unavailable, LiteLLM still serves without a DB rather than stopping.

## Problem

LiteLLM を通る AI の利用コストを一元で管理したい（合計が一本、機械・ハーネス・モデル別の内訳）。機械は Mac と Omarchy 機の二台で、Omarchy 機は Windows と切り替えるため止まっていることが多く、Mac も寝ることがある。

## Decision

- 各機械の LiteLLM は、同じ docker ネットワーク上の自分の Postgres に使用額を書く。書き込み先が常に手元なので、応答の遅れも、相手が止まっている間の取りこぼしも起きない。
- llm-console の役割を持つ機械（Mac）の Postgres を台帳にする。Mac 自身の LiteLLM はそのまま台帳に書く。
- それ以外の機械は、まだ送っていない行を台帳へ送る（届かなければ次の回に持ち越す）。`request_id` が主キーなので、同じ行を二度送っても一件のまま（`ON CONFLICT DO NOTHING`）。どの機械の行かは台帳側の表に記録する。
- tailnet に出すのは台帳の Postgres の口だけ（llm-console の機械から）。LiteLLM の 4000 番は今まで通り外に出さない。
- 予算（上限）は機械ごと。二台を合わせた上限は作らない（手元の DB が別々なので、その場では足せない）。合計は台帳で見る。
- DB の鍵が取れないときは、LiteLLM は DB なしで動き続ける（使用額の記録だけが止まる）。

## Alternatives considered

- **各機械の LiteLLM が台帳の Postgres に直接書く（LiteLLM 公式の複数台共有の型）**: 書き込みは応答の後なので遅れないが、Mac が止まっている間は LiteLLM のメモリ（64MB まで、古いものから捨てる）に溜めるだけで、ディスクに残らない。その間に Omarchy 側の LiteLLM が止まれば（再起動・電源断・Windows への切り替え）記録が消える。また鍵の確認のキャッシュが切れた直後は、止まった DB を最大 10 秒待つ（`PROXY_DB_LOOKUP_DEADLINE_SECONDS`）。却下。
- **LiteLLM を Mac に一つだけ置く**: Mac が寝た瞬間に Omarchy から全 tier が使えなくなる。今より悪化。却下。
- **Grafana で Prometheus のカウンタを機械横断で足す**: 台帳ではない。持ち主が要件外と判定。却下。
- **Langfuse などの別サービスへの callback**: 常駐サービスが増え、既存の Prometheus/Grafana を活かさない。LiteLLM 組み込みの callback もメモリにしか溜めない。却下。

## Consequences

- 送る仕組みは自作になる（LiteLLM に組み込みは無く、同じ形の実践例は見つかっていない）。重複は主キーで防ぐ。
- 持ち主の手作業（一度）: 1Password に台帳の DB パスワードの項目を作る。
- 使用額の記録が止まっても LiteLLM は止めない（DB の鍵が無い機械では、記録だけが無い状態になる）。
- Grafana に台帳の Postgres をデータソースとして足し、ハーネス別の内訳は `request_tags` を直接読む（LiteLLM の画面でのタグ別集計は有料版の機能）。

## Sources

- `rules/research/2026-09-25-single-llm-cost-ledger.md`
- `rules/research/2026-09-25-cost-ledger-outage-and-latency.md`（LiteLLM のソース: 書き込みが応答の後で走ること、メモリのキューの上限と破棄、鍵確認の 10 秒の待ち、`request_id` が主キー）
