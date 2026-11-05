# ハーネスを変える操作は、どのハーネスからでも持ち主に確認を求める

Status: accepted — 持ち主の裁定（2026-11-05）。同じ日に記録なしで足した 5 つの確認の規則（`ask-harness-write`、`ask-harness-edit`、`ask-harness-settings-write`、`ask-harness-settings-edit`、`ask-jig-apply`）を置き換える

rule: Every harness asks the owner before an agent changes the harness: writing or editing the harness sources in any checkout of this repository (`harness/` and `home/shared/harness/`, matched by layout, not by the clone's directory name), the live configuration jig writes for Claude Code, Codex, pi, omp and DSH, and the project files a harness loads at start (`.claude/settings*.json`, `.codex/config.toml`, `.codex/hooks.json`, `.pi/settings.json`, `.omp/config.yml`, `.pi` and `.omp` extensions and hooks), whether by a file tool, a redirect, `cp`/`mv`-style commands or `sed -i`; and running the commands that rewrite them (`jig apply --write`, `jig setup`, the other writing jig subcommands, also through bun or bash; `dotctl up` and `dotctl setup`; home-manager and nix-darwin switches; `make up` and `make claude`). Switching a tier (`jig tiers use`, `dotctl llm use`) is refused, because it rewrites the guarded `harness/policy/tiers.json`; the owner runs it. Codex cannot ask, so every one of these is a refusal there. A dry run (`jig apply` without `--write`) and reading stay free.

## Problem

同じ日に足した 5 つの規則は、二つの条件がそろったときにしか効いていなかった。Claude Code で作業していること、そしてこのリポジトリを `dotfiles` という名前のディレクトリに置いていることである。具体的には次の穴があった。

- Claude Code と Codex の設定ファイルしか見ておらず、pi、omp、DSH の設定と、jig が各ハーネスに配るファイルが対象外だった。
- リポジトリを別の名前で clone すると、ハーネスのソースへの書き込みを見分けられなかった。`harness/rules/...` のような相対パスでも見分けられなかった。
- `jig apply` を bash や bun から呼ぶ場合、`make up`、`dotctl llm use`、`jig setup` のように、設定を書き換える別の入口を見ていなかった。
- 規則を入れたコミットに決定の記録が無かった（2026-09-22-decision-records.md に反する）。

## Decision

1. 5 つの規則を 12 の規則に置き換える。ファイルの書き込みと編集（2 つ）、シェルからの書き込み（リダイレクト、`cp` などのコマンド、`sed -i` の 3 つ）、jig の書き込むサブコマンド（直接と、bun や bash を通す場合の 2 つ）、dotctl、nix の切り替え、make（各 1 つ）、tier の切り替え（直接と、bun や `nix run` を通す場合の 2 つ）である。
2. tier の切り替えは確認ではなく拒否にする。`harness/policy/tiers.json` はエージェントが書けないファイルで、切り替えのコマンドはそれを書き換えるからである。
3. Codex には確認を出す仕組みが無いので、確認はすべて拒否になる。Codex からはハーネスを変えられない。これを受け入れる。
4. `jig apply` の確認は `--write` 付きのときだけにする。書き込まない実行は確かめるために使うので、止めない。
5. 作業用の worktree（`.claude/worktrees/`）や sbx の写しの中の `harness/` も対象にする。そこで直したものも、最後は本体に戻るからである。
6. プロジェクトごとの設定ファイルも対象にする。ハーネスが起動時に読むので、置き換え前の規則と同じく確認を求める。
7. `make up` と `make claude` は、ほかのリポジトリで同じ名前のターゲットを使う場合も確認を求める。余分な確認より、ハーネスが黙って書き換えられるほうが困るからである。

規則の例は `harness/jig/test/domain/policy/real-policy.test.ts` に置き、12 の規則がそろって入っていることも確かめる。

## Alternatives considered

- **5 つの規則のまま、Claude Code の設定だけで止める**: jig は Claude Code 専用ではなく、ほかのハーネスでは何も止まらない。却下。
- **tier の切り替えも確認にする**: 確認で許すと、エージェントが書けないはずのファイルを、コマンドを通して書けることになる。却下。
- **`jig apply` の書き込まない実行も確認にする**: 変更を確かめるたびに止まり、確かめずに書き込む方向へ押す。却下。
- **プロジェクトの make だけを見分ける**: make のターゲットの中身は規則から見えないので、名前で見るしかない。却下。

## Consequences

- 規則だけでは塞げない穴が残る。作業中のディレクトリを起点にした相対パス、`~`、シンボリックリンクを guard が展開しないので、`harness/` の中で作業しているときの `skills/x` のような書き込みは見逃す。`CODEX_HOME` などの環境変数で場所が変わる設定のディレクトリは、規則の正規表現では追えない。`python -c` での書き込みと `git checkout` での書き戻しは見ていない。これらは jig のコードを直す作業として扱い、直す前に持ち主に内容を見せる。
- 画面の無いセッションでは確認を出せないので、これらの操作はそこで止まる。
- 規則の本体は `harness/policy/guard-rules.json` で、エージェントは書けない。差し替えは持ち主が行う。
