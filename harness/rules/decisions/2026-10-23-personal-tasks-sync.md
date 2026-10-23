# 持ち主のタスクは Taskwarrior 3.5 で持ち、observer の taskchampion-sync-server と全マシンのレプリカで同期する

Status: accepted — 持ち主の裁定（2026-10-23）

rule: Keep the owner's own tasks in Taskwarrior 3.5 with one taskrc (`home/shared/taskwarrior/taskrc`) on every machine: every machine is a replica synced every five minutes by `dotctl tasks sync loop` and backed up daily for 7 days, and the observer machine alone runs taskchampion-sync-server on loopback, published with `tailscale serve --https=10222`, and alone has recurrence on. The replicas share one client id and encryption secret from 1Password, written only into a private rc that exists while `task sync` runs, never into the taskrc, a command line or a child's environment. Never expose the server outside the tailnet, never sync through a file-sync service, and never add a project level, tag or priority value beyond the taskrc's without the owner's ruling.
scope: repo

## Problem

持ち主の仕事と私生活のタスクを、AI のセッション内の TODO ではなく、持ち主自身のタスクとして一か所で扱いたい。条件は次の三つである。

- 持ち主が使うどのマシンとスマートフォンからでも見られ、追加できる。
- AI が持ち主のタスクを読み、言われたものを追加できる。ただし勝手に変えない。
- 分け方（仕事と私生活、優先度、期限）を、好みではなく根拠のあるやり方で決める。

## Decision

- **道具**: Taskwarrior 3.5（nixpkgs の `taskwarrior3`）。`taskwarrior` は 2.x 系で、2.x は同期の方式が違う。
- **同期の形**: taskchampion-sync-server 0.7.1（nixpkgs、SQLite 版）を observer の機械に一つ置く。サーバーは 127.0.0.1:10222 だけで待ち受け、`tailscale serve --bg --https=10222 http://127.0.0.1:10222`（`dotctl llm setup`）で tailnet に HTTPS で出す。スマートフォンのアプリ（iOS の Taskchamp、Android の fatto）が HTTPS を要るためである。
- **レプリカ**: 全マシン（base ロール）がタスク全体の複製を持つ。サーバーが止まっていても、各マシンで読み書きでき、次の同期で送られる。observer 以外のマシンもすべてレプリカにする（持ち主の裁定、2026-10-23）。
- **暗号と認証**: サーバーは暗号化された変更だけを持ち、鍵はレプリカだけが持つ。サーバーが受け付けるのは、レプリカが共有する一つの client id だけである（`--allow-client-id`）。client id と鍵は 1Password の項目 `taskwarrior`（`client-id`、`encryption-secret`）から launcher が読む。
- **同期の実行**: Taskwarrior は自分では同期しない。`dotctl tasks sync loop`（launchd、systemd の user サービス `task-sync`）が 5 分ごとに `task sync` を実行する。同期の設定は、loop が `task sync` の実行中だけ `~/.local/state/task-sync/sync.rc`（0600）に書き、そこから `~/.config/task/taskrc` を include する。実行が終わるとファイルを消す。taskrc、コマンドライン、`task` と `sqlite3` の環境変数には鍵が出ない。`task` は Taskwarrior の hook を実行するので、環境変数から外す。
- **サーバーの client id**: サーバーには環境変数 `CLIENT_ID` で渡し、コマンドラインに出さない。サーバーと loop には 1Password のトークンを渡さない。
- **秘密が読めないとき**: OS のストアに 1Password のトークンが無いか、項目がまだ無いときは、その日のバックアップだけを取って終了する。サービスの管理側が 600 秒後に起動し直すので、項目を作れば次の起動から同期が始まる。
- **バックアップ**: loop が一日一回、レプリカを SQLite の `.backup` で `~/.local/state/task-sync/backups/<日付>.sqlite3` に写し、新しい 7 個を残す。
- **taskrc の置き方**: Nix が `~/.config/task/taskrc` を書き、リポジトリの taskrc と `~/.config/task/machine.rc` を絶対パスで include する。Taskwarrior は相対パスの include を、include を書いたファイルの実体のディレクトリから探すので、リポジトリへのリンクからは `machine.rc` に届かない（2026-10-23 に手元で確認）。
- **繰り返しタスク**: `recurrence=on` は observer の機械だけにする（Nix が `~/.config/task/machine.rc` に書く）。複数のレプリカが同じ繰り返しの次の回を作って重複するのを避けるためで、Taskwarrior の man page がそう指示している。
- **構造**（根拠は `harness/rules/research/2026-10-22-personal-task-structure.md`）:
  - 最上位の project は `work` と `personal` の二つ。家族のことは `personal` に入れる。二段目は、終わりのある成果物（GTD と PARA の project の意味）にだけ使う。
  - 重要は `priority:H` か空の二値（`uda.priority.values=H,`）。急ぎは期限まで 3 日以内（`due=3` で `+DUE`）か過ぎている（`+OVERDUE`）こと。`urgency.uda.priority.H.coefficient=12.0` で、`task next` が「重要で急ぎ、重要、急ぎ、どちらでもない」の順に並ぶ。
  - 見る一覧は `now`、`plan`、`quick`、`someday` の四つと、受信箱の `in`。context は `work` と `personal`。
  - `due` は本当の締め切りだけに付け、着手日は `scheduled` と `wait` で表す（Things、Todoist、Linenberger）。例外は週次の見直しの繰り返しタスクで、Taskwarrior の繰り返しは `due` を要るため付ける。
  - 受信箱は `+in`、人待ちは `+waiting`。見積もりは付けない。
