# ホストのClaude CodeはOSのサンドボックスを使わず、ガードと自動モードの判定で守る

Status: accepted — 持ち主の裁定（2026-09-30）。`2026-09-22-box-shape.md`の決定1のうち「日常はhostモード(ハーネス自前のサンドボックス + jigのガード)」の「ハーネス自前のサンドボックス」を置き換える。容れ物の中の扱い（同 決定5）は変えない

rule: On the host, Claude Code runs without its OS sandbox: jig writes `sandbox.enabled: false` into ~/.claude/settings.json, and jig's guard plus auto mode's classifier check every tool call. Containers keep Claude Code's own sandbox on inside the VM, unchanged.
scope: repo

## Problem

ホストのClaude CodeはmacOSのSeatbeltによるサンドボックスの中でコマンドを打っていた。2026-09-30の一回の作業で、これが次のように止まり、そのたびに持ち主が手でコマンドを打つことになった。

- 1Passwordの`op`（Go製）がTLSの検証に失敗し（`x509: OSStatus -26276`）、LiteLLMの鍵を取り出せなかった。Claude Codeの文書がGo製のCLIについて挙げている既知の症状と同じ。
- 書き込み先が作業中のworktreeに限られ、ハーネスの拡張が読むリポジトリ本体に`git pull`できなかった。
- `~/.claude/settings.json`がサンドボックスの書き込み禁止先で、設定の反映はすべて持ち主の手を通った。

設定を一つずつ緩めて対処することもできるが、そのたびに持ち主の手作業が要り、変更が増えるほど手作業も増える。

## Decision

1. ホストでは、jigが`~/.claude/settings.json`の`sandbox`を`{ "enabled": false }`と書く。キーを省かずに「無効」と書くのは、手で有効にされた場合もjigの管理下にあると分かるようにするため。
2. 守りは、jigのガード（PreToolUse、認証情報のファイルの読み書きやmainへのpushなどを止める）と、自動モードの判定の二つに任せる。
3. `harness/policy/sandbox.json`（除外するコマンドの一覧）は読まなくなる。削除は持ち主が行う（方針ファイルはエージェントが書けない）。
4. 容れ物（`sbx`）の中では、Claude Codeのサンドボックスを今までどおり有効にする。

## Alternatives considered

- **サンドボックスを残し、止まった箇所を設定で一つずつ直す**: `op`を除外に足す、リポジトリ本体を書き込み先に足す、など。どれも方針ファイルか`settings.json`の変更で、エージェントには書けない。直すたびに持ち主の作業が要り、今回の問題そのものが残る。却下。
- **容れ物を日常にする**: `2026-09-22-box-shape.md`で、実践者が日常を容れ物で回さないことを確かめて却下済み。

## Consequences

- OSの層で止まっていた事故が、ガードの規則と判定だけで止まるようになる。例えば、読み込んだ文書に仕込まれた指示でエージェントが`~/.ssh`を読んで外へ送るような事故。ガードはコマンドや経路の形で判断するため、形を変えた操作は漏れうる。
- 自動モードの判定は操作ごとの制御で、隔離の境界ではない（Anthropicの説明、`2026-09-22-box-shape.md`に引用済み）。無人の長い実行は、引き続き容れ物で回す。
- `op`・`gh`・`docker`・`open`がサンドボックスで失敗する問題は、ホストでは起きなくなる。
- 反映には一度だけ`jig apply --target claude --write`が要る。サンドボックスが有効な間は、エージェントが`settings.json`を書けないため。
