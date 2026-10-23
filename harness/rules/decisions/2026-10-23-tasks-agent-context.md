# AI が持ち主のタスクを読む範囲を、マシンごとに一つの context に絞れるようにする

Status: accepted — 持ち主の裁定（2026-10-23）

rule: On a machine whose roles file sets "tasksAgentContext" (`work` or `personal`), an agent reads and adds only the owner's tasks in that Taskwarrior context: Nix writes it to `~/.config/task/agent-context`, and the personal-tasks skill starts every `task` command with the filter `project:<it>` (a context alone does not limit `export`, `info`, `modify` or ID and UUID arguments), adds only into that project, uses only the reports, `projects`, `tags`, `info`, `export`, `add`, `done`, `modify`, `annotate` and `delete` (no `_` helper, `undo`, `import`, `or`/`not`/parentheses, other `rc.` override, `TASKRC` or `TASKDATA`), never switches the context, and never reads or writes `~/.task` or its backups. The limit is the skill's instruction, not an enforcement. A machine without the setting has no limit. The owner's own `task` is never limited by it.

## Problem

`2026-10-23-personal-tasks-sync.md` で、全マシンが持ち主のタスク全体（`work` と `personal`）の複製を持つことにした。AI がタスクを読むと、その内容はそのマシンの AI セッションが使うモデルの提供元に送られる。マシンによっては、そこに送ってよいのが一方の側だけのことがある。

## Decision

- roles.json に任意の `"tasksAgentContext": "work"`（または `"personal"`）を書いたマシンでは、Nix が `~/.config/task/agent-context` にその値を書く。値はこの二つ以外を受け付けず、`make up` がエラーで止まる。
- skill `personal-tasks` は、最初にこのファイルを読む。値があれば、すべての `task` コマンドの先頭に絞り込み条件 `project:<値>` を付ける（`task project:work <uuid> info`）。追加は `project:<値>` の中にだけ行う。使うコマンドは、一覧の report と `projects`、`tags`、`info`、`export`、`add`、`done`、`modify`、`annotate`、`delete` に限る。`_` で始まる補助コマンド、`undo`、`import`、絞り込み条件の `or`、`xor`、`not`、`!`、括弧、`rc.verbose` と `rc.confirmation` 以外の `rc.` 指定、`TASKRC` と `TASKDATA` の指定は使わない。`task context` で切り替えず、`~/.task`（データベースと hook）とバックアップを読み書きしない。
- `rc.context=<値>` だけでは足りない。Taskwarrior 3.5 では、`export`、`info`、`modify`、`_get`、`_projects`、`_tags`、`ids` と `uuids` は context を使わず、ID や UUID を渡したコマンドも context の絞り込みを飛ばす。`add` も、`project:personal` を明示すると context の `write` 設定より優先される。絞り込み条件はどのコマンドにも掛かるので、範囲外の UUID を渡しても一致しない（いずれも 2026-10-23 に手元の 3.5 で確認）。
- 設定の無いマシンでは制限しない。
- 持ち主が自分で使う `task` には影響しない（Taskwarrior の context 設定を書き換えないため）。
- どのマシンに設定するかは持ち主が roles.json で決める。リポジトリには書かない。

## Alternatives considered

- **どのマシンでも全部読んでよいとする**: 一方の側だけを送るべきマシンで、もう一方のタスクがモデルの提供元に送られる。退けた。
- **そのマシンではこの skill を使わない**: 仕事のタスクも AI から扱えなくなる。退けた。
- **machine.rc に `context=work` を書く**: 持ち主が手で使う `task` まで絞られるうえ、上のとおり `export` や UUID 指定には効かない。退けた。
- **guard の規則で強制する**: guard の規則は、持ち主が各マシンで手書きする一覧ファイル（`unlessCwdIn`）でマシンごとに外せる。ただし、guard は引数の引用符を失うので、説明文に `or` や `project` を含む普通の追加でも確認が出る。また、別のプログラムから `task` を動かせば通り抜けるので、境界にはならない。強制は持ち主が guard-rules.json に入れる判断で、別の決定で扱う。

## Consequences

- この制限は skill の指示で守られ、guard による強制ではない。AI が指示に従わないとき、次の経路で範囲外のタスクが読める: 絞り込み条件の無い `export` や `info`、`_` で始まる補助コマンド、`rc.context.work.read=` のような上書き、別の `TASKRC` や `TASKDATA`、`~/.task` のデータベースと `~/.local/state/task-sync/backups/` の直接の読み取り、`~/.task/hooks` に置いた hook、この skill を読み込まないセッション。
- 一方のマシンで設定が漏れると、`make up` の前は制限が掛からない（ファイルが無いときは制限なしと読む）。
- この決定は dotfiles の作り方ではなく、どのリポジトリのセッションにも掛かるので、`scope: repo` を付けない。
- 持ち主は、絞りたいマシンの roles.json に `"tasksAgentContext": "work"` を足して `make up` する。
