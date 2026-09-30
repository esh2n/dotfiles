# Go の小文字の名前はファイルの中に留める — declscope を CI と go-reviewer で使う

Status: accepted — 持ち主の裁定（2026-09-30）

rule: Go code keeps an unexported name in the file that declares it, checked by declscope (pinned, built by Nix from its release binary). dotctl commits `.declscope.yaml` and a baseline of what it already had, and CI fails on anything new. The go-reviewer runs declscope on every Go diff with a config outside the repository and no baseline, and keeps only crossings whose use is on a line the diff added: a finding where the project has a `.declscope.yaml`, an advisory question where it does not. Never wire declscope into a hook, and never write its config or baseline into a repository that has not adopted it.

## Problem

Go の可視性は大文字と小文字の二段しかなく、小文字の名前も同じパッケージのどのファイルからでも使える。コンパイラはこれを止めない。エージェントが書くコードは、見えている小文字の関数や構造体のフィールドを、別のファイルからそのまま使い始める。例えば、ある型の不変条件をそのファイルのメソッドで守っていても、別のファイルがフィールドを直接書き換えると、その検査を素通りする。AGENTS.md に規約を書いても、守られるかどうかは確率で決まる。

## Decision

1. **道具**: [mpyw/declscope](https://github.com/mpyw/declscope)（MIT）を使う。`go/analysis` の上で、名前を文字列でなく型情報（`TypesInfo.Uses`/`Defs`）で解決する。小文字の名前を既定で宣言したファイルの中だけのものとし、別のファイルからの使用を `boundary` として報告する。共有する名前は `//declscope:package` で明示する。
2. **入手**: `pkgs/declscope` が上流のリリースのバイナリを取り、`dev` の role で入れる。版は 0.15.1 に固定し、上げるときは手で上げる。ソースからのビルドには Go 1.27 が要るが、バイナリは解析する側の Go の版を問わない（Go 1.26 の dotctl で確認済み）。
3. **dotctl**: `pkgs/dotctl/.declscope.yaml` と `.declscope-baseline.yaml` をコミットする。採用時点の 134 件は baseline に入れる。CI の `dotctl` ジョブが `GOTOOLCHAIN=go1.27.0` で `go run …/declscope@v0.15.1 ./...` を実行し、新しい違反で失敗する。
4. **go-reviewer**: Go の差分をレビューするたびに declscope を実行する。手順は次のとおり。
   - リポジトリの外に、プロジェクトの設定から `baseline:` を除いた設定を書く。
   - `-config` でその設定を渡して実行する（`-config` はその一つのファイルしか読まない。存在しない baseline は空として扱われる）。
   - 使用箇所（`used here`）が、差分で追加された行にあるものだけを残す。
   - プロジェクトに `.declscope.yaml` があれば指摘として、無ければ参考の問いとして出す。
   - `GOTOOLCHAIN=local` と `GOFLAGS=-mod=readonly` で実行する。差分が `go.mod` か `go.work` に触れていれば実行せず、コマンドを示すだけにする。差分の `go`/`toolchain` の指定で、別の Go のツールチェーンが取ってこられて実行されるのを防ぐため。
5. **許可**: jig の既定の許可に `Bash(declscope *)` を足す。この許可は `declscope baseline` の書き込みも通すので、採用していないリポジトリに書かない取り決めは go-reviewer の指示で守る。`harness/policy/guard-rules.json` にも同じ許可の断片を持ち主が貼る。

## Alternatives considered

- **採用しない**: dotctl はすでに 18 のパッケージに分かれており、境界の多くは Go 自身が守っている。ただ、採用時点の 134 件のうち約 15 件は構造の歪みだった。一つは `internal/theme/apply.go` と `apply_text.go` の相互の呼び出し、もう一つは `internal/mado` の `Config.in` を `layout.go` が書き換えている箇所。新しいコードが同じ形を増やすのを機械的に止める価値がある。却下。
- **既存の 134 件に印を付けて回る**: 大半はテスト用の偽物の共有（43 件）と、`main.go` からの振り分け（29 件）で、意図した共有。印を付けても差分が大きいだけで、得るものが無い。baseline で凍結し、構造の歪みは別の作業で直す。
- **hook に入れる**: `2026-09-23-hooks-carry-formatters-only-stylelint-added.md` が、hook は整形と型検査だけと決めている。staticcheck と同じく、許可を足してモデルに実行させる。却下。
- **レビューで、分岐点で作った baseline と比べる**: 分岐点を worktree に取り出して baseline を作り、今のコードと比べる方式。declscope の baseline は宣言の単位で記録し、使用の単位では記録しない（README「Adopting on an existing codebase」）。そのため、すでに載っている宣言を新しいファイルから使い始めても報告されない。dotctl の `sweepPriorLinks` で実際に確かめた。解析も二回になる。baseline を外して、差分の行で絞るほうを採った。
- **他の linter や言語機能**: ファイル単位の可視性を Go 本体に入れる提案は重複として閉じられている（golang/go#71329）。同じことをする Go の linter は、declscope のほかに見つからなかった。golangci-lint にも含まれていない。

## Consequences

- declscope は 2026-09-12 に公開され、作者は一人で、18 日で 29 のタグが出ている。版の固定と手での更新が要る。上流が止まったら、CI の一行と `pkgs/declscope` と go-reviewer の節を外せば元に戻る。
- CI の baseline は宣言単位なので、baseline に載っている宣言の新しい使用は CI では止まらない。そこは go-reviewer が差分の行で拾う。
- 構造体の値ごとのコピーや比較、reflection、`//go:linkname`、生成されたコード、型パラメータの複合リテラルは見えない（上流の README「Limits」）。
- 採用していないプロジェクトには、ファイルを一つも書かない。そうしたプロジェクトでの結果は参考の問いに留め、承認の判定には数えない。
- 採用時点の構造の歪み（`internal/theme` の相互の呼び出し、`internal/mado` の `Config.in`、`theme/orca.go` の汎用の `writeAtomic`、`setup` と `theme` で二重にある `exists`）は、この決定では直さない。
