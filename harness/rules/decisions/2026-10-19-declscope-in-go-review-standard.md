# declscope は code-reviewer が Go のレビューの基準に沿って回す

Status: accepted — 持ち主の裁定（2026-10-19）。2026-09-30-declscope-file-scoped-private.md のうち、declscope を回す担当を go-reviewer とした部分を置き換える

rule: Go code keeps an unexported name in the file that declares it, checked by declscope (pinned, built by Nix from its release binary). dotctl commits `.declscope.yaml` and a baseline of what it already had, and CI fails on anything new. On every Go diff, code-reviewer runs declscope as section 4.5 of the Go review standard (`golang-patterns/references/review-standard.md`) says — with a config outside the repository and no baseline — and keeps only crossings whose use is on a line the diff added: a finding where the project has a `.declscope.yaml`, an advisory question where it does not. Never wire declscope into a hook, and never write its config or baseline into a repository that has not adopted it.
scope: repo

## Problem

2026-09-30 の決定は、Go の差分で declscope（小文字の名前がファイルをまたいで使われていないかを調べる静的解析の道具）を回す担当を go-reviewer にしていた。2026-10-19 にレビューの体制を作り直し、言語ごとの知識は各言語の skill の `references/review-standard.md` に置き、code-reviewer がそれを読む形にした（2026-10-19-review-redesign.md）。go-reviewer は、中身を Go のレビューの基準に移して外したので、declscope を回す担当がいなくなった。

## Decision

declscope を回すのは code-reviewer にする。手順は Go のレビューの基準の 4.5 節に置く。回し方、残す指摘の範囲、指摘として出すか問いとして出すかの分け方は、2026-09-30 の決定のまま変えない。

## Alternatives considered

- **go-reviewer だけを残す**。言語ごとの reviewer を外し、知識を基準のファイルに移す決定（2026-10-19-review-redesign.md）と食い違う。却下。
- **declscope をフックで回す**。2026-09-30 の決定どおり、フックには入れない。却下。

## Consequences

- jig（このハーネスの設定を各ハーネスに配る生成ツール）が作る Claude Code の許可（`Bash(declscope *)`）の説明は、code-reviewer が回すと書く。
- ガードの規則 `permit-declscope` の説明文（`why`）も同じ内容に直す。ガードの規則はモデルが書き換えられないので、持ち主が反映する。

## Sources

- 2026-09-30-declscope-file-scoped-private.md
- 2026-10-19-review-redesign.md
- `harness/skills/golang-patterns/references/review-standard.md` の 4.5 節