- **AI の扱い**: skill `personal-tasks` が手順を持つ。読むのは自由。追加は一行で提案し、持ち主がよいと言ってから行う。`priority:H` と `due` は推測で付けない。完了、削除、変更、まとめての変更は、変わる内容を見せて了承を得てから、`rc.confirmation=no` で実行する。

## Alternatives considered

- **一部のマシンをレプリカにせず、ssh で observer の機械の `task` を動かす**: そのマシンにタスクの複製が残らないが、observer の機械が止まっていると何もできない。持ち主が退けた（2026-10-23）。
- **一部のマシンでは同期しない**: そのマシンのタスクが別の一覧になり、一か所で扱う条件を満たさない。退けた。
- **iCloud Drive などのファイル同期でデータベースを共有する**: Taskchamp の文書が、同時に書くとデータベースが壊れると警告している。退けた。
- **サーバーをインターネットに出す**: サーバーに TLS が無く、認証は client id の一覧だけである。tailnet の中だけにする。
- **dstask（git で同期）**: 二台なら候補だったが、スマートフォンのアプリが無い。退けた。
- **最上位を仕事、個人、家族の三つにする**: 家族のことも持ち主自身のタスクで、境界がはっきりしない。GTD 公式は仕事と私生活を分けるかに正解は無いとしており、三つに分ける根拠が無い。退けた。
- **同期の設定を `make up` が `~/.config/task/sync.rc` に書き、taskrc から include する**: Taskwarrior は include するファイルが無いと全コマンドが失敗する（2026-10-22 に手元で確認）。初回の `make up` の前や 1Password に届かないときに `task` が使えなくなるので、同期の設定は loop の rc にだけ置く。そのため、持ち主が手で `task sync` を実行しても同期しない。すぐに同期したいときは `dotctl service restart task-sync` でサービスを起動し直す。

## Consequences

- 持ち主が一度だけ行うこと: 1Password に項目 `taskwarrior` を作る（`client-id` に `uuidgen` の値、`encryption-secret` に `openssl rand -base64 32` の値）。observer の機械の roles.json に `observer` を入れ、ほかのマシンの roles.json に `observerHost`（observer の機械の tailnet 名）を入れて、それぞれ `make up` する。スマートフォンのアプリには、URL `https://<observer の機械の tailnet 名>:10222` と、同じ client id と鍵を入れる。
- observer の機械が止まっている間、各マシンは自分のレプリカで動き、同期は再開したときに行われる。
- `dotctl llm check` が observer で `tailscale serve 10222` を確かめる。
- 週次の見直しの繰り返しタスクは、observer の機械で一度だけ作る。
