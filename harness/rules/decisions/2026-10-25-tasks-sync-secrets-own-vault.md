# タスクの同期の秘密は、タスク専用のvaultと専用のサービスアカウントで読む

Status: accepted — 持ち主の裁定（2026-10-25）。実装は`7e159ad9`（2026-10-26）

rule: The tasks' sync launchers (`home/shared/taskwarrior/sync-server-up.sh`, `task-sync-up.sh`) read the replicas' client id and encryption secret from a 1Password vault that holds only the tasks' secrets, with a service account that can only read that vault and whose token has its own entry in the OS store (`taskwarrior-op-token`). Never put the tasks' secrets in the LLM vault or read them with the LLM service account's token, and never give a launcher a token that reads more vaults than it needs.
scope: repo

## Problem

`2026-10-23-personal-tasks-sync.md`は、同期のclient idと鍵を1Passwordからlauncherが読むと決めた。実装では、LiteLLMのために作ったサービスアカウントと、そのvaultを流用していた。サービスアカウントは、人の操作なしに`op read`で秘密を読むための1Passwordのアカウントで、読めるvaultを作るときに決める。

この流用には二つの問題がある。

- タスクはLLMと関係がなく、LLMのvaultに置く理由が無い。
- タスクの同期は全マシンで動く。流用したままでは、タスクを同期するためだけに、LLMのAPIキーをすべて読めるトークンを各マシンに置くことになる。

## Decision

- タスクの秘密は、タスクの秘密だけを入れたvaultに置く。項目は`taskwarrior`、フィールドはclient idと`encryption-secret`である。client idのフィールド名は、Consequencesに書いたとおり確かめられていない。
- そのvaultだけを読めるサービスアカウントを作る。トークンは各マシンのOSのストア（macOSはlogin Keychain、LinuxはSecret Service）に、LiteLLMのトークンとは別の名前`taskwarrior-op-token`で入れる。
- タスクのlauncher二つは、`secrets.sh`を読み込んだあとで変数`OP_TOKEN_ITEM`を`taskwarrior-op-token`に置き換えてから`export_op_token`を呼ぶ。ほかのlauncherは今までどおりLiteLLMのトークンを読む。

## Alternatives considered

- **LLMのvaultに項目を置き、LLMのサービスアカウントで読む**（それまでの実装）: 上の二つの問題があるので退けた。
- **持ち主の個人のvaultに項目を置いたまま読む**: 1Passwordのサービスアカウントは個人のvaultを読めない。
- **一つのサービスアカウントにLLMとタスクの両方のvaultを読ませる**: LLMの役割を持たないマシンにもLLMの鍵を読めるトークンが残る。

## Consequences

- 新しいマシンでタスクを同期するには、そのマシンのOSのストアに`taskwarrior-op-token`を入れる。入っていないマシンは、`2026-10-23-personal-tasks-sync.md`のとおり、その日のバックアップだけを取って同期せずに待つ。
- `2026-10-23-personal-tasks-sync.md`のConsequencesにある「1Passwordに項目`taskwarrior`を作る」は、このvaultに作ることを指す。
- client idのフィールド名は確かめられていない。このメモの最初の版は`client_id`と書いたが、launcher二つとテストは`client-id`を読む（`home/shared/taskwarrior/sync-server-up.sh`、`task-sync-up.sh`）。項目のフィールド名を確かめ、違っていればlauncherとテストを直す。
